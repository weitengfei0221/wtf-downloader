// Schema DDL (locked in ARCHITECTURE section 2) plus row parsing helpers.
// Kept separate from Store to respect the 300-line file budget.

use crate::protocol::{EngineError, TaskStatus};
use crate::store::{SegmentRow, TaskRow};
use rusqlite::{params, Connection};
use std::path::PathBuf;

pub(crate) fn load_segments(conn: &Connection, task_id: &str) -> Result<Vec<SegmentRow>, EngineError> {
    let mut stmt = conn
        .prepare(
            "SELECT task_id, seg_index, start_byte, end_byte, downloaded_bytes
             FROM segments WHERE task_id = ?1 ORDER BY seg_index",
        )
        .map_err(db_err)?;
    let out = stmt
        .query_map(params![task_id], |r| {
            Ok(SegmentRow {
                task_id: r.get(0)?,
                seg_index: r.get::<_, i64>(1)? as u32,
                start_byte: r.get::<_, i64>(2)? as u64,
                end_byte: r.get::<_, i64>(3)? as u64,
                downloaded_bytes: r.get::<_, i64>(4)? as u64,
            })
        })
        .map_err(db_err)?
        .collect::<Result<_, _>>()
        .map_err(db_err)?;
    Ok(out)
}

pub(crate) fn parse_task_row(r: &rusqlite::Row) -> rusqlite::Result<TaskRow> {
    Ok(TaskRow {
        id: r.get(0)?,
        url: r.get(1)?,
        final_url: r.get(2)?,
        filename: r.get(3)?,
        dir: PathBuf::from(r.get::<_, String>(4)?),
        total_bytes: r.get::<_, Option<i64>>(5)?.map(|v| v as u64),
        status: TaskStatus::parse(&r.get::<_, String>(6)?).unwrap_or(TaskStatus::Pending),
        etag: r.get(7)?,
        last_modified: r.get(8)?,
        content_type: r.get(9)?,
        speed_limit: r.get::<_, Option<i64>>(10)?.map(|v| v as u64),
        error: r.get(11)?,
        retry_count: r.get::<_, i64>(12)?.max(0) as u32,
        created_at: r.get(13)?,
        updated_at: r.get(14)?,
    })
}

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub(crate) fn db_err(e: rusqlite::Error) -> EngineError {
    EngineError::Db(e.to_string())
}

pub(crate) const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS tasks (
    id             TEXT PRIMARY KEY,
    url            TEXT NOT NULL,
    final_url      TEXT NOT NULL,
    filename       TEXT NOT NULL,
    dir            TEXT NOT NULL,
    total_bytes    INTEGER,
    status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','downloading','paused','failed','completed')),
    etag           TEXT,
    last_modified  TEXT,
    content_type   TEXT,
    speed_limit    INTEGER,
    error          TEXT,
    retry_count    INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_status     ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at);
CREATE TABLE IF NOT EXISTS segments (
    task_id          TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    seg_index        INTEGER NOT NULL,
    start_byte       INTEGER NOT NULL,
    end_byte         INTEGER NOT NULL,
    downloaded_bytes INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (task_id, seg_index)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
";
