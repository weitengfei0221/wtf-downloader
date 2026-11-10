// Persistence layer (ARCHITECTURE section 1.8). Pure data access: no
// business logic. One rusqlite::Connection behind a Mutex; every method is
// synchronous and must be invoked through tokio::task::spawn_blocking by
// the engine.

#[cfg(test)]
mod tests;
mod schema;

use crate::protocol::{EngineError, TaskFilter, TaskStatus};
use crate::store::schema::{db_err, load_segments, now_ms, parse_task_row, SCHEMA};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct TaskRow {
    pub id: String,
    pub url: String,
    pub final_url: String,
    pub filename: String,
    pub dir: PathBuf,
    pub total_bytes: Option<u64>,
    pub status: TaskStatus,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub content_type: Option<String>,
    pub speed_limit: Option<u64>,
    pub error: Option<String>,
    pub retry_count: u32,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone)]
pub struct SegmentRow {
    pub task_id: String,
    pub seg_index: u32,
    pub start_byte: u64,
    pub end_byte: u64,
    pub downloaded_bytes: u64,
}

pub struct Store {
    conn: std::sync::Mutex<Connection>,
}

impl Store {
    /// Open (or create) the database and apply the PRAGMA group plus DDL.
    /// Idempotent: safe to call on every startup.
    pub fn open(path: &Path) -> Result<Self, EngineError> {
        let conn = Connection::open(path).map_err(db_err)?;
        conn.pragma_update(None, "journal_mode", "WAL").map_err(db_err)?;
        conn.pragma_update(None, "synchronous", "NORMAL").map_err(db_err)?;
        conn.pragma_update(None, "foreign_keys", "ON").map_err(db_err)?;
        conn.busy_timeout(std::time::Duration::from_millis(5000)).map_err(db_err)?;
        conn.execute_batch(SCHEMA).map_err(db_err)?;
        Ok(Self { conn: std::sync::Mutex::new(conn) })
    }

