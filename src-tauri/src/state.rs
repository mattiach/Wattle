use std::path::PathBuf;
use std::process::Child;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, RwLock};

use rusqlite::Connection;

pub struct AppState {
    pub db: Mutex<Connection>,
    /// Where the journal is, right now.
    pub wattle_dir: RwLock<PathBuf>,
    /// Raised by `ai_cancel_pull` and read between chunks of a running
    /// download.
    pub pull_cancelled: AtomicBool,
    /// The model a running download is fetching, while one is running.
    pub pulling_model: Mutex<Option<String>>,
    /// The running Ollama installer, while one is running.
    pub install_child: Arc<Mutex<Option<Child>>>,
    /// Raised by `ai_cancel_rewrite`.
    pub rewrite_cancelled: AtomicBool,
}

impl AppState {
    /// The journal directory, copied out rather than borrowed.
    pub fn wattle_dir(&self) -> Result<PathBuf, String> {
        self.wattle_dir
            .read()
            .map(|dir| dir.clone())
            .map_err(|e| e.to_string())
    }
}
