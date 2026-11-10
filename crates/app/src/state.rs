// Shared application state managed by Tauri (ARCHITECTURE section 3.1).

use downloader_engine::protocol::{Downloader, GlobalStats};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::ipc::Channel;
use tokio::sync::Mutex;

pub struct AppState {
    pub engine: Arc<dyn Downloader>,
    /// Registered progress frame channels (replace-on-register semantics,
    /// ARCHITECTURE section 3.3). send() failures unregister entries.
    pub progress_channels: Mutex<Vec<Channel<serde_json::Value>>>,
    /// 1-1-4 beat family: written by the 4Hz aggregator inside the engine,
    /// read by the 1Hz tray tooltip.
    pub stats: Arc<GlobalStats>,
    /// Mirror of the persisted minimize_to_tray config key: the window
    /// close event handler is synchronous, so it reads this atomic instead
    /// of an async engine get_config call.
    minimize_to_tray: AtomicBool,
    /// Resolved app data directory (for future exports/diagnostics).
    pub app_data_dir: PathBuf,
}

impl AppState {
    pub fn new(
        engine: Arc<dyn Downloader>,
        stats: Arc<GlobalStats>,
        app_data_dir: PathBuf,
        minimize_to_tray: bool,
    ) -> Self {
        Self {
            engine,
            progress_channels: Mutex::new(Vec::new()),
            stats,
            minimize_to_tray: AtomicBool::new(minimize_to_tray),
            app_data_dir,
        }
    }

    pub fn minimize_to_tray(&self) -> bool {
        self.minimize_to_tray.load(Ordering::Relaxed)
    }

    pub fn set_minimize_to_tray(&self, value: bool) {
        self.minimize_to_tray.store(value, Ordering::Relaxed);
    }

    /// Replace any previous progress subscription with a fresh Channel.
    pub async fn replace_progress_channel(&self, channel: Channel<serde_json::Value>) {
        let mut channels = self.progress_channels.lock().await;
        channels.clear();
        channels.push(channel);
    }

    /// Send a frame to every registered channel; failed sends unregister
    /// the channel (frontend released its handle; download continues).
    pub async fn broadcast_progress(&self, frame: &downloader_engine::protocol::ProgressFrame) {
        let value = match serde_json::to_value(frame) {
            Ok(v) => v,
            Err(_) => return,
        };
        let mut channels = self.progress_channels.lock().await;
        channels.retain(|ch| ch.send(value.clone()).is_ok());
    }
}
