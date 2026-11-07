//! Finding, starting and installing Ollama itself.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

/// The command Ollama documents for Windows. Passed to PowerShell verbatim.
const INSTALL_SCRIPT: &str = "irm https://ollama.com/install.ps1 | iex";

/// Hides the console a spawned process would otherwise get.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// How long a freshly started server is given to answer before Wattle stops
/// waiting.
const START_TIMEOUT: Duration = Duration::from_secs(20);
const POLL_INTERVAL: Duration = Duration::from_millis(400);

/// What Wattle knows about Ollama on this machine, before any model is
/// considered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeState {
    /// Assistance is switched off. Nothing was looked for and nothing asked.
    Disabled,
    /// No Ollama executable anywhere Wattle knows to look.
    NotInstalled,
    /// The executable is there, but nothing is answering on the API.
    Installed,
    /// The API answered.
    Running,
}

/// The one place the four states are decided, so the panel and the tests agree
/// on what each combination means.
pub fn resolve_state(enabled: bool, installed: bool, answering: bool) -> RuntimeState {
    if !enabled {
        RuntimeState::Disabled
    } else if answering {
        RuntimeState::Running
    } else if installed {
        RuntimeState::Installed
    } else {
        RuntimeState::NotInstalled
    }
}

/// The executable's name on this platform.
pub const fn executable_name() -> &'static str {
    if cfg!(windows) {
        "ollama.exe"
    } else {
        "ollama"
    }
}

/// Where an Ollama install puts its executable, plus everything on `PATH`.
fn search_directories() -> Vec<PathBuf> {
    let mut directories = Vec::new();

    for (variable, suffix) in [
        ("LOCALAPPDATA", "Programs/Ollama"),
        ("ProgramFiles", "Ollama"),
        ("ProgramFiles(x86)", "Ollama"),
        ("HOME", ".ollama/bin"),
    ] {
        if let Ok(base) = std::env::var(variable) {
            if !base.is_empty() {
                directories.push(Path::new(&base).join(suffix));
            }
        }
    }

    if let Ok(path) = std::env::var("PATH") {
        directories.extend(std::env::split_paths(&path));
    }

    directories
}

/// The first of these directories that actually holds the executable.
pub fn find_executable_in(directories: &[PathBuf]) -> Option<PathBuf> {
    directories
        .iter()
        .map(|directory| directory.join(executable_name()))
        .find(|candidate| candidate.is_file())
}

pub fn find_executable() -> Option<PathBuf> {
    find_executable_in(&search_directories())
}

pub fn is_installed() -> bool {
    find_executable().is_some()
}

/// Starts the server without showing anything.
pub fn start_server(executable: &Path) -> Result<(), String> {
    let mut command = Command::new(executable);
    command
        .arg("serve")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    no_window(&mut command);

    command.spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn no_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn no_window(_command: &mut Command) {}

/// Runs the official Windows installer with no console attached.
pub fn spawn_installer() -> Result<(Child, std::process::ChildStdout), String> {
    if !cfg!(windows) {
        return Err("automatic installation is only available on Windows".to_string());
    }

    let mut command = Command::new("powershell.exe");
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            INSTALL_SCRIPT,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    no_window(&mut command);

    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "the installer produced no output".to_string())?;
    Ok((child, stdout))
}

/// Waits for the API to start answering, or gives up.
pub async fn wait_until_answering(base: &str) -> bool {
    wait_until_answering_for(base, START_TIMEOUT).await
}

async fn wait_until_answering_for(base: &str, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if crate::ollama::version_at(base).await.is_some() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_four_states_are_decided_in_one_place() {
        use RuntimeState::{Disabled, Installed, NotInstalled, Running};

        assert_eq!(resolve_state(false, false, false), Disabled);
        assert_eq!(resolve_state(false, true, true), Disabled);

        assert_eq!(resolve_state(true, false, false), NotInstalled);
        assert_eq!(resolve_state(true, true, false), Installed);
        assert_eq!(resolve_state(true, true, true), Running);
        assert_eq!(resolve_state(true, false, true), Running);
    }

    #[test]
    fn an_executable_is_found_where_an_install_would_put_it() {
        let root = std::env::temp_dir().join("wattle_test_ollama_lookup");
        let present = root.join("Programs/Ollama");
        let empty = root.join("nowhere");
        std::fs::remove_dir_all(&root).ok();
        std::fs::create_dir_all(&present).unwrap();
        std::fs::create_dir_all(&empty).unwrap();

        assert!(find_executable_in(&[empty.clone(), present.clone()]).is_none());

        std::fs::write(present.join(executable_name()), b"not really an exe").unwrap();

        assert_eq!(
            find_executable_in(&[empty.clone(), present.clone()]),
            Some(present.join(executable_name()))
        );
        assert!(find_executable_in(&[]).is_none());
        assert!(find_executable_in(&[empty]).is_none());

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_directory_named_like_the_executable_is_not_an_install() {
        let root = std::env::temp_dir().join("wattle_test_ollama_decoy");
        std::fs::remove_dir_all(&root).ok();
        std::fs::create_dir_all(root.join(executable_name())).unwrap();

        assert!(find_executable_in(&[root.clone()]).is_none());

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn the_search_looks_where_windows_installs_and_along_path() {
        let directories = search_directories();
        assert!(!directories.is_empty());
        assert!(directories.iter().all(|d| !d.as_os_str().is_empty()));
    }

    #[test]
    fn the_install_script_is_ollamas_own() {
        assert_eq!(INSTALL_SCRIPT, "irm https://ollama.com/install.ps1 | iex");
        assert!(INSTALL_SCRIPT.contains("https://ollama.com/install.ps1"));
    }

    #[test]
    fn waiting_for_a_server_that_never_arrives_gives_up() {
        let started = Instant::now();
        let answered = tauri::async_runtime::block_on(async {
            wait_until_answering_for("http://127.0.0.1:1", Duration::from_secs(1)).await
        });
        assert!(!answered);
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "waiting took {:?}",
            started.elapsed()
        );
    }
}
