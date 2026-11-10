// Filename handling tests.

use super::*;

fn temp_dir(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir()
        .join(format!("wtf-naming-{}-{}", tag, uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn sanitize_strips_separators_and_control_chars() {
    assert_eq!(sanitize_filename("a/b\\c.txt"), "a_b_c.txt");
    assert_eq!(sanitize_filename("bad:name*?.zip"), "bad_name__.zip");
    assert_eq!(sanitize_filename("ends-with-dot."), "ends-with-dot");
    assert_eq!(sanitize_filename("  spaced  "), "spaced");
    assert_eq!(sanitize_filename(""), "download");
    // Three invalid characters (BEL, '/', BS) each become one underscore.
    assert_eq!(sanitize_filename("\u{7}/\u{8}.bin"), "___.bin");
}

#[test]
fn sanitize_keeps_unicode() {
    assert_eq!(sanitize_filename("模型权重.safetensors"), "模型权重.safetensors");
}

#[test]
fn dedupe_increments_suffix() {
    let dir = temp_dir("dedupe");
    // Nothing exists: keep the name.
    assert_eq!(dedupe_filename(&dir, "a.zip"), "a.zip");
    std::fs::write(dir.join("a.zip"), b"x").unwrap();
    assert_eq!(dedupe_filename(&dir, "a.zip"), "a (1).zip");
    std::fs::write(dir.join("a (1).zip"), b"x").unwrap();
    assert_eq!(dedupe_filename(&dir, "a.zip"), "a (2).zip");
    // A stale .part also blocks the plain name.
    std::fs::write(part_path(&dir, "b.zip"), b"x").unwrap();
    assert_eq!(dedupe_filename(&dir, "b.zip"), "b (1).zip");
    // No extension still works.
    std::fs::write(dir.join("README"), b"x").unwrap();
    assert_eq!(dedupe_filename(&dir, "README"), "README (1)");
}

#[test]
fn filename_from_url_variants() {
    assert_eq!(
        filename_from_url("https://example.com/files/ubuntu-24.04.iso").as_deref(),
        Some("ubuntu-24.04.iso")
    );
    assert_eq!(
        filename_from_url("https://example.com/files/%E4%B8%AD%E6%96%87.zip").as_deref(),
        Some("中文.zip")
    );
    assert_eq!(filename_from_url("https://example.com/"), None);
    assert_eq!(filename_from_url("https://example.com/a/"), None);
    assert_eq!(filename_from_url("not a url"), None);
    // Trailing query string is not part of the path.
    assert_eq!(
        filename_from_url("https://example.com/f.deb?sig=1").as_deref(),
        Some("f.deb")
    );
}

#[test]
fn content_disposition_variants() {
    assert_eq!(
        filename_from_content_disposition("attachment; filename=\"report.pdf\"").as_deref(),
        Some("report.pdf")
    );
    assert_eq!(
        filename_from_content_disposition("attachment; filename=plain.bin").as_deref(),
        Some("plain.bin")
    );
    assert_eq!(
        filename_from_content_disposition("attachment; filename*=UTF-8''%E6%95%B0%E6%8D%AE.tar")
            .as_deref(),
        Some("数据.tar")
    );
    assert_eq!(filename_from_content_disposition("inline"), None);
    assert_eq!(filename_from_content_disposition("attachment; filename=\"..\\/evil\"").as_deref(), None);
}

#[test]
fn percent_decode_passthrough_on_bad_escape() {
    assert_eq!(percent_decode("100%"), "100%");
    assert_eq!(percent_decode("a%2Fb"), "a/b");
    assert_eq!(percent_decode("%zz"), "%zz");
}
