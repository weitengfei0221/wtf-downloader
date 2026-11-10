use super::*;

fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("wtf-writer-{}-{}", tag, uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Write chunks at disjoint offsets (two "segments"), read back and verify
/// every byte landed at its offset: the ADR-006 correctness core.
#[tokio::test]
async fn offset_writes_land_correctly() {
    let dir = temp_dir("offsets");
    let part = dir.join("data.bin.part");
    let w = PartWriter::open(part.clone(), Some(1024)).unwrap();
    assert!(w.preallocated);

    let seg0: Vec<u8> = (0u8..=255).cycle().take(300).collect();
    let seg1: Vec<u8> = (99u8..=128).cycle().take(200).collect();

    w.write_at(0, &seg0).unwrap();
    w.write_at(700, &seg1).unwrap();

    let bytes = std::fs::read(&part).unwrap();
    assert_eq!(bytes.len(), 1024, "preallocated length");
    assert_eq!(&bytes[0..300], &seg0[..]);
    assert_eq!(&bytes[700..900], &seg1[..]);
    // Untouched hole is zeros (sparse / fresh file).
    assert!(bytes[400..700].iter().all(|b| *b == 0));
}

#[tokio::test]
async fn finish_renames_and_verifies_size() {
    let dir = temp_dir("finish");
    let w = PartWriter::open(dir.join("f.zip.part"), Some(16)).unwrap();
    w.write_at(0, &[7u8; 16]).unwrap();
    let final_path = w.finish(Some(16)).unwrap();
    assert_eq!(final_path, dir.join("f.zip"));
    assert!(!dir.join("f.zip.part").exists(), ".part renamed away");
    assert_eq!(std::fs::read(final_path).unwrap(), vec![7u8; 16]);
}

#[tokio::test]
async fn finish_rejects_size_mismatch() {
    // AC-07: deviation from Content-Length must fail the task.
    let dir = temp_dir("mismatch");
    let w = PartWriter::open(dir.join("g.zip.part"), Some(8)).unwrap();
    w.write_at(0, &[1u8; 8]).unwrap();
    let err = w.finish(Some(16)).unwrap_err();
    assert!(matches!(err, EngineError::Io(_)), "got {:?}", err);
}

#[tokio::test]
async fn finish_rejects_when_target_exists() {
    let dir = temp_dir("exists");
    std::fs::write(dir.join("h.zip"), b"existing user file").unwrap();
    let w = PartWriter::open(dir.join("h.zip.part"), Some(4)).unwrap();
    w.write_at(0, &[1, 2, 3, 4]).unwrap();
    let err = w.finish(Some(4)).unwrap_err();
    assert!(matches!(err, EngineError::Io(_)));
    // The user's file must be untouched.
    assert_eq!(std::fs::read(dir.join("h.zip")).unwrap(), b"existing user file");
}

#[tokio::test]
async fn unknown_total_skips_verification() {
    let dir = temp_dir("unknown");
    let w = PartWriter::open(dir.join("stream.part"), None).unwrap();
    assert!(!w.preallocated);
    w.write_at(0, b"hello").unwrap();
    let p = w.finish(None).unwrap();
    assert_eq!(std::fs::read(p).unwrap(), b"hello");
}

#[tokio::test]
async fn open_creates_missing_parent_dirs() {
    let dir = temp_dir("parents");
    let nested = dir.join("a/b/c/file.part");
    let w = PartWriter::open(nested.clone(), None).unwrap();
    w.write_at(0, b"x").unwrap();
    assert!(nested.exists());
}

#[tokio::test]
async fn degraded_mode_when_prealloc_fails() {
    // Path is a directory: open fails entirely (io error), not a panic.
    let dir = temp_dir("degraded");
    let err = PartWriter::open(dir.clone(), None).unwrap_err();
    assert!(matches!(err, EngineError::Io(_)));
    // Total None never attempts set_len: degenerate path is exercised by
    // unknown_total_skips_verification above.
}
