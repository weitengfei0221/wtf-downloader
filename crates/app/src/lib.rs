// Bridge-layer assembly (ARCHITECTURE section 3.1). The entry point only
// wires plugins, state, tray, event forwarding and commands: zero business
// logic lives here.

pub mod commands;
pub mod events;
pub mod notify;
pub mod shutdown;
pub mod state;
pub mod tray;

use downloader_engine::http::HttpDownloader;
use downloader_engine::protocol::{Downloader, EngineError};
use state::AppState;
use std::sync::Arc;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        // single-instance must be registered first (official requirement).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        // Clipboard: the frontend reads the clipboard through this plugin
        // (capability `clipboard-manager:allow-read-text`) rather than the Web
        // Clipboard API, because WebView2 asks for permission on every single
        // `navigator.clipboard.readText()` call and never remembers the answer.
        .plugin(tauri_plugin_clipboard_manager::init())
        // Updater registers no new IPC command: the frontend calls the plugin's
        // own commands (updater:check / updater:download-and-install), which are
        // gated by capabilities/default.json. Keeping it out of
        // generate_handler! preserves the frozen 18-command contract.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::tasks::probe_url,
            commands::tasks::add_task,
            commands::tasks::list_tasks,
            commands::tasks::pause_task,
            commands::tasks::resume_task,
            commands::tasks::retry_task,
            commands::tasks::remove_task,
            commands::tasks::pause_all,
            commands::tasks::resume_all,
            commands::tasks::set_task_speed_limit,
            commands::check_files::check_files,
            commands::config::get_config,
            commands::config::set_config,
            commands::config::set_global_speed_limit,
            commands::config::set_autostart,
            commands::config::open_file_location,
            commands::open::open_path,
            commands::notify::notify_user,
        ])
        .setup(|app| {
            // Notification identity first: the AUMID must be registered before
            // the first toast can be shown (src/notify/mod.rs explains why the
            // plugin's own path cannot supply it in dev/portable runs). Never
            // fails startup.
            notify::prepare(app.handle());

            // Engine construction: DB under the app data dir, config load,
            // startup recovery (AC-11), then state + forwarding + tray.
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("app data dir unavailable (identifier set?)");
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("tasks.db");

            let engine: Arc<HttpDownloader> = tauri::async_runtime::block_on(async {
                let engine = HttpDownloader::new(&db_path).await?;
                let restored = engine.restore().await?;
                log_startup(restored);
                Ok::<_, EngineError>(engine)
            })?;
            // Initial close-to-tray switch (DESIGN 4.2): read once, mirrored
            // atomically for the synchronous window close handler.
            let minimize_to_tray = tauri::async_runtime::block_on(engine.get_config())
                .map(|cfg| cfg.minimize_to_tray)
                .unwrap_or(true);
            // The tooltip reads the very instance the 4Hz aggregator writes.
            let stats = engine.stats();
            app.manage(AppState::new(
                engine.clone() as Arc<dyn Downloader>,
                stats,
                data_dir,
                minimize_to_tray,
            ));

            events::spawn_forwarding(app.handle().clone());
            tray::setup(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Close-to-tray residency (Spec F5): downloads keep running when
            // minimize_to_tray is on (default); a direct exit otherwise.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle().clone();
                let minimize = app
                    .try_state::<AppState>()
                    .map(|s| s.minimize_to_tray())
                    .unwrap_or(true);
                if minimize {
                    let _ = window.hide();
                    api.prevent_close();
                } else {
                    // Graceful direct exit: same bounded path as the tray quit
                    // item, so a hung engine cannot leave the process alive.
                    shutdown::begin_exit(&app, "window-close");
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn log_startup(restored: usize) {
    // Startup diagnostics go to stdout (visible in cargo tauri dev).
    println!("[wtf-downloader] engine restored {} task(s)", restored);
}
