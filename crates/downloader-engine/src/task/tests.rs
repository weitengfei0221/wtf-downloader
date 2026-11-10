use super::*;
use crate::protocol::EngineEvent;
use tokio::sync::mpsc;

fn core_with_status(status: TaskStatus) -> TaskCore {
    let mut c = TaskCore::new("t1".into());
    c.status = status;
    c
}

async fn collect_events(rx: &mut mpsc::UnboundedReceiver<EngineEvent>) -> Vec<EngineEvent> {
    let mut out = Vec::new();
    while let Ok(ev) = rx.try_recv() {
        out.push(ev);
    }
    out
}

/// Table-driven test covering every legal transition.
#[tokio::test]
async fn legal_transitions_emit_state_changed() {
    use TaskStatus::*;
    let legal: Vec<(TaskStatus, TaskStatus)> = vec![
        (Pending, Downloading),
        (Pending, Failed),
        (Downloading, Paused),
        (Downloading, Failed),
        (Downloading, Completed),
        (Paused, Downloading),
        (Paused, Failed),
        (Failed, Pending),
    ];
    for (from, to) in legal {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let sink = EventSink::new(tx);
        let mut core = core_with_status(from);
        assert!(
            core.transition(to, &sink, None, None).is_ok(),
            "expected {:?} -> {:?} to be legal",
            from,
            to
        );
        assert_eq!(core.status, to);
        let events = collect_events(&mut rx).await;
        assert_eq!(events.len(), 1, "one event for {:?} -> {:?}", from, to);
        match &events[0] {
            EngineEvent::StateChanged { task_id, from: f, to: t, error, code } => {
                assert_eq!(task_id, "t1");
                assert_eq!(*f, from);
                assert_eq!(*t, to);
                assert!(error.is_none());
                assert!(code.is_none(), "legal transitions carry no failure code");
            }
            other => panic!("unexpected event {:?}", other),
        }
    }
}

/// Table-driven test: every illegal transition is rejected, status unchanged
/// and no event emitted.
#[tokio::test]
async fn illegal_transitions_rejected() {
    use TaskStatus::*;
    let all = [Pending, Downloading, Paused, Failed, Completed];
    let mut illegal_count = 0;
    for from in all {
        for to in all {
            if from == to || TaskCore::is_legal(from, to) {
                continue;
            }
            let (tx, mut rx) = mpsc::unbounded_channel();
            let sink = EventSink::new(tx);
            let mut core = core_with_status(from);
            assert!(
                core.transition(to, &sink, None, None).is_err(),
                "expected {:?} -> {:?} to be illegal",
                from,
                to
            );
            assert_eq!(core.status, from, "status must be unchanged on rejection");
            assert!(collect_events(&mut rx).await.is_empty());
            illegal_count += 1;
        }
    }
    // 25 ordered pairs - 5 identity (skipped above) - 8 legal = 12 illegal.
    assert_eq!(illegal_count, 12, "expected the full illegal set");
}

#[tokio::test]
async fn failed_transition_sets_error_and_counts_retry() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sink = EventSink::new(tx);
    let mut core = core_with_status(TaskStatus::Downloading);
    core.transition(TaskStatus::Failed, &sink, Some("http_status:404".into()), None)
        .unwrap();
    assert_eq!(core.error.as_deref(), Some("http_status:404"));
    assert_eq!(core.retry_count, 1);
    let events = collect_events(&mut rx).await;
    match &events[0] {
        EngineEvent::StateChanged { error, code, .. } => {
            assert_eq!(error.as_deref(), Some("http_status:404"));
            assert!(code.is_none(), "a codeless failure must not invent one");
        }
        other => panic!("unexpected event {:?}", other),
    }
}

/// The code travels with the failure instead of being re-derived from the
/// message text by consumers (AC-09): whatever the message says, the code is
/// the contract.
#[tokio::test]
async fn failed_transition_emits_the_failure_code() {
    use crate::protocol::CODE_RESUME_CONFLICT;
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sink = EventSink::new(tx);
    let mut core = core_with_status(TaskStatus::Downloading);
    core.transition(
        TaskStatus::Failed,
        &sink,
        Some("resume_conflict: 服务器不支持断点续传，本地数据无法续用".into()),
        Some(CODE_RESUME_CONFLICT),
    )
    .unwrap();
    let events = collect_events(&mut rx).await;
    match &events[0] {
        EngineEvent::StateChanged { code, .. } => {
            assert_eq!(code.as_deref(), Some(CODE_RESUME_CONFLICT))
        }
        other => panic!("unexpected event {:?}", other),
    }
}

/// A non-failed transition must never leak a code, even if one is passed in
/// by a careless caller (the field is failure-only).
#[tokio::test]
async fn non_failed_transition_drops_the_code() {
    use crate::protocol::CODE_RESUME_CONFLICT;
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sink = EventSink::new(tx);
    let mut core = core_with_status(TaskStatus::Downloading);
    core.transition(TaskStatus::Paused, &sink, None, Some(CODE_RESUME_CONFLICT))
        .unwrap();
    let events = collect_events(&mut rx).await;
    match &events[0] {
        EngineEvent::StateChanged { code, .. } => assert!(code.is_none()),
        other => panic!("unexpected event {:?}", other),
    }
}

/// An empty string must never reach consumers: they treat "code present" as
/// authoritative, so `Some("")` would read as "a code, but not the one you
/// want" and silently suppress the recovery prompt (AC-09).
#[tokio::test]
async fn empty_code_is_normalized_to_none() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sink = EventSink::new(tx);
    let mut core = core_with_status(TaskStatus::Downloading);
    core.transition(TaskStatus::Failed, &sink, Some("boom".into()), Some(""))
        .unwrap();
    let events = collect_events(&mut rx).await;
    match &events[0] {
        EngineEvent::StateChanged { code, .. } => {
            assert!(code.is_none(), "empty code must not be emitted: {:?}", code)
        }
        other => panic!("unexpected event {:?}", other),
    }
}

#[tokio::test]
async fn non_failed_transition_clears_error() {
    let (tx, _rx) = mpsc::unbounded_channel();
    let sink = EventSink::new(tx);
    let mut core = core_with_status(TaskStatus::Failed);
    core.error = Some("old failure".into());
    core.transition(TaskStatus::Pending, &sink, Some("ignored".into()), None)
        .unwrap();
    assert!(core.error.is_none(), "error must clear when leaving failed");
}