    pub fn insert_task(&self, t: &TaskRow) -> Result<(), EngineError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO tasks (id, url, final_url, filename, dir, total_bytes, status, etag,
             last_modified, content_type, speed_limit, error, retry_count, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                t.id,
                t.url,
                t.final_url,
                t.filename,
                t.dir.to_string_lossy(),
                // SQLite INTEGER is i64; u64 never reaches the DB as-is.
                t.total_bytes.map(|v| v as i64),
                t.status.as_str(),
                t.etag,
                t.last_modified,
                t.content_type,
                t.speed_limit.map(|v| v as i64),
                t.error,
                t.retry_count,
                t.created_at,
                t.updated_at,
            ],
        )
        .map_err(db_err)?;
        Ok(())
    }

    /// L1 immediate write for status transitions.
    pub fn update_task_status(
        &self,
        id: &str,
        status: TaskStatus,
        error: Option<&str>,
        retry_count: u32,
    ) -> Result<(), EngineError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE tasks SET status = ?1, error = ?2, retry_count = ?3, updated_at = ?4
             WHERE id = ?5",
            params![status.as_str(), error, retry_count, now_ms(), id],
        )
        .map_err(db_err)?;
        Ok(())
    }

    pub fn update_task_speed_limit(&self, id: &str, bps: Option<u64>) -> Result<(), EngineError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE tasks SET speed_limit = ?1, updated_at = ?2 WHERE id = ?3",
            params![bps.map(|v| v as i64), now_ms(), id],
        )
        .map_err(db_err)?;
        Ok(())
    }

    /// Metadata refresh after resume validation (final_url change, ETag
    /// backfill, probed total size) or filename dedupe.
    #[allow(clippy::too_many_arguments)]
    pub fn update_task_meta(
        &self,
        id: &str,
        final_url: Option<&str>,
        etag: Option<&str>,
        last_modified: Option<&str>,
        total_bytes: Option<u64>,
        filename: Option<&str>,
    ) -> Result<(), EngineError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE tasks SET
                final_url = COALESCE(?1, final_url),
                etag = COALESCE(?2, etag),
                last_modified = COALESCE(?3, last_modified),
                total_bytes = COALESCE(?4, total_bytes),
                filename = COALESCE(?5, filename),
                updated_at = ?6
             WHERE id = ?7",
            params![final_url, etag, last_modified, total_bytes.map(|v| v as i64), filename, now_ms(), id],
        )
        .map_err(db_err)?;
        Ok(())
    }

    /// L2/L3 writes: upsert segment rows in a single transaction.
    pub fn upsert_segments(&self, task_id: &str, segs: &[SegmentRow]) -> Result<(), EngineError> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction().map_err(db_err)?;
        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO segments (task_id, seg_index, start_byte, end_byte, downloaded_bytes)
                     VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(task_id, seg_index) DO UPDATE SET
                        start_byte = excluded.start_byte,
                        end_byte = excluded.end_byte,
                        downloaded_bytes = excluded.downloaded_bytes",
                )
                .map_err(db_err)?;
            for s in segs {
                stmt.execute(params![
                    task_id,
                    s.seg_index,
                    s.start_byte as i64,
                    s.end_byte as i64,
                    s.downloaded_bytes as i64
                ])
                    .map_err(db_err)?;
            }
        }
        tx.execute("UPDATE tasks SET updated_at = ?1 WHERE id = ?2", params![now_ms(), task_id])
            .map_err(db_err)?;
        tx.commit().map_err(db_err)?;
        Ok(())
    }

    /// Row deletion; ON DELETE CASCADE clears the segments rows.
    pub fn delete_task(&self, id: &str) -> Result<(), EngineError> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM tasks WHERE id = ?1", params![id]).map_err(db_err)?;
        Ok(())
    }

    pub fn load_all(&self) -> Result<Vec<(TaskRow, Vec<SegmentRow>)>, EngineError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT * FROM tasks ORDER BY created_at DESC")
            .map_err(db_err)?;
        let rows: Vec<TaskRow> = stmt
            .query_map([], |r| parse_task_row(r))
            .map_err(db_err)?
            .collect::<Result<_, _>>()
            .map_err(db_err)?;
        let mut out = Vec::with_capacity(rows.len());
        for t in rows {
            let segs = load_segments(&conn, &t.id)?;
            out.push((t, segs));
        }
        Ok(out)
    }

    /// List rows with the aggregated downloaded_bytes from the segments table.
    pub fn list_tasks(&self, filter: TaskFilter) -> Result<Vec<(TaskRow, u64)>, EngineError> {
        let conn = self.conn.lock().unwrap();
        let cond = match filter {
            TaskFilter::All => "",
            TaskFilter::Downloading => "WHERE status IN ('downloading','pending','paused')",
            TaskFilter::Completed => "WHERE status = 'completed'",
            TaskFilter::Failed => "WHERE status = 'failed'",
        };
        let sql = format!(
            "SELECT t.*, COALESCE((SELECT SUM(s.downloaded_bytes) FROM segments s
              WHERE s.task_id = t.id), 0) AS dl FROM tasks t {} ORDER BY t.created_at DESC",
            cond
        );
        let mut stmt = conn.prepare(&sql).map_err(db_err)?;
        let out = stmt
            .query_map([], |r| {
                let t = parse_task_row(r)?;
                let dl: i64 = r.get(15)?;
                Ok((t, dl.max(0) as u64))
            })
            .map_err(db_err)?
            .collect::<Result<_, _>>()
            .map_err(db_err)?;
        Ok(out)
    }

    pub fn get_config_json(&self, key: &str) -> Result<Option<String>, EngineError> {
        let conn = self.conn.lock().unwrap();
        conn.query_row("SELECT value FROM config WHERE key = ?1", params![key], |r| {
            r.get::<_, String>(0)
        })
        .optional()
        .map_err(db_err)
    }

    pub fn set_config_json(&self, key: &str, value: &str) -> Result<(), EngineError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO config (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(db_err)?;
        Ok(())
    }
}
