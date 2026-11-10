// Tray assembly (ARCHITECTURE section 3.4): menu, tooltip 1Hz, left-click
// toggle, and the quit path (engine shutdown + final snapshot).

#[cfg(test)]
mod tests;

use crate::state::AppState;
use std::sync::Mutex;
use tauri::menu::{CheckMenuItem, MenuBuilder, MenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

pub const ID_SHOW: &str = "tray_show";
pub const ID_PAUSE_ALL: &str = "tray_pause_all";
pub const ID_RESUME_ALL: &str = "tray_resume_all";
pub const ID_QUIT: &str = "tray_quit";
pub const ID_LIMIT_NONE: &str = "tray_limit_none";

/// (menu id, label, bytes_per_sec) for the limit submenu.
const LIMIT_CHOICES: [(&str, &str, u64); 4] = [
    ("tray_limit_512k", "512 KB/s", 512 * 1024),
    ("tray_limit_1m", "1 MB/s", 1024 * 1024),
    ("tray_limit_2m", "2 MB/s", 2 * 1024 * 1024),
    ("tray_limit_5m", "5 MB/s", 5 * 1024 * 1024),
];

const STATIC_TOOLTIP: &str = "wtf-downloader";

/// Handles for menu items whose state changes at runtime.
pub struct TrayHandles {
    limit_checks: Mutex<Vec<CheckMenuItem<Wry>>>,
}

/// Decimal speed formatting (project convention: decimal MB/s / GB).
pub fn format_speed(bps: u64) -> String {
    if bps >= 1_000_000_000 {
        format!("{:.2} GB/s", bps as f64 / 1e9)
    } else if bps >= 1_000_000 {
        format!("{:.1} MB/s", bps as f64 / 1e6)
    } else if bps >= 1_000 {
        format!("{:.0} KB/s", bps as f64 / 1e3)
    } else {
        format!("{} B/s", bps)
    }
}

pub fn setup(app: &mut tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, ID_SHOW, "显示主窗口", true, None::<&str>)?;
    let pause_all = MenuItem::with_id(app, ID_PAUSE_ALL, "暂停全部", true, None::<&str>)?;
    let resume_all = MenuItem::with_id(app, ID_RESUME_ALL, "恢复全部", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, ID_QUIT, "退出", true, None::<&str>)?;

    let mut limit_checks = vec![CheckMenuItem::with_id(
        app, ID_LIMIT_NONE, "不限速", true, true, None::<&str>,
    )?];
    for (id, label, _bps) in LIMIT_CHOICES {
        limit_checks.push(CheckMenuItem::with_id(app, id, label, true, false, None::<&str>)?);
    }
    let limit_submenu = Submenu::with_id(app, "tray_limit", "全局限速", true)?;
    for item in &limit_checks {
        limit_submenu.append(item)?;
    }

    let menu = MenuBuilder::new(app)
        .item(&show)
        .separator()
        .item(&pause_all)
        .item(&resume_all)
        .item(&limit_submenu)
        .separator()
        .item(&quit)
        .build()?;

    // Missing icon is a build-configuration error; fail loudly.
    let icon = app
        .default_window_icon()
        .cloned()
        .expect("default window icon missing: add icons to tauri.conf.json bundle");

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip(STATIC_TOOLTIP)
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                toggle_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    app.manage(TrayHandles { limit_checks: Mutex::new(limit_checks) });
    spawn_tooltip_loop(app.handle().clone());
    Ok(())
}

fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

/// What a menu id means. Resolved by a pure function so every id has a
/// single, testable mapping: an id with no branch is a click that does
/// nothing, which is exactly how "退出" used to fail silently.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MenuAction {
    Show,
    PauseAll,
    ResumeAll,
    /// `None` clears the global limit.
    SetLimit(Option<u64>),
    Quit,
    Unknown,
}

pub fn resolve_action(id: &str) -> MenuAction {
    match id {
        ID_SHOW => MenuAction::Show,
        ID_PAUSE_ALL => MenuAction::PauseAll,
        ID_RESUME_ALL => MenuAction::ResumeAll,
        ID_LIMIT_NONE => MenuAction::SetLimit(None),
        ID_QUIT => MenuAction::Quit,
        other => LIMIT_CHOICES
            .iter()
            .find(|(choice_id, _, _)| *choice_id == other)
            .map_or(MenuAction::Unknown, |(_, _, bps)| MenuAction::SetLimit(Some(*bps))),
    }
}

fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref().to_string();
    match resolve_action(&id) {
        MenuAction::Show => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        MenuAction::PauseAll => spawn_engine_call(app, |engine| async move {
            let _ = engine.pause_all().await;
        }),
        MenuAction::ResumeAll => spawn_engine_call(app, |engine| async move {
            let _ = engine.resume_all().await;
        }),
        MenuAction::SetLimit(bps) => apply_limit(app, bps),
        // Quit: pause, flush a final snapshot, then leave. Bounded by
        // shutdown::SHUTDOWN_BUDGET so a stuck runner cannot block the exit.
        MenuAction::Quit => crate::shutdown::begin_exit(app, "tray-quit"),
        MenuAction::Unknown => {
            eprintln!("[wtf-downloader] unhandled tray menu id: {id}");
        }
    }
}

fn spawn_engine_call<F, Fut>(app: &AppHandle, f: F)
where
    F: FnOnce(std::sync::Arc<dyn downloader_engine::protocol::Downloader>) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = ()> + Send + 'static,
{
    let engine = app.state::<AppState>().engine.clone();
    tauri::async_runtime::spawn(async move {
        f(engine).await;
    });
}

fn apply_limit(app: &AppHandle, bps: Option<u64>) {
    let engine = app.state::<AppState>().engine.clone();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = engine.set_global_limit(bps).await;
        if let Some(state) = app.try_state::<AppState>() {
            // Persist through set_config so the choice survives restart.
            let patch = downloader_engine::protocol::EngineConfigPatch {
                global_speed_limit_bps: Some(bps),
                ..Default::default()
            };
            let _ = state.engine.set_config(patch).await;
        }
        sync_limit_menu(&app, bps);
    });
}

/// Refresh the checked state of the limit submenu (called from tray actions
/// and from set_config / set_global_speed_limit commands).
pub fn sync_limit_menu(app: &AppHandle, bps: Option<u64>) {
    let Some(handles) = app.try_state::<TrayHandles>() else { return };
    let checks = handles.limit_checks.lock().unwrap();
    // Item 0 is "不限速"; the rest follow LIMIT_CHOICES order.
    if let Some(first) = checks.first() {
        let _ = first.set_checked(bps.is_none());
    }
    for (item, (_, _, choice_bps)) in checks.iter().skip(1).zip(LIMIT_CHOICES.iter()) {
        let _ = item.set_checked(bps == Some(*choice_bps));
    }
}

fn spawn_tooltip_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut was_active = false;
        loop {
            interval.tick().await;
            let Some(state) = app.try_state::<AppState>() else { break };
            let (active, speed) = state.stats.snapshot();
            if active > 0 {
                let text = format!(
                    "{} — {} 个任务 · {}",
                    STATIC_TOOLTIP,
                    active,
                    format_speed(speed)
                );
                if let Some(tray) = app.tray_by_id("main") {
                    let _ = tray.set_tooltip(Some(&text));
                }
                was_active = true;
            } else if was_active {
                // Restore the static text once when downloads stop.
                if let Some(tray) = app.tray_by_id("main") {
                    let _ = tray.set_tooltip(Some(STATIC_TOOLTIP));
                }
                was_active = false;
            }
        }
    });
}
