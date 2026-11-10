// Open command tests. No OS hand-off happens in any case below: every test
// either fails validation or hits the missing-file branch before the opener
// is called, so the test run never pops a viewer window.

use super::*;

#[test]
fn rejects_empty_path() {
    for blank in ["", "   ", "\t\n"] {
        let err = validate_open_path(blank).unwrap_err();
        assert_eq!(err.code, "invalid_argument");
    }
}

#[test]
fn rejects_relative_path() {
    for rel in ["a.zip", "./a.zip", "downloads/a.zip", "../a.zip"] {
        let err = validate_open_path(rel).unwrap_err();
        assert_eq!(err.code, "invalid_argument");
    }
}

#[test]
fn rejects_nul_byte() {
    let err = validate_open_path("D:\\Downloads\\a\0.zip").unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[cfg(windows)]
#[test]
fn rejects_windows_non_absolute_forms() {
    // Rooted but drive-less ("/a.zip") and drive-relative ("C:a.zip") are not
    // absolute: opening them would resolve against the process CWD.
    for rel in ["/a.zip", "\\a.zip", "C:a.zip"] {
        let err = validate_open_path(rel).unwrap_err();
        assert_eq!(err.code, "invalid_argument");
    }
}

#[cfg(windows)]
#[test]
fn accepts_windows_absolute_forms() {
    for abs in ["D:/Downloads/a.zip", "D:\\Downloads\\a.zip", "\\\\server\\share\\a.zip"] {
        assert!(validate_open_path(abs).is_ok(), "{} should be accepted", abs);
    }
}

#[test]
fn accepts_absolute_path_with_forward_slashes() {
    // The frontend composes `${task.dir}/${task.filename}`, i.e. mixed
    // separators on Windows; that shape must survive validation untouched.
    let path = std::env::temp_dir().join("wtf-downloader-open").join("a.zip");
    let path = path.to_string_lossy().replace('\\', "/");
    assert!(validate_open_path(&path).is_ok(), "{} should be accepted", path);
}

#[tokio::test]
async fn command_rejects_relative_path_before_touching_disk() {
    let err = open_path("a.zip".to_string()).await.unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[tokio::test]
async fn command_reports_missing_file() {
    // A directory that is never created, so the stat is deterministically
    // NotFound on every platform.
    let missing = std::env::temp_dir()
        .join("__wtf_downloader_missing_probe__")
        .join("a.zip");
    let err = open_path(missing.to_string_lossy().into_owned())
        .await
        .unwrap_err();
    assert_eq!(err.code, "io_error");
    assert!(err.message.contains("文件不存在"), "got: {}", err.message);
}
