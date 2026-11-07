use std::fs;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};

use rusqlite::Connection;
use tauri::{AppHandle, Manager, State};
use walkdir::WalkDir;

use crate::state::AppState;

/// The folder the journal is called, wherever it is kept.
const JOURNAL_FOLDER: &str = "Wattle";

/// Where the note saying where the journal is, is kept.
fn pointer_file(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(config_dir.join("journal-dir.txt"))
}

/// The configured journal directory, or nothing if the reader never moved it.
fn configured_dir(app: &AppHandle) -> Option<PathBuf> {
    let path = pointer_file(app).ok()?;
    let contents = fs::read_to_string(path).ok()?;
    let trimmed = contents.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(PathBuf::from(trimmed))
}

/// Where the journal lives.
pub fn resolve_wattle_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let wattle_dir = match configured_dir(app) {
        Some(configured) => {
            if !configured.is_dir() {
                return Err(format!(
                    "Wattle cannot find your journal at {}. Reconnect the drive it is on, or \
                     delete {} to start again in Documents/{JOURNAL_FOLDER}.",
                    configured.display(),
                    pointer_file(app)?.display()
                ));
            }
            configured
        }
        None => {
            let documents_dir = app.path().document_dir().map_err(|e| e.to_string())?;
            documents_dir.join(JOURNAL_FOLDER)
        }
    };
    fs::create_dir_all(wattle_dir.join("attachments")).map_err(|e| e.to_string())?;
    Ok(wattle_dir)
}

/// Says out loud that the journal is not where the pointer says it is.
pub fn report_missing_journal(app: &AppHandle, message: &str) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

    app.dialog()
        .message(message)
        .kind(MessageDialogKind::Error)
        .title("Wattle")
        .blocking_show();
}

pub const PATH_OUTSIDE_JOURNAL: &str = "path:outsideJournal";
pub const PATH_THROUGH_LINK: &str = "path:throughLink";

const STORED_ROOT: &str = "attachments";
const SEALED_ROOT: &str = "sealed-letters";
const MIN_STORED_SEGMENTS: usize = 3;
const FORBIDDEN_CHARACTERS: [char; 9] = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
const RESERVED_DEVICE_NAMES: [&str; 12] = [
    "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$", "COM¹", "COM²", "COM³", "LPT¹", "LPT²", "LPT³",
];

fn is_reserved_device_name(segment: &str) -> bool {
    let stem = segment
        .split('.')
        .next()
        .unwrap_or(segment)
        .trim_end()
        .to_uppercase();
    if RESERVED_DEVICE_NAMES.contains(&stem.as_str()) {
        return true;
    }
    let numbered = stem
        .strip_prefix("COM")
        .or_else(|| stem.strip_prefix("LPT"));
    numbered.is_some_and(|digit| digit.len() == 1 && digit.as_bytes()[0].is_ascii_digit())
}

pub fn is_safe_component(segment: &str) -> bool {
    !segment.is_empty()
        && segment != "."
        && segment != ".."
        && !segment.ends_with('.')
        && !segment.ends_with(' ')
        && !segment
            .chars()
            .any(|c| c.is_control() || FORBIDDEN_CHARACTERS.contains(&c))
        && !is_reserved_device_name(segment)
}

pub fn reject_links_below(base: &Path, segments: &[&str]) -> Result<(), String> {
    let mut current = base.to_path_buf();
    for segment in segments {
        current.push(segment);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(PATH_THROUGH_LINK.to_string());
            }
            Ok(_) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error.to_string()),
        }
    }

    let resolved_base = base.canonicalize().map_err(|e| e.to_string())?;
    let resolved = current.canonicalize().map_err(|e| e.to_string())?;
    if resolved.starts_with(&resolved_base) {
        Ok(())
    } else {
        Err(PATH_THROUGH_LINK.to_string())
    }
}

pub fn is_untrusted_path(error: &str) -> bool {
    error == PATH_OUTSIDE_JOURNAL || error == PATH_THROUGH_LINK
}

