// Menu id dispatch table. The reported defect was a menu id with no branch
// (silent no-op click), so every id the menu builder registers must resolve
// to an action here.

use super::*;

#[test]
fn quit_id_resolves_to_quit() {
    // Regression: "退出" used to fall through to an empty arm and do nothing.
    assert_eq!(resolve_action(ID_QUIT), MenuAction::Quit);
}

#[test]
fn window_and_transfer_ids_resolve() {
    assert_eq!(resolve_action(ID_SHOW), MenuAction::Show);
    assert_eq!(resolve_action(ID_PAUSE_ALL), MenuAction::PauseAll);
    assert_eq!(resolve_action(ID_RESUME_ALL), MenuAction::ResumeAll);
}

#[test]
fn limit_ids_resolve_to_their_rate() {
    assert_eq!(resolve_action(ID_LIMIT_NONE), MenuAction::SetLimit(None));
    for (id, _label, bps) in LIMIT_CHOICES {
        assert_eq!(resolve_action(id), MenuAction::SetLimit(Some(bps)));
    }
}

#[test]
fn every_registered_menu_id_is_mapped() {
    // The tray builder registers exactly these ids (plus the submenu id).
    let registered = [ID_SHOW, ID_PAUSE_ALL, ID_RESUME_ALL, ID_LIMIT_NONE, ID_QUIT];
    for id in registered {
        assert_ne!(resolve_action(id), MenuAction::Unknown, "unmapped menu id: {id}");
    }
    for (id, _label, _bps) in LIMIT_CHOICES {
        assert_ne!(resolve_action(id), MenuAction::Unknown, "unmapped menu id: {id}");
    }
}

#[test]
fn unknown_ids_are_reported_instead_of_silently_ignored() {
    assert_eq!(resolve_action("tray_nope"), MenuAction::Unknown);
    assert_eq!(resolve_action(""), MenuAction::Unknown);
}
