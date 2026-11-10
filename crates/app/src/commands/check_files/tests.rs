// Pure decision tests. The filesystem is injected as a `probe`, so every
// branch (including IO errors that Windows cannot reliably manufacture) is
// deterministic and independent of the machine's ACL state.

use super::missing_file_ids;
use downloader_engine::protocol::{TaskSnapshot, TaskStatus};
use std::cell::RefCell;
use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};

fn snap(id: &str, status: TaskStatus, dir: &str, filename: &str) -> TaskSnapshot {
    TaskSnapshot {
        id: id.into(),
        url: String::new(),
        final_url: String::new(),
        filename: filename.into(),
        dir: PathBuf::from(dir),
        total_bytes: None,
        status,
        speed_limit: None,
        error: None,
        retry_count: 0,
        downloaded_bytes: 0,
        created_at: 0,
        updated_at: 0,
    }
}

fn ids(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| (*s).to_string()).collect()
}

/// A probe driven by a path -> error-kind table; records every probed path.
/// Paths absent from the table are treated as present (Ok).
fn table_probe<'a>(
    table: &'a HashMap<PathBuf, io::ErrorKind>,
    calls: &'a RefCell<Vec<PathBuf>>,
) -> impl Fn(&Path) -> io::Result<()> + 'a {
    move |p| {
        calls.borrow_mut().push(p.to_path_buf());
        match table.get(p) {
            None => Ok(()),
            Some(kind) => Err(io::Error::from(*kind)),
        }
    }
}

fn official(dir: &str, filename: &str) -> PathBuf {
    PathBuf::from(dir).join(filename)
}

#[test]
fn all_present_returns_empty() {
    let snaps = vec![
        snap("t1", TaskStatus::Completed, "D:/dl", "a.zip"),
        snap("t2", TaskStatus::Completed, "D:/dl", "b.zip"),
        snap("t3", TaskStatus::Completed, "D:/dl", "c.zip"),
    ];
    let table = HashMap::new(); // every path present
    let calls = RefCell::new(Vec::new());
    let out = missing_file_ids(&snaps, &ids(&["t1", "t2", "t3"]), table_probe(&table, &calls));
    assert!(out.is_empty());
    assert_eq!(calls.borrow().len(), 3, "each completed row must be probed once");
}

#[test]
fn partial_missing_returns_only_the_missing_ids() {
    let snaps = vec![
        snap("t1", TaskStatus::Completed, "D:/dl", "a.zip"),
        snap("t2", TaskStatus::Completed, "D:/dl", "b.zip"),
        snap("t3", TaskStatus::Completed, "D:/dl", "c.zip"),
    ];
    let mut table = HashMap::new();
    table.insert(official("D:/dl", "b.zip"), io::ErrorKind::NotFound);
    let calls = RefCell::new(Vec::new());
    let out = missing_file_ids(&snaps, &ids(&["t1", "t2", "t3"]), table_probe(&table, &calls));
    assert_eq!(out, ids(&["t2"]));
    assert_eq!(calls.borrow().len(), 3);
}

#[test]
fn all_missing_returns_all_ids_in_snapshot_order() {
    let snaps = vec![
        snap("t1", TaskStatus::Completed, "D:/dl", "a.zip"),
        snap("t2", TaskStatus::Completed, "D:/dl", "b.zip"),
        snap("t3", TaskStatus::Completed, "D:/dl", "c.zip"),
    ];
    let mut table = HashMap::new();
    for n in ["a.zip", "b.zip", "c.zip"] {
        table.insert(official("D:/dl", n), io::ErrorKind::NotFound);
    }
    let calls = RefCell::new(Vec::new());
    let out = missing_file_ids(&snaps, &ids(&["t3", "t1", "t2"]), table_probe(&table, &calls));
    assert_eq!(out, ids(&["t1", "t2", "t3"]), "order follows snapshots, not input");
}