fn is_well_formed_under(root: &str, relative: &str) -> bool {
    let segments: Vec<&str> = relative.split('/').collect();
    segments.len() >= MIN_STORED_SEGMENTS
        && segments[0] == root
        && segments.iter().all(|segment| is_safe_component(segment))
        && Path::new(relative)
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

pub fn is_well_formed_stored_path(stored: &str) -> bool {
    is_well_formed_under(STORED_ROOT, stored)
}

fn confined_path(base: &Path, root: &str, relative: &str) -> Result<PathBuf, String> {
    if !is_well_formed_under(root, relative) {
        return Err(PATH_OUTSIDE_JOURNAL.to_string());
    }
    let segments: Vec<&str> = relative.split('/').collect();
    reject_links_below(base, &segments)?;
    Ok(base.join(relative))
}

pub fn stored_path(base: &Path, stored: &str) -> Result<PathBuf, String> {
    confined_path(base, STORED_ROOT, stored)
}

pub fn sealed_path(base: &Path, relative: &str) -> Result<PathBuf, String> {
    confined_path(base, SEALED_ROOT, relative)
}

pub fn trusted_stored_path(base: &Path, stored: &str) -> Result<Option<PathBuf>, String> {
    match stored_path(base, stored) {
        Ok(path) => Ok(Some(path)),
        Err(error) if is_untrusted_path(&error) => Ok(None),
        Err(error) => Err(error),
    }
}

pub fn remove_file_if_present(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn get_wattle_dir(state: State<AppState>) -> Result<String, String> {
    Ok(state.wattle_dir()?.to_string_lossy().to_string())
}

/// Where a chosen folder would put the journal, and whether it may.
fn resolve_destination(current: &Path, chosen: &Path) -> Result<PathBuf, String> {
    if !chosen.is_dir() {
        return Err(format!("{} is not a folder", chosen.display()));
    }
    let target = chosen.join(JOURNAL_FOLDER);

    let resolved_current = current.canonicalize().map_err(|e| e.to_string())?;
    if let Ok(resolved_target) = target.canonicalize() {
        if resolved_target == resolved_current {
            return Err("the journal is already there".to_string());
        }
    }
    if let Ok(resolved_chosen) = chosen.canonicalize() {
        if resolved_chosen.starts_with(&resolved_current) {
            return Err("a journal cannot be moved inside itself".to_string());
        }
    }
    if target.exists()
        && fs::read_dir(&target)
            .map_err(|e| e.to_string())?
            .next()
            .is_some()
    {
        return Err(format!(
            "{} already exists and is not empty",
            target.display()
        ));
    }
    Ok(target)
}

/// Copies a tree, and answers with what it copied.
fn copy_tree(source: &Path, target: &Path) -> Result<(), String> {
    for entry in WalkDir::new(source) {
        let entry = entry.map_err(|e| e.to_string())?;
        let relative = entry
            .path()
            .strip_prefix(source)
            .map_err(|e| e.to_string())?;
        let destination = target.join(relative);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&destination).map_err(|e| e.to_string())?;
        } else if entry.file_type().is_file() {
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::copy(entry.path(), &destination).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Every file that was in the source is at the target, the same length.
fn verify_copy(source: &Path, target: &Path) -> Result<(), String> {
    for entry in WalkDir::new(source) {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().is_file() {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(source)
            .map_err(|e| e.to_string())?;
        let copied = target.join(relative);
        let original_length = entry.metadata().map_err(|e| e.to_string())?.len();
        let copied_length = fs::metadata(&copied)
            .map_err(|_| format!("{} did not arrive", relative.display()))?
            .len();
        if original_length != copied_length {
            return Err(format!("{} arrived incomplete", relative.display()));
        }
    }
    Ok(())
}

/// What a move leaves behind, when it leaves anything behind.
pub enum Moved {
    /// The journal is at the target and the old folder is gone.
    Clean,
    /// The journal is at the target, whole and verified, but something in the
    /// old folder would not be deleted - a file still held open, most likely.
    SourceRemains,
}

/// Moves a journal folder, or leaves it exactly where it was.
pub fn move_journal_impl(current: &Path, target: &Path) -> Result<Moved, String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    if fs::rename(current, target).is_ok() {
        return Ok(Moved::Clean);
    }

    let copied = copy_tree(current, target).and_then(|()| verify_copy(current, target));
    if let Err(error) = copied {
        fs::remove_dir_all(target).ok();
        return Err(error);
    }

    match fs::remove_dir_all(current) {
        Ok(()) => Ok(Moved::Clean),
        Err(_) => Ok(Moved::SourceRemains),
    }
}

/// Moves the journal - the database, the attachments and everything else Wattle
/// keeps beside them - to a folder the reader chose, and reopens it there.
#[tauri::command]
pub fn move_journal_dir(
    app: AppHandle,
    state: State<AppState>,
    destination: String,
) -> Result<(), String> {
    let mut connection = state.db.lock().map_err(|e| e.to_string())?;
    let current = state.wattle_dir()?;
    let target = resolve_destination(&current, Path::new(&destination))?;

    connection
        .pragma_update(None, "wal_checkpoint", "TRUNCATE")
        .map_err(|e| e.to_string())?;
    let placeholder = Connection::open_in_memory().map_err(|e| e.to_string())?;
    drop(std::mem::replace(&mut *connection, placeholder));

    let outcome = match move_journal_impl(&current, &target) {
        Ok(outcome) => outcome,
        Err(error) => {
            *connection = crate::db::init_db(&current)?;
            return Err(error);
        }
    };

    let pointer = pointer_file(&app)?;
    if let Some(parent) = pointer.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&pointer, target.to_string_lossy().as_ref()).map_err(|e| e.to_string())?;

    *state.wattle_dir.write().map_err(|e| e.to_string())? = target.clone();
    app.asset_protocol_scope()
        .allow_directory(target.join("attachments"), true)
        .map_err(|e| e.to_string())?;

    *connection = crate::db::init_db(&target)?;
    drop(connection);

    if matches!(outcome, Moved::SourceRemains) {
        eprintln!(
            "the journal moved to {} but {} could not be removed",
            target.display(),
            current.display()
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(name);
        std::fs::remove_dir_all(&path).ok();
        path
    }

    fn seed_journal(dir: &Path) -> String {
        fs::create_dir_all(dir).unwrap();
        let conn = crate::db::init_db(dir).unwrap();
        conn.execute(
            "INSERT INTO entries (title, content_text, entry_date) VALUES (?1, ?2, ?3)",
            rusqlite::params!["A day in August", "quince and mulberry", "2026-08-16"],
        )
        .unwrap();
        fs::create_dir_all(dir.join("attachments/1")).unwrap();
        fs::write(dir.join("attachments/1/photo.png"), b"pretend photo").unwrap();

        conn.pragma_update(None, "wal_checkpoint", "TRUNCATE")
            .unwrap();
        drop(conn);
        "quince and mulberry".to_string()
    }

    fn writing_in(dir: &Path) -> String {
        let conn = crate::db::init_db(dir).unwrap();
        let text: String = conn
            .query_row("SELECT content_text FROM entries", [], |row| row.get(0))
            .unwrap();
        drop(conn);
        text
    }

    fn seed(dir: &Path) {
        fs::create_dir_all(dir.join("attachments/7")).unwrap();
        fs::write(dir.join("wattle.db"), b"pretend database").unwrap();
        fs::write(dir.join("attachments/7/photo.png"), b"pretend photo").unwrap();
    }

    #[test]
    fn a_moved_journal_opens_at_its_new_home_with_its_writing_intact() {
        let source = scratch("wattle_move_live_source");
        let parent = scratch("wattle_move_live_parent");
        let written = seed_journal(&source);
        fs::create_dir_all(&parent).unwrap();

        let target = resolve_destination(&source, &parent).unwrap();
        move_journal_impl(&source, &target).unwrap();

        assert_eq!(writing_in(&target), written);
        assert!(target.join("attachments/1/photo.png").is_file());
        assert!(!source.exists());

        fs::remove_dir_all(&parent).ok();
        fs::remove_dir_all(&source).ok();
    }

    #[test]
    fn a_refused_move_leaves_the_journal_openable_where_it_was() {
        let source = scratch("wattle_move_refused_source");
        let written = seed_journal(&source);
        let absent = std::env::temp_dir().join("wattle_move_refused_parent");
        fs::remove_dir_all(&absent).ok();

        assert!(resolve_destination(&source, &absent).is_err());
        assert_eq!(writing_in(&source), written);
        assert!(source.join("attachments/1/photo.png").is_file());

        fs::remove_dir_all(&source).ok();
    }

    #[test]
    fn a_journal_arrives_whole_and_leaves_nothing_behind() {
        let source = scratch("wattle_move_source");
        let parent = scratch("wattle_move_parent");
        seed(&source);
        fs::create_dir_all(&parent).unwrap();

        let target = resolve_destination(&source, &parent).unwrap();
        move_journal_impl(&source, &target).unwrap();

        assert_eq!(
            fs::read(target.join("wattle.db")).unwrap(),
            b"pretend database"
        );
        assert_eq!(
            fs::read(target.join("attachments/7/photo.png")).unwrap(),
            b"pretend photo"
        );
        assert!(!source.exists(), "the journal is not in two places");

        fs::remove_dir_all(&parent).ok();
        fs::remove_dir_all(&source).ok();
    }

    #[test]
    fn the_copying_route_carries_every_file_and_checks_it_arrived() {
        let source = scratch("wattle_copy_source");
        let target = scratch("wattle_copy_target");
        seed(&source);

        copy_tree(&source, &target).unwrap();
        verify_copy(&source, &target).unwrap();

        assert_eq!(
            fs::read(target.join("attachments/7/photo.png")).unwrap(),
            b"pretend photo"
        );

        fs::write(target.join("wattle.db"), b"trunc").unwrap();
        assert!(verify_copy(&source, &target).is_err());

        fs::remove_file(target.join("attachments/7/photo.png")).unwrap();
        assert!(verify_copy(&source, &target).is_err());

        fs::remove_dir_all(&source).ok();
        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn a_journal_cannot_be_moved_inside_itself() {
        let source = scratch("wattle_move_into_self");
        seed(&source);
        let inside = source.join("attachments");

        assert!(resolve_destination(&source, &inside).is_err());
        assert!(source.join("wattle.db").is_file(), "nothing was touched");

        fs::remove_dir_all(&source).ok();
    }

    #[test]
    fn a_folder_that_already_holds_a_journal_is_refused() {
        let source = scratch("wattle_move_occupied_source");
        let parent = scratch("wattle_move_occupied_parent");
        seed(&source);
        seed(&parent.join("Wattle"));

        let refused = resolve_destination(&source, &parent);
        assert!(
            refused.is_err(),
            "an existing journal is never written over"
        );
        assert!(source.join("wattle.db").is_file());
        assert!(parent.join("Wattle/wattle.db").is_file());

        fs::remove_dir_all(&source).ok();
        fs::remove_dir_all(&parent).ok();
    }

    #[test]
    fn a_destination_that_is_not_there_is_refused_and_nothing_moves() {
        let source = scratch("wattle_move_absent_source");
        seed(&source);
        let absent = std::env::temp_dir().join("wattle_move_absent_parent");
        fs::remove_dir_all(&absent).ok();

        assert!(resolve_destination(&source, &absent).is_err());
        assert!(source.join("wattle.db").is_file());
        assert!(!absent.exists(), "nothing was created where nobody chose");

        fs::remove_dir_all(&source).ok();
    }

    #[test]
    fn moving_a_journal_onto_where_it_already_is_is_refused() {
        let parent = scratch("wattle_move_same_parent");
        let source = parent.join("Wattle");
        seed(&source);

        assert!(resolve_destination(&source, &parent).is_err());
        assert!(source.join("wattle.db").is_file());

        fs::remove_dir_all(&parent).ok();
    }

    fn link_dir(link: &Path, target: &Path) -> bool {
        #[cfg(windows)]
        {
            std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(link)
                .arg(target)
                .output()
                .is_ok_and(|output| output.status.success())
        }
        #[cfg(not(windows))]
        {
            std::os::unix::fs::symlink(target, link).is_ok()
        }
    }

    #[test]
    fn stored_paths_wattle_writes_itself_are_accepted() {
        let base = scratch("wattle_test_stored_path_accepted");
        fs::create_dir_all(&base).unwrap();
        for stored in [
            "attachments/1/2.png",
            "attachments/letters/3/4",
            "attachments/7/8.jpeg",
            "attachments/1/été.png",
        ] {
            assert_eq!(
                stored_path(&base, stored).unwrap(),
                base.join(stored),
                "{stored}"
            );
        }
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn stored_paths_that_could_leave_the_journal_are_refused() {
        let base = scratch("wattle_test_stored_path_refused");
        fs::create_dir_all(&base).unwrap();
        for stored in [
            "",
            "C:\\Windows\\win.ini",
            "C:/Windows/win.ini",
            "/etc/passwd",
            "\\\\server\\share\\file",
            "\\\\?\\C:\\file",
            "attachments/../outside/file",
            "attachments/1/../../file",
            "attachments/1/2/../../../../file",
            "attachments\\1\\2.png",
            "./attachments/1/2.png",
            "attachments//2.png",
            "attachments/1/2.png:stream",
            "attachments/1/CON",
            "attachments/1/nul.txt",
            "attachments/1/com3.log",
            "attachments/1/LPT1",
            "attachments/1/file.",
            "attachments/1/file ",
            "attachments/1/a\u{7}b",
            "sealed-letters/1/2",
            "wattle.db",
            "attachments",
            "attachments/1",
        ] {
            assert_eq!(
                stored_path(&base, stored).unwrap_err(),
                PATH_OUTSIDE_JOURNAL,
                "{stored:?}"
            );
        }
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn a_link_inside_the_journal_is_never_followed() {
        let base = scratch("wattle_test_stored_path_link");
        let outside = scratch("wattle_test_stored_path_link_outside");
        fs::create_dir_all(base.join("attachments")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("victim.txt"), b"keep me").unwrap();
        let link = base.join("attachments").join("1");
        let linked = link_dir(&link, &outside);
        assert!(linked || !cfg!(windows), "a junction could not be created");
        if !linked {
            return;
        }

        for stored in [
            "attachments/1/victim.txt",
            "attachments/1/not-yet.png",
            "attachments/1/deeper/not-yet.png",
        ] {
            assert_eq!(
                stored_path(&base, stored).unwrap_err(),
                PATH_THROUGH_LINK,
                "{stored}"
            );
        }

        fs::remove_dir(&link).ok();
        assert_eq!(fs::read(outside.join("victim.txt")).unwrap(), b"keep me");
        fs::remove_dir_all(&base).ok();
        fs::remove_dir_all(&outside).ok();
    }

    #[test]
    fn sealed_paths_stay_inside_the_sealed_folder() {
        let base = scratch("wattle_test_sealed_path");
        fs::create_dir_all(&base).unwrap();
        assert_eq!(
            sealed_path(&base, "sealed-letters/1/2").unwrap(),
            base.join("sealed-letters/1/2")
        );
        for relative in [
            "attachments/1/2",
            "sealed-letters/1",
            "sealed-letters/../attachments/2",
            "sealed-letters/1/2:stream",
            "C:\\sealed-letters\\1\\2",
        ] {
            assert_eq!(
                sealed_path(&base, relative).unwrap_err(),
                PATH_OUTSIDE_JOURNAL,
                "{relative:?}"
            );
        }
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn untrusted_paths_are_told_apart_from_failures_to_look() {
        let base = scratch("wattle_test_trusted_stored_path");
        fs::create_dir_all(base.join("attachments/1")).unwrap();
        fs::write(base.join("attachments/1/2.png"), b"bytes").unwrap();

        assert_eq!(
            trusted_stored_path(&base, "attachments/1/2.png").unwrap(),
            Some(base.join("attachments/1/2.png"))
        );
        assert_eq!(
            trusted_stored_path(&base, "C:\\Windows\\win.ini").unwrap(),
            None
        );
        assert_eq!(trusted_stored_path(&base, "").unwrap(), None);
        assert!(is_well_formed_stored_path("attachments/1/2.png"));
        assert!(!is_well_formed_stored_path("attachments/../2.png"));

        #[cfg(windows)]
        {
            let _denied = test_support::Denied::on(&base.join("attachments/1"));
            let error = trusted_stored_path(&base, "attachments/1/2.png").unwrap_err();
            assert!(!is_untrusted_path(&error), "{error}");
        }

        fs::remove_dir_all(&base).ok();
    }
}

#[cfg(all(test, windows))]
pub mod test_support {
    use std::path::{Path, PathBuf};
    use std::process::Command;

    pub struct Denied(PathBuf);

    impl Denied {
        pub fn on(dir: &Path) -> Self {
            let user = std::env::var("USERNAME").unwrap();
            let status = Command::new("icacls")
                .arg(dir)
                .args(["/deny", &format!("{user}:(OI)(CI)(F)")])
                .output()
                .unwrap()
                .status;
            assert!(status.success(), "icacls could not deny access to {dir:?}");
            Self(dir.to_path_buf())
        }
    }

    impl Drop for Denied {
        fn drop(&mut self) {
            let user = std::env::var("USERNAME").unwrap_or_default();
            Command::new("icacls")
                .arg(&self.0)
                .args(["/remove:d", &user])
                .output()
                .ok();
        }
    }
}
