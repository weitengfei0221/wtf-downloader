// AppError mapping tests: every EngineError variant maps onto the locked
// code enum (ARCHITECTURE section 3.2).

use super::*;
use downloader_engine::protocol::EngineError;

#[test]
fn engine_error_code_mapping_table() {
    let cases: Vec<(EngineError, &str)> = vec![
        (EngineError::InvalidUrl("x".into()), "invalid_url"),
        (EngineError::InvalidArgument("x".into()), "invalid_argument"),
        (EngineError::TaskNotFound("t1".into()), "task_not_found"),
        (EngineError::ProbeFailed("x".into()), "probe_failed"),
        (EngineError::HttpStatus(404), "http_status:404"),
        (EngineError::HttpStatus(503), "http_status:503"),
        (EngineError::ResumeConflict("x".into()), "resume_conflict"),
        (EngineError::Io("x".into()), "io_error"),
        (EngineError::Db("x".into()), "db_error"),
        (EngineError::Engine("x".into()), "engine_error"),
    ];
    for (err, expected_code) in cases {
        let app_err: AppError = err.into();
        assert_eq!(app_err.code, expected_code);
        assert!(!app_err.message.is_empty(), "message must not be empty for {}", expected_code);
    }
}

#[test]
fn app_error_serializes_camel_case_shape() {
    let err = AppError::new("task_not_found", "任务不存在: t1");
    // Serialize impl emits {"code": .., "message": ..}
    let parsed: serde_json::Value =
        serde_json::from_str(&serde_json::to_string(&err).unwrap()).unwrap();
    assert_eq!(parsed["code"], "task_not_found");
    assert_eq!(parsed["message"], "任务不存在: t1");
}