#[test]
fn empty_array_returns_empty_and_never_probes() {
    let snaps = vec![
        snap("t1", TaskStatus::Completed, "D:/dl", "a.zip"),
        snap("t2", TaskStatus::Completed, "D:/dl", "b.zip"),
    ];
    let table = HashMap::new();
    let calls = RefCell::new(Vec::new());
    let out = missing_file_ids(&snaps, &[], table_probe(&table, &calls));
    assert!(out.is_empty());
    assert!(calls.borrow().is_empty(), "empty input must do zero filesystem work");
}

#[test]
fn unknown_ids_are_skipped_without_error() {
    let snaps = vec![
        snap("t1", TaskStatus::Completed, "D:/dl", "a.zip"),
        snap("t2", TaskStatus::Completed, "D:/dl", "b.zip"),
    ];
    let mut table = HashMap::new();
    table.insert(official("D:/dl", "b.zip"), io::ErrorKind::NotFound);
    let calls = RefCell::new(Vec::new());
    let out = missing_file_ids(
        &snaps,
        &ids(&["ghost-a", "t2", "ghost-b"]),
        table_probe(&table, &calls),
    );
    assert_eq!(out, ids(&["t2"]));
    assert_eq!(calls.borrow().len(), 1, "unknown ids must never be probed");
    assert_eq!(calls.borrow()[0], official("D:/dl", "b.zip"));
}

#[test]
fn non_completed_rows_are_skipped_and_never_probed() {
    let snaps = vec![
        snap("p", TaskStatus::Pending, "D:/dl", "a.zip"),
        snap("d", TaskStatus::Downloading, "D:/dl", "b.zip"),
        snap("s", TaskStatus::Paused, "D:/dl", "c.zip"),
        snap("f", TaskStatus::Failed, "D:/dl", "d.zip"),
        snap("ok", TaskStatus::Completed, "D:/dl", "e.zip"),
    ];
    let mut table = HashMap::new();
    // All .part-owned rows would look "missing" if they were probed.
    for n in ["a.zip", "b.zip", "c.zip", "d.zip", "e.zip"] {
        table.insert(official("D:/dl", n), io::ErrorKind::NotFound);
    }
    let calls = RefCell::new(Vec::new());
    let out = missing_file_ids(
        &snaps,
        &ids(&["p", "d", "s", "f", "ok"]),
        table_probe(&table, &calls),
    );
    assert_eq!(out, ids(&["ok"]), "only the completed row may be reported");
    assert_eq!(calls.borrow().len(), 1, "non-completed rows must not be stat-ed");
    assert_eq!(calls.borrow()[0], official("D:/dl", "e.zip"));
}

#[test]
fn chinese_and_spaces_paths_are_probed_verbatim() {
    let dir = "D:/下载 目录/子 目录";
    let filename = "报告 2024 最终版.zip";
    let snaps = vec![snap("cn", TaskStatus::Completed, dir, filename)];
    let mut table = HashMap::new();
    table.insert(official(dir, filename), io::ErrorKind::NotFound);
    let calls = RefCell::new(Vec::new());
    let out = missing_file_ids(&snaps, &ids(&["cn"]), table_probe(&table, &calls));
    assert_eq!(out, ids(&["cn"]));
    assert_eq!(calls.borrow()[0], PathBuf::from(dir).join(filename));
}

#[test]
fn official_file_only_never_the_part_sidecar() {
    let snaps = vec![snap("t1", TaskStatus::Completed, "D:/dl", "a.zip")];
    let table = HashMap::new();
    let calls = RefCell::new(Vec::new());
    let _ = missing_file_ids(&snaps, &ids(&["t1"]), table_probe(&table, &calls));
    let probed = &calls.borrow()[0];
    assert_eq!(probed, &official("D:/dl", "a.zip"));
    assert!(!probed.to_string_lossy().ends_with(".part"));
}

#[test]
fn directory_itself_missing_is_reported() {
    // A stat on `missing-dir/a.zip` returns NotFound; the id must be reported.
    let dir = "D:/__wtf_no_such_directory__";
    let snaps = vec![snap("t1", TaskStatus::Completed, dir, "a.zip")];
    let mut table = HashMap::new();
    table.insert(official(dir, "a.zip"), io::ErrorKind::NotFound);
    let calls = RefCell::new(Vec::new());
    let out = missing_file_ids(&snaps, &ids(&["t1"]), table_probe(&table, &calls));
    assert_eq!(out, ids(&["t1"]));
}

