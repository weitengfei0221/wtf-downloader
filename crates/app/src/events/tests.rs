use super::*;
use downloader_engine::protocol::{EngineEvent, TaskStatus};

fn payload_string(actions: &[( &'static str, Option<serde_json::Value>)]) -> Vec<&'static str> {
    actions.iter().map(|(name, _)| *name).collect()
}

/// Full mapping-table coverage (ARCHITECTURE section 3.3), including the
/// camelCase payload field contract.
#[test]
fn task_created_maps_to_created_event() {
    let actions = map_lifecycle_event(&EngineEvent::TaskCreated { task_id: "t1".into() });
    assert_eq!(payload_string(&actions), vec!["task:created"]);
    let payload = actions[0].1.as_ref().unwrap();
    assert_eq!(payload["taskId"], "t1");
}

#[test]
fn task_removed_maps_to_removed_event() {
    let actions = map_lifecycle_event(&EngineEvent::TaskRemoved { task_id: "t2".into() });
    assert_eq!(payload_string(&actions), vec!["task:removed"]);
    assert_eq!(actions[0].1.as_ref().unwrap()["taskId"], "t2");
}

#[test]
fn state_changed_maps_to_state_changed_with_camel_case_fields() {
    let actions = map_lifecycle_event(&EngineEvent::StateChanged {
        task_id: "t3".into(),
        from: TaskStatus::Pending,
        to: TaskStatus::Downloading,
        error: None,
        code: None,
    });
    assert_eq!(payload_string(&actions), vec!["task:state-changed"]);
    let payload = actions[0].1.as_ref().unwrap();
    assert_eq!(payload["taskId"], "t3");
    assert_eq!(payload["from"], "pending");
    assert_eq!(payload["to"], "downloading");
    assert!(payload["error"].is_null());
}

#[test]
fn completion_emits_both_state_changed_and_completed() {
    let actions = map_lifecycle_event(&EngineEvent::StateChanged {
        task_id: "t4".into(),
        from: TaskStatus::Downloading,
        to: TaskStatus::Completed,
        error: None,
        code: None,
    });
    assert_eq!(payload_string(&actions), vec!["task:state-changed", "task:completed"]);
}

#[test]
fn failure_emits_state_changed_and_failed_with_error() {
    let actions = map_lifecycle_event(&EngineEvent::StateChanged {
        task_id: "t5".into(),
        from: TaskStatus::Downloading,
        to: TaskStatus::Failed,
        error: Some("http_status:404".into()),
        code: None,
    });
    assert_eq!(payload_string(&actions), vec!["task:state-changed", "task:failed"]);
    let failed = actions[1].1.as_ref().unwrap();
    assert_eq!(failed["taskId"], "t5");
    assert_eq!(failed["error"], "http_status:404");
}

#[test]
fn progress_frames_are_not_forwarded_on_lifecycle_channel() {
    let frame = downloader_engine::protocol::ProgressFrame {
        task_id: "t6".into(),
        downloaded_bytes: 1,
        total_bytes: Some(2),
        speed_bps: 3,
        eta_secs: None,
        segments: vec![],
    };
    assert!(map_lifecycle_event(&EngineEvent::Progress(frame)).is_empty());
}

/// AC-09 contract: the failure event carries the engine's machine-readable
/// code, so the frontend never has to search `error` text for a token.
#[test]
fn failure_payload_carries_the_engine_code() {
    let actions = map_lifecycle_event(&EngineEvent::StateChanged {
        task_id: "t7".into(),
        from: TaskStatus::Downloading,
        to: TaskStatus::Failed,
        error: Some("resume_conflict: 服务器不支持断点续传，本地数据无法续用".into()),
        code: Some(downloader_engine::protocol::CODE_RESUME_CONFLICT.into()),
    });
    assert_eq!(payload_string(&actions), vec!["task:state-changed", "task:failed"]);
    let failed = actions[1].1.as_ref().unwrap();
    assert_eq!(failed["code"], "resume_conflict");
    assert_eq!(failed["taskId"], "t7");
    // The message is untouched by this change: the frontend keeps its
    // transitional text branch until it is removed deliberately.
    assert!(
        failed["error"].as_str().unwrap().starts_with("resume_conflict: "),
        "message text must stay as-is this round"
    );
}

/// No code in the engine event => the field is absent from the payload, not an
/// empty string, so the frontend's optional-field contract stays honest.
#[test]
fn failed_payload_omits_code_when_the_engine_has_none() {
    let actions = map_lifecycle_event(&EngineEvent::StateChanged {
        task_id: "t8".into(),
        from: TaskStatus::Downloading,
        to: TaskStatus::Failed,
        error: Some("分片重试耗尽（3 次）：响应数据不完整（decode）".into()),
        code: None,
    });
    let failed = actions[1].1.as_ref().unwrap();
    assert!(failed.get("code").is_none(), "code must be absent, not empty: {failed}");
}

/// A completed task must not carry a failure code even if one was passed in.
#[test]
fn completion_payload_has_no_code() {
    let actions = map_lifecycle_event(&EngineEvent::StateChanged {
        task_id: "t9".into(),
        from: TaskStatus::Downloading,
        to: TaskStatus::Completed,
        error: None,
        code: Some(downloader_engine::protocol::CODE_RESUME_CONFLICT.into()),
    });
    let state = actions[0].1.as_ref().unwrap();
    assert!(state.get("code").is_none());
}

/// Wire-shape pinning (cross-team contract): the frontend deserializes these
/// payloads directly, so both the key set and the camelCase spelling are part
/// of the contract. The critical case is the absent `code`: it must be an
/// absent key, never `code: null` - the frontend treats "code present" as
/// authoritative, and a null value would send it down the wrong branch.
///
/// `println!` lines are kept for manual inspection:
///   cargo test -p app failed_payload_wire_shape -- --nocapture
#[test]
fn failed_payload_wire_shape_is_pinned() {
    use downloader_engine::protocol::CODE_RESUME_CONFLICT;

    let with_code = map_lifecycle_event(&EngineEvent::StateChanged {
        task_id: "t10".into(),
        from: TaskStatus::Downloading,
        to: TaskStatus::Failed,
        error: Some("resume_conflict: 服务器不支持断点续传，本地数据无法续用".into()),
        code: Some(CODE_RESUME_CONFLICT.into()),
    });
    let failed = with_code[1].1.as_ref().expect("task:failed payload");
    let mut keys: Vec<&str> = failed
        .as_object()
        .expect("payload is an object")
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(keys, vec!["code", "error", "taskId"], "unexpected key set: {failed}");
    assert_eq!(failed["code"], CODE_RESUME_CONFLICT);
    println!("task:failed (with code)    = {failed}");

    let without_code = map_lifecycle_event(&EngineEvent::StateChanged {
        task_id: "t11".into(),
        from: TaskStatus::Downloading,
        to: TaskStatus::Failed,
        error: Some("分片重试耗尽（3 次）：响应数据不完整（decode）".into()),
        code: None,
    });
    let failed = without_code[1].1.as_ref().expect("task:failed payload");
    let mut keys: Vec<&str> = failed
        .as_object()
        .expect("payload is an object")
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(keys, vec!["error", "taskId"], "unexpected key set: {failed}");
    assert!(
        !failed.as_object().unwrap().contains_key("code"),
        "absent code must be an absent key, not null: {failed}"
    );
    println!("task:failed (without code) = {failed}");

    // state-changed keeps its four camelCase keys and carries no code.
    let state = with_code[0].1.as_ref().expect("task:state-changed payload");
    let mut keys: Vec<&str> = state
        .as_object()
        .expect("payload is an object")
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(keys, vec!["error", "from", "taskId", "to"], "unexpected key set: {state}");
    println!("task:state-changed         = {state}");
}