#[test]
fn non_notfound_io_errors_are_never_reported_as_lost() {
    // Permission / locked / transient errors are NOT proof of deletion.
    // Verified through the injected probe (a real ACL-denied stat is not
    // reliably constructible on a developer Windows box - see report).
    let kinds = [
        io::ErrorKind::PermissionDenied,
        io::ErrorKind::Other,        // sharing violation / file in use
        io::ErrorKind::Interrupted,
        io::ErrorKind::WouldBlock,
        io::ErrorKind::TimedOut,
        io::ErrorKind::NotADirectory,
    ];
    for kind in kinds {
        let snaps = vec![snap("t1", TaskStatus::Completed, "D:/dl", "a.zip")];
        let mut table = HashMap::new();
        table.insert(official("D:/dl", "a.zip"), kind);
        let calls = RefCell::new(Vec::new());
        let out = missing_file_ids(&snaps, &ids(&["t1"]), table_probe(&table, &calls));
        assert!(out.is_empty(), "{:?} must not be misreported as a lost file", kind);
        assert_eq!(calls.borrow().len(), 1, "{:?} must still be probed", kind);
    }
}

#[test]
fn mixed_io_errors_and_real_notfound_in_one_batch() {
    let snaps = vec![
        snap("gone", TaskStatus::Completed, "D:/dl", "gone.zip"),
        snap("denied", TaskStatus::Completed, "D:/dl", "denied.zip"),
        snap("present", TaskStatus::Completed, "D:/dl", "present.zip"),
        snap("running", TaskStatus::Downloading, "D:/dl", "part.zip"),
    ];
    let mut table = HashMap::new();
    table.insert(official("D:/dl", "gone.zip"), io::ErrorKind::NotFound);
    table.insert(official("D:/dl", "denied.zip"), io::ErrorKind::PermissionDenied);
    table.insert(official("D:/dl", "part.zip"), io::ErrorKind::NotFound);
    let calls = RefCell::new(Vec::new());
    let out = missing_file_ids(
        &snaps,
        &ids(&["gone", "denied", "present", "running", "ghost"]),
        table_probe(&table, &calls),
    );
    assert_eq!(out, ids(&["gone"]));
    assert_eq!(calls.borrow().len(), 3);
}

#[test]
fn duplicate_ids_are_collapsed() {
    let snaps = vec![snap("t1", TaskStatus::Completed, "D:/dl", "a.zip")];
    let mut table = HashMap::new();
    table.insert(official("D:/dl", "a.zip"), io::ErrorKind::NotFound);
    let calls = RefCell::new(Vec::new());
    let out = missing_file_ids(
        &snaps,
        &ids(&["t1", "t1", "t1"]),
        table_probe(&table, &calls),
    );
    assert_eq!(out, ids(&["t1"]));
    assert_eq!(calls.borrow().len(), 1, "each row probed once, not once per id");
}

#[test]
fn real_filesystem_metadata_probe_agrees_with_injected_probe() {
    // Bridges the injected-probe unit tests to the real std::fs::metadata used
    // by the command: real present file, real missing file, real missing dir,
    // and a Chinese+spaces filename.
    let tmp = super::tests_support::TempDir::new("fsprobe");
    let present = tmp.path().join("报告 最终版.zip");
    std::fs::write(&present, b"ok").unwrap();
    let snaps = vec![
        snap("present", TaskStatus::Completed, &tmp.path().to_string_lossy(), "报告 最终版.zip"),
        snap("gone", TaskStatus::Completed, &tmp.path().to_string_lossy(), "消失 文件.zip"),
        snap("nodir", TaskStatus::Completed, &tmp.path().join("不存在的 目录").to_string_lossy(), "a.zip"),
        snap("running", TaskStatus::Downloading, &tmp.path().to_string_lossy(), "消失 文件.zip"),
    ];
    let probe = |p: &Path| std::fs::metadata(p).map(|_| ());
    let out = missing_file_ids(&snaps, &ids(&["present", "gone", "nodir", "running"]), probe);
    assert_eq!(out, ids(&["gone", "nodir"]));
}
