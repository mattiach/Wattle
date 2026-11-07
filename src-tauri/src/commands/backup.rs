use std::fs::{self, File};
use std::io::{BufWriter, ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{Connection, OpenFlags};
use tauri::State;
use walkdir::WalkDir;
use zip::read::ZipFile;
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

use crate::state::AppState;

/// The one place inside the journal folder a backup must never be written.
fn reject_destination_inside(wattle_dir: &Path, destination_path: &Path) -> Result<(), String> {
    let resolved_destination = resolve_through_existing(destination_path)?;
    let resolved_journal = wattle_dir.canonicalize().map_err(|e| e.to_string())?;
    if is_same_or_inside(
        &resolved_destination,
        &resolved_journal.join(ATTACHMENTS_DIR),
    ) {
        return Err(
            "a backup cannot be written inside the attachments folder, which restoring deletes"
                .to_string(),
        );
    }
    let replaced_on_restore = managed_names()
        .chain([RESTORE_DIR])
        .any(|name| is_same_or_inside(&resolved_destination, &resolved_journal.join(name)));
    if replaced_on_restore {
        return Err(BACKUP_INSIDE_REPLACED.to_string());
    }

    let parent = destination_path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    Ok(())
}

fn resolve_through_existing(path: &Path) -> Result<PathBuf, String> {
    let absolute = std::path::absolute(path).map_err(|e| e.to_string())?;
    let mut existing = absolute.as_path();
    let mut missing = Vec::new();
    while !existing.exists() {
        let (Some(name), Some(parent)) = (existing.file_name(), existing.parent()) else {
            return Err(format!("{} cannot be resolved", path.display()));
        };
        missing.push(name);
        existing = parent;
    }
    let mut resolved = existing.canonicalize().map_err(|e| e.to_string())?;
    resolved.extend(missing.iter().rev());
    Ok(resolved)
}

fn is_same_or_inside(path: &Path, root: &Path) -> bool {
    let mut components = path.components();
    root.components().all(|expected| {
        components.next().is_some_and(|actual| {
            actual
                .as_os_str()
                .eq_ignore_ascii_case(expected.as_os_str())
        })
    })
}

/// The extension a Wattle backup is written with, and the only one it knows.
const BACKUP_EXTENSION: &str = ".wattle";

/// Whether a file in the journal folder is left out of the archive.
fn is_excluded_from_backup(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_ascii_lowercase)
        .is_some_and(|name| name.starts_with("wattle-backup-") && name.ends_with(BACKUP_EXTENSION))
}

fn create_backup_impl(
    conn: &Connection,
    wattle_dir: &Path,
    destination_path: &Path,
) -> Result<(), String> {
    reject_destination_inside(wattle_dir, destination_path)?;

    conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_row| Ok(()))
        .map_err(|e| e.to_string())?;

    let file = File::create(destination_path).map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(BufWriter::new(file));
    let options = SimpleFileOptions::default();

    let walker = WalkDir::new(wattle_dir)
        .into_iter()
        .filter_entry(|entry| !(entry.depth() == 1 && entry.file_name() == RESTORE_DIR));
    for entry in walker {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().is_symlink() {
            continue;
        }
        let path = entry.path();
        let relative_path = path.strip_prefix(wattle_dir).map_err(|e| e.to_string())?;

        if relative_path.as_os_str().is_empty() {
            continue;
        }

        if entry.file_type().is_file()
            && (is_excluded_from_backup(path) || path == destination_path)
        {
            continue;
        }

        let name = relative_path.to_string_lossy().replace('\\', "/");

        if entry.file_type().is_dir() {
            zip.add_directory(format!("{name}/"), options)
                .map_err(|e| e.to_string())?;
        } else {
            zip.start_file(name, options).map_err(|e| e.to_string())?;
            let mut source = File::open(path).map_err(|e| e.to_string())?;
            std::io::copy(&mut source, &mut zip).map_err(|e| e.to_string())?;
        }
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

const RESTORE_DIR: &str = ".wattle-restore";
const STAGING_DIR: &str = "staging";
const PREVIOUS_DIR: &str = "previous";
const STATE_FILE: &str = "state";
const STATE_TEMP_FILE: &str = "state.tmp";
const DATABASE_NAME: &str = "wattle.db";
const ATTACHMENTS_DIR: &str = "attachments";
const MANAGED_FILES: [&str; 3] = ["wattle.db", "wattle.db-wal", "wattle.db-shm"];
const MANAGED_DIRS: [&str; 2] = ["attachments", "sealed-letters"];
const STORED_PATH_QUERIES: [&str; 2] = [
    "SELECT path FROM attachments WHERE path <> ''",
    "SELECT path FROM letter_attachments WHERE path <> ''",
];
const BACKUP_INSIDE_REPLACED: &str = "a backup cannot be written inside what restoring replaces";

const GIB: u64 = 1024 * 1024 * 1024;
const MAX_RESTORE_ENTRIES: usize = 200_000;
const MIN_RESTORE_BYTES: u64 = GIB;
const MAX_RESTORE_BYTES: u64 = 64 * GIB;
const RESTORE_EXPANSION_RATIO: u64 = 100;

const RENAME_ATTEMPTS: u32 = 5;
const RENAME_BACKOFF: Duration = Duration::from_millis(50);

pub struct RestoreError;

impl RestoreError {
    pub const INVALID_ARCHIVE: &'static str = "restore:invalidArchive";
    pub const MISSING_DATABASE: &'static str = "restore:missingDatabase";
    pub const INVALID_DATABASE: &'static str = "restore:invalidDatabase";
    pub const TOO_LARGE: &'static str = "restore:tooLarge";
    pub const ROLLED_BACK: &'static str = "restore:rolledBack";
    pub const RESTART_REQUIRED: &'static str = "restore:restartRequired";
    pub const UNREADABLE_STATE: &'static str = "restore:unreadableState";
    pub const INCOMPLETE: &'static str = "restore:incomplete";
    pub const CONFLICT: &'static str = "restore:conflict";
}

fn failure(code: &str, detail: impl std::fmt::Display) -> String {
    format!("{code}: {detail}")
}

#[cfg(test)]
thread_local! {
    static INJECTED_FAILURES: std::cell::RefCell<Vec<String>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

fn checkpoint(step: &str, subject: &str) -> Result<(), String> {
    #[cfg(test)]
    {
        let label = format!("{step}:{subject}");
        if INJECTED_FAILURES.with(|failures| failures.borrow().contains(&label)) {
            return Err(format!("injected failure at {label}"));
        }
    }
    #[cfg(not(test))]
    let _ = (step, subject);
    Ok(())
}

struct RestoreLimits {
    max_entries: usize,
    max_bytes: u64,
}

fn limits_for(archive_bytes: u64) -> RestoreLimits {
    RestoreLimits {
        max_entries: MAX_RESTORE_ENTRIES,
        max_bytes: archive_bytes
            .saturating_mul(RESTORE_EXPANSION_RATIO)
            .clamp(MIN_RESTORE_BYTES, MAX_RESTORE_BYTES),
    }
}

fn restore_root(wattle_dir: &Path) -> PathBuf {
    wattle_dir.join(RESTORE_DIR)
}

fn managed_names() -> impl Iterator<Item = &'static str> {
    MANAGED_FILES.into_iter().chain(MANAGED_DIRS)
}

fn managed_name(name: &str) -> Option<&'static str> {
    managed_names().find(|managed| *managed == name)
}

fn present(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

fn has_entries(dir: &Path) -> Result<bool, String> {
    match fs::read_dir(dir) {
        Ok(mut entries) => Ok(entries.next().is_some()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

fn entry_relative_path(file: &ZipFile<'_, File>) -> Option<PathBuf> {
    if file.is_symlink() {
        return None;
    }
    file.enclosed_name()?;
    let name = file.name().ok()?;
    let name = name.as_ref();
    let trimmed = if file.is_dir() {
        name.strip_suffix('/').unwrap_or(name)
    } else {
        name
    };
    let segments: Vec<&str> = trimmed.split('/').collect();
    if segments[0] == RESTORE_DIR
        || !segments
            .iter()
            .all(|segment| crate::paths::is_safe_component(segment))
    {
        return None;
    }
    Some(segments.iter().collect())
}

fn is_managed_entry(relative: &Path, is_dir: bool) -> Result<bool, String> {
    let mut components = relative.components();
    let Some(first) = components
        .next()
        .and_then(|first| first.as_os_str().to_str())
    else {
        return Ok(false);
    };
    let nested = components.next().is_some();
    if MANAGED_FILES.contains(&first) {
        if nested || is_dir {
            return Err(failure(RestoreError::INVALID_ARCHIVE, first));
        }
        return Ok(true);
    }
    if MANAGED_DIRS.contains(&first) {
        if nested || is_dir {
            return Ok(true);
        }
        return Err(failure(RestoreError::INVALID_ARCHIVE, first));
    }
    Ok(false)
}

fn validate_archive(archive: &mut ZipArchive<File>, limits: &RestoreLimits) -> Result<(), String> {
    if archive.len() > limits.max_entries {
        return Err(failure(RestoreError::TOO_LARGE, "too many entries"));
    }
    let mut total: u64 = 0;
    let mut has_database = false;
    for index in 0..archive.len() {
        let file = archive
            .by_index(index)
            .map_err(|e| failure(RestoreError::INVALID_ARCHIVE, e))?;
        let relative = entry_relative_path(&file).ok_or_else(|| {
            failure(
                RestoreError::INVALID_ARCHIVE,
                String::from_utf8_lossy(file.name_raw()),
            )
        })?;
        is_managed_entry(&relative, file.is_dir())?;
        total = total.saturating_add(file.size());
        if total > limits.max_bytes {
            return Err(failure(RestoreError::TOO_LARGE, "too many bytes"));
        }
        if file.is_file() && relative == Path::new(DATABASE_NAME) {
            has_database = true;
        }
    }
    if has_database {
        Ok(())
    } else {
        Err(RestoreError::MISSING_DATABASE.to_string())
    }
}

fn extract_into(archive: &mut ZipArchive<File>, staging: &Path) -> Result<(), String> {
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|e| failure(RestoreError::INVALID_ARCHIVE, e))?;
        let relative = entry_relative_path(&file).ok_or_else(|| {
            failure(
                RestoreError::INVALID_ARCHIVE,
                String::from_utf8_lossy(file.name_raw()),
            )
        })?;
        if !is_managed_entry(&relative, file.is_dir())? {
            continue;
        }
        let target = staging.join(relative);
        if file.is_dir() {
            fs::create_dir_all(&target).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let expected = file.size();
        let mut output =
            File::create_new(&target).map_err(|e| failure(RestoreError::INVALID_ARCHIVE, e))?;
        let mut bounded = (&mut file).take(expected.saturating_add(1));
        let written = std::io::copy(&mut bounded, &mut output)
            .map_err(|e| failure(RestoreError::INVALID_ARCHIVE, e))?;
        if written != expected {
            return Err(failure(
                RestoreError::INVALID_ARCHIVE,
                String::from_utf8_lossy(file.name_raw()),
            ));
        }
        output.sync_all().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn validate_staged_database(staging: &Path) -> Result<(), String> {
    let invalid = |detail: String| failure(RestoreError::INVALID_DATABASE, detail);
    {
        let conn = Connection::open_with_flags(
            staging.join(DATABASE_NAME),
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|e| invalid(e.to_string()))?;
        let verdict: String = conn
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .map_err(|e| invalid(e.to_string()))?;
        if verdict != "ok" {
            return Err(invalid(verdict));
        }
        if !crate::db::is_initialised(&conn).map_err(invalid)? {
            return Err(invalid("not a Wattle journal".to_string()));
        }
    }

    let conn = crate::db::init_db(staging).map_err(invalid)?;
    for query in STORED_PATH_QUERIES {
        let mut stmt = conn.prepare(query).map_err(|e| invalid(e.to_string()))?;
        let paths = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| invalid(e.to_string()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| invalid(e.to_string()))?;
        for path in paths {
            crate::paths::stored_path(staging, &path)
                .map_err(|e| invalid(format!("{e}: {path}")))?;
        }
    }
    Ok(())
}

fn stage(source_path: &Path, staging: &Path) -> Result<(), String> {
    let file = File::open(source_path).map_err(|e| failure(RestoreError::INVALID_ARCHIVE, e))?;
    let archive_bytes = file
        .metadata()
        .map_err(|e| failure(RestoreError::INVALID_ARCHIVE, e))?
        .len();
    let mut archive =
        ZipArchive::new(file).map_err(|e| failure(RestoreError::INVALID_ARCHIVE, e))?;
    validate_archive(&mut archive, &limits_for(archive_bytes))?;
    extract_into(&mut archive, staging)?;
    drop(archive);

    validate_staged_database(staging)
}

fn rename_with_retry(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut attempt = 1;
    loop {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == ErrorKind::NotFound || attempt >= RENAME_ATTEMPTS => {
                return Err(error);
            }
            Err(_) => {
                std::thread::sleep(RENAME_BACKOFF * attempt);
                attempt += 1;
            }
        }
    }
}

fn remove_entry(path: &Path) -> std::io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() => fs::remove_dir_all(path),
        Ok(_) => fs::remove_file(path),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Detaching,
    Attaching,
    Committed,
}

impl Phase {
    const ALL: [Self; 3] = [Self::Detaching, Self::Attaching, Self::Committed];

    const fn label(self) -> &'static str {
        match self {
            Self::Detaching => "detaching",
            Self::Attaching => "attaching",
            Self::Committed => "committed",
        }
    }

    fn parse(label: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|phase| phase.label() == label)
    }
}

struct RestoreState {
    phase: Phase,
    originals: Vec<&'static str>,
}

fn read_state(root: &Path) -> Result<Option<RestoreState>, String> {
    let text = match fs::read_to_string(root.join(STATE_FILE)) {
        Ok(text) => text,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(failure(RestoreError::UNREADABLE_STATE, error)),
    };
    let mut lines = text.lines();
    let phase = lines
        .next()
        .and_then(Phase::parse)
        .ok_or_else(|| failure(RestoreError::UNREADABLE_STATE, "no phase"))?;
    let originals = lines
        .map(|line| managed_name(line).ok_or_else(|| failure(RestoreError::UNREADABLE_STATE, line)))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Some(RestoreState { phase, originals }))
}

fn write_state(root: &Path, phase: Phase, originals: &[&str]) -> Result<(), String> {
    checkpoint("write-state", phase.label())?;
    let temporary = root.join(STATE_TEMP_FILE);
    let contents = std::iter::once(phase.label())
        .chain(originals.iter().copied())
        .collect::<Vec<_>>()
        .join("\n");
    let mut file = File::create(&temporary).map_err(|e| e.to_string())?;
    file.write_all(contents.as_bytes())
        .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    checkpoint("rename-state", phase.label())?;
    rename_with_retry(&temporary, &root.join(STATE_FILE)).map_err(|e| e.to_string())
}

fn clear_empty_placeholder(target: &Path) -> Result<(), String> {
    match fs::symlink_metadata(target) {
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
        Ok(metadata) if metadata.is_dir() && !has_entries(target)? => {
            fs::remove_dir(target).map_err(|e| e.to_string())
        }
        Ok(_) => Err(failure(RestoreError::CONFLICT, target.display())),
    }
}

fn reattach(wattle_dir: &Path, originals: &[&str]) -> Result<(), String> {
    let root = restore_root(wattle_dir);
    let previous = root.join(PREVIOUS_DIR);
    for name in managed_names() {
        let kept = previous.join(name);
        if !present(&kept)? {
            continue;
        }
        checkpoint("reattach", name)?;
        let target = wattle_dir.join(name);
        clear_empty_placeholder(&target)?;
        rename_with_retry(&kept, &target).map_err(|e| e.to_string())?;
    }
    for name in originals {
        if !present(&wattle_dir.join(name))? {
            return Err(failure(RestoreError::INCOMPLETE, name));
        }
    }
    if has_entries(&previous)? {
        return Err(failure(RestoreError::CONFLICT, previous.display()));
    }
    fs::remove_file(root.join(STATE_FILE)).map_err(|e| e.to_string())?;
    remove_entry(&root).ok();
    Ok(())
}

fn undo_attach(wattle_dir: &Path, originals: &[&str]) -> Result<(), String> {
    let root = restore_root(wattle_dir);
    let previous = root.join(PREVIOUS_DIR);
    for name in originals {
        if !present(&previous.join(name))? {
            return Err(failure(RestoreError::INCOMPLETE, name));
        }
    }
    for name in managed_names() {
        checkpoint("discard", name)?;
        remove_entry(&wattle_dir.join(name)).map_err(|e| e.to_string())?;
    }
    write_state(&root, Phase::Detaching, originals)
}

fn finish_commit(wattle_dir: &Path) -> Result<(), String> {
    if !present(&wattle_dir.join(DATABASE_NAME))? {
        return Err(failure(RestoreError::INCOMPLETE, DATABASE_NAME));
    }
    let root = restore_root(wattle_dir);
    checkpoint("finish", PREVIOUS_DIR)?;
    remove_entry(&root.join(PREVIOUS_DIR)).map_err(|e| e.to_string())?;
    remove_entry(&root.join(STAGING_DIR)).map_err(|e| e.to_string())?;
    fs::remove_file(root.join(STATE_FILE)).map_err(|e| e.to_string())?;
    remove_entry(&root).ok();
    Ok(())
}

fn discard_unused_restore_folder(wattle_dir: &Path) -> Result<(), String> {
    let root = restore_root(wattle_dir);
    if has_entries(&root.join(PREVIOUS_DIR))? {
        return Err(failure(
            RestoreError::UNREADABLE_STATE,
            "kept files without a recorded state",
        ));
    }
    remove_entry(&root).ok();
    Ok(())
}

pub fn recover_interrupted_restore(wattle_dir: &Path) -> Result<(), String> {
    let Some(state) = read_state(&restore_root(wattle_dir))? else {
        return discard_unused_restore_folder(wattle_dir);
    };
    match state.phase {
        Phase::Detaching => reattach(wattle_dir, &state.originals),
        Phase::Attaching => {
            undo_attach(wattle_dir, &state.originals)?;
            reattach(wattle_dir, &state.originals)
        }
        Phase::Committed => finish_commit(wattle_dir),
    }
}

fn open_read_only(path: &Path) -> Option<Connection> {
    if !path.is_file() {
        return None;
    }
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |row| {
        row.get::<_, i64>(0)
    })
    .ok()?;
    Some(conn)
}

fn read_only_fallback(wattle_dir: &Path) -> Connection {
    let root = restore_root(wattle_dir);
    let kept = root.join(PREVIOUS_DIR).join(DATABASE_NAME);
    let current = wattle_dir.join(DATABASE_NAME);
    let staged = root.join(STAGING_DIR).join(DATABASE_NAME);
    let committed = matches!(
        read_state(&root),
        Ok(Some(RestoreState {
            phase: Phase::Committed,
            ..
        }))
    );
    let candidates = if committed {
        [current, kept, staged]
    } else {
        [kept, current, staged]
    };
    let conn = candidates
        .iter()
        .find_map(|path| open_read_only(path))
        .unwrap_or_else(|| {
            Connection::open_in_memory().expect("an in-memory database always opens")
        });
    conn.pragma_update(None, "query_only", true).ok();
    conn
}

fn attach_restored(wattle_dir: &Path) -> Result<Connection, String> {
    let root = restore_root(wattle_dir);
    let staging = root.join(STAGING_DIR);
    let previous = root.join(PREVIOUS_DIR);

    let mut originals = Vec::new();
    for name in managed_names() {
        if present(&wattle_dir.join(name))? {
            originals.push(name);
        }
    }

    write_state(&root, Phase::Detaching, &originals)?;
    fs::create_dir_all(&previous).map_err(|e| e.to_string())?;
    for name in &originals {
        checkpoint("detach", name)?;
        rename_with_retry(&wattle_dir.join(name), &previous.join(name))
            .map_err(|e| e.to_string())?;
    }

    write_state(&root, Phase::Attaching, &originals)?;
    for name in managed_names() {
        let staged = staging.join(name);
        if !present(&staged)? {
            continue;
        }
        checkpoint("attach", name)?;
        rename_with_retry(&staged, &wattle_dir.join(name)).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(wattle_dir.join(ATTACHMENTS_DIR)).map_err(|e| e.to_string())?;
    checkpoint("open", DATABASE_NAME)?;
    let restored = crate::db::init_db(wattle_dir)?;

    write_state(&root, Phase::Committed, &originals)?;
    Ok(restored)
}

fn replace_journal(conn: &mut Connection, wattle_dir: &Path) -> Result<(), String> {
    let placeholder = Connection::open_in_memory().map_err(|e| e.to_string())?;
    drop(std::mem::replace(conn, placeholder));

    match attach_restored(wattle_dir) {
        Ok(restored) => {
            *conn = restored;
            finish_commit(wattle_dir).ok();
            Ok(())
        }
        Err(error) => {
            let reopened = recover_interrupted_restore(wattle_dir)
                .and_then(|()| crate::db::init_db(wattle_dir));
            match reopened {
                Ok(original) => {
                    *conn = original;
                    Err(failure(RestoreError::ROLLED_BACK, error))
                }
                Err(rollback_error) => {
                    *conn = read_only_fallback(wattle_dir);
                    Err(failure(
                        RestoreError::RESTART_REQUIRED,
                        format!("{error}; {rollback_error}"),
                    ))
                }
            }
        }
    }
}

fn settle_interrupted_restore(conn: &mut Connection, wattle_dir: &Path) -> Result<(), String> {
    if read_state(&restore_root(wattle_dir))?.is_none() {
        return recover_interrupted_restore(wattle_dir);
    }
    let placeholder = Connection::open_in_memory().map_err(|e| e.to_string())?;
    drop(std::mem::replace(conn, placeholder));
    match recover_interrupted_restore(wattle_dir).and_then(|()| crate::db::init_db(wattle_dir)) {
        Ok(reopened) => {
            *conn = reopened;
            Ok(())
        }
        Err(error) => {
            *conn = read_only_fallback(wattle_dir);
            Err(failure(RestoreError::RESTART_REQUIRED, error))
        }
    }
}

fn reject_source_inside(wattle_dir: &Path, source_path: &Path) -> Result<(), String> {
    let (Ok(source), Ok(journal)) = (source_path.canonicalize(), wattle_dir.canonicalize()) else {
        return Ok(());
    };
    let inside_replaced = managed_names()
        .chain([RESTORE_DIR])
        .any(|name| is_same_or_inside(&source, &journal.join(name)));
    if inside_replaced {
        return Err(failure(
            RestoreError::INVALID_ARCHIVE,
            "inside what restoring replaces",
        ));
    }
    Ok(())
}

fn restore_backup_impl(
    conn: &mut Connection,
    wattle_dir: &Path,
    source_path: &Path,
) -> Result<(), String> {
    settle_interrupted_restore(conn, wattle_dir)?;
    reject_source_inside(wattle_dir, source_path)?;

    let root = restore_root(wattle_dir);
    remove_entry(&root).map_err(|e| e.to_string())?;
    let staging = root.join(STAGING_DIR);
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;

    if let Err(error) = stage(source_path, &staging) {
        remove_entry(&root).ok();
        return Err(error);
    }

    replace_journal(conn, wattle_dir)
}

#[tauri::command]
pub fn create_backup(state: State<AppState>, destination_path: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    create_backup_impl(&conn, &state.wattle_dir()?, Path::new(&destination_path))
}

#[tauri::command]
pub fn restore_backup(state: State<AppState>, source_path: String) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    restore_backup_impl(&mut conn, &state.wattle_dir()?, Path::new(&source_path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_backup_mirrors_wattle_dir_into_the_archive() {
        let conn = crate::db::init_db_at_connection_for_test();

        let wattle_dir = std::env::temp_dir().join("wattle_test_backup_source");
        std::fs::create_dir_all(wattle_dir.join("attachments/1")).unwrap();
        std::fs::write(wattle_dir.join("wattle.db"), b"fake-db-bytes").unwrap();
        std::fs::write(wattle_dir.join("attachments/1/2.png"), b"fake-image-bytes").unwrap();

        let destination = std::env::temp_dir().join("wattle_test_backup_output.wattle");

        create_backup_impl(&conn, &wattle_dir, &destination).unwrap();

        let archive_file = File::open(&destination).unwrap();
        let mut archive = zip::ZipArchive::new(archive_file).unwrap();
        let mut names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().unwrap().to_string())
            .collect();
        names.sort();

        assert!(names.contains(&"wattle.db".to_string()));
        assert!(names.contains(&"attachments/1/2.png".to_string()));

        std::fs::remove_dir_all(&wattle_dir).ok();
        std::fs::remove_file(&destination).ok();
    }

    #[test]
    fn a_backup_written_inside_the_attachments_folder_is_refused() {
        let conn = crate::db::init_db_at_connection_for_test();
        let wattle_dir = std::env::temp_dir().join("wattle_test_backup_guard");
        std::fs::create_dir_all(wattle_dir.join("attachments")).unwrap();

        for destination in [
            wattle_dir.join("attachments").join("backup.wattle"),
            wattle_dir
                .join("attachments")
                .join("..")
                .join("attachments")
                .join("backup.wattle"),
        ] {
            let result = create_backup_impl(&conn, &wattle_dir, &destination);
            assert!(
                result.is_err(),
                "a backup inside attachments must be refused: {destination:?}"
            );
            assert!(!destination.exists(), "nothing may be written when refused");
        }

        std::fs::remove_dir_all(&wattle_dir).ok();
    }

    #[test]
    fn backups_kept_in_the_journal_folder_do_not_pile_up_inside_each_other() {
        let conn = crate::db::init_db_at_connection_for_test();
        let wattle_dir = std::env::temp_dir().join("wattle_test_backup_nesting");
        std::fs::create_dir_all(wattle_dir.join("attachments")).unwrap();
        std::fs::write(wattle_dir.join("wattle.db"), b"fake-db-bytes").unwrap();

        let first = wattle_dir.join("wattle-backup-2026-08-17.wattle");
        create_backup_impl(&conn, &wattle_dir, &first).unwrap();
        assert!(first.exists(), "the journal folder is a valid destination");

        let second = wattle_dir.join("wattle-backup-2026-08-18.wattle");
        create_backup_impl(&conn, &wattle_dir, &second).unwrap();

        let mut archive = zip::ZipArchive::new(File::open(&second).unwrap()).unwrap();
        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().unwrap().to_string())
            .collect();

        assert!(
            names.contains(&"wattle.db".to_string()),
            "the journal is in it"
        );
        assert!(
            !names.iter().any(|name| name.ends_with(BACKUP_EXTENSION)),
            "a backup must not contain another backup: {names:?}"
        );

        std::fs::remove_dir_all(&wattle_dir).ok();
    }

    #[test]
    fn a_backup_folder_that_no_longer_exists_is_recreated() {
        let conn = crate::db::init_db_at_connection_for_test();
        let wattle_dir = std::env::temp_dir().join("wattle_test_backup_recreate");
        std::fs::create_dir_all(&wattle_dir).unwrap();

        let destination = std::env::temp_dir()
            .join("wattle_test_backup_recreate_out")
            .join("nested")
            .join("backup.wattle");
        std::fs::remove_dir_all(destination.parent().unwrap()).ok();

        create_backup_impl(&conn, &wattle_dir, &destination).unwrap();
        assert!(destination.exists());

        std::fs::remove_dir_all(&wattle_dir).ok();
        std::fs::remove_dir_all(std::env::temp_dir().join("wattle_test_backup_recreate_out")).ok();
    }

    #[test]
    fn restore_backup_replaces_db_and_attachments_from_a_wattle_archive() {
        let source_dir = std::env::temp_dir().join("wattle_test_restore_source");
        std::fs::create_dir_all(source_dir.join("attachments/1")).unwrap();
        let source_conn = crate::db::init_db(&source_dir).unwrap();
        source_conn
            .execute(
                "INSERT INTO entries (title, entry_date) VALUES ('from backup', '2026-08-15')",
                [],
            )
            .unwrap();
        std::fs::write(source_dir.join("attachments/1/2.png"), b"restored-bytes").unwrap();

        let archive_path = std::env::temp_dir().join("wattle_test_restore_backup.wattle");
        create_backup_impl(&source_conn, &source_dir, &archive_path).unwrap();
        drop(source_conn);

        let target_dir = std::env::temp_dir().join("wattle_test_restore_target");
        std::fs::create_dir_all(&target_dir).unwrap();
        let mut target_conn = crate::db::init_db(&target_dir).unwrap();
        target_conn
            .execute(
                "INSERT INTO entries (title, entry_date) VALUES ('original', '2026-01-01')",
                [],
            )
            .unwrap();

        restore_backup_impl(&mut target_conn, &target_dir, &archive_path).unwrap();

        let titles: Vec<String> = target_conn
            .prepare("SELECT title FROM entries")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(titles, vec!["from backup".to_string()]);
        assert_eq!(
            std::fs::read(target_dir.join("attachments/1/2.png")).unwrap(),
            b"restored-bytes"
        );

        drop(target_conn);
        std::fs::remove_dir_all(&source_dir).ok();
        std::fs::remove_dir_all(&target_dir).ok();
        std::fs::remove_file(&archive_path).ok();
    }

    fn fresh_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(name);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn journal_with_one_entry(name: &str) -> (PathBuf, Connection) {
        let dir = fresh_dir(name);
        std::fs::create_dir_all(dir.join("attachments/1")).unwrap();
        let conn = crate::db::init_db(&dir).unwrap();
        conn.execute(
            "INSERT INTO entries (title, entry_date) VALUES ('original', '2026-01-01')",
            [],
        )
        .unwrap();
        std::fs::write(dir.join("attachments/1/2.png"), b"original-bytes").unwrap();
        (dir, conn)
    }

    fn assert_journal_intact(conn: &Connection, dir: &Path) {
        let titles: Vec<String> = conn
            .prepare("SELECT title FROM entries")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(titles, vec!["original".to_string()]);
        assert_eq!(
            std::fs::read(dir.join("attachments/1/2.png")).unwrap(),
            b"original-bytes"
        );
        assert!(!restore_root(dir).exists(), "nothing may be left staged");
        conn.execute(
            "INSERT INTO entries (title, entry_date) VALUES ('still writable', '2026-01-02')",
            [],
        )
        .unwrap();
    }

    fn database_bytes(name: &str, prepare: impl FnOnce(&Connection)) -> Vec<u8> {
        let dir = fresh_dir(name);
        let conn = crate::db::init_db(&dir).unwrap();
        prepare(&conn);
        conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_row| Ok(()))
            .unwrap();
        drop(conn);
        let bytes = std::fs::read(dir.join("wattle.db")).unwrap();
        std::fs::remove_dir_all(&dir).ok();
        bytes
    }

    fn archive_of(name: &str, entries: &[(&str, &[u8])]) -> PathBuf {
        let path = std::env::temp_dir().join(name);
        let mut zip = ZipWriter::new(File::create(&path).unwrap());
        for (entry, bytes) in entries {
            zip.start_file(*entry, SimpleFileOptions::default())
                .unwrap();
            std::io::Write::write_all(&mut zip, bytes).unwrap();
        }
        zip.finish().unwrap();
        path
    }

    fn refused_restore(name: &str, archive: &Path) -> String {
        let (dir, mut conn) = journal_with_one_entry(name);
        let error = restore_backup_impl(&mut conn, &dir, archive).unwrap_err();
        assert_journal_intact(&conn, &dir);
        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_file(archive).ok();
        error
    }

    #[test]
    fn a_file_that_is_not_an_archive_leaves_the_journal_alone() {
        let source = std::env::temp_dir().join("wattle_test_restore_not_zip.wattle");
        std::fs::write(&source, b"this is not a zip archive").unwrap();
        let error = refused_restore("wattle_test_restore_not_zip", &source);
        assert!(error.starts_with(RestoreError::INVALID_ARCHIVE), "{error}");
    }

    #[test]
    fn a_truncated_archive_leaves_the_journal_alone() {
        let database = database_bytes("wattle_test_restore_truncated_db", |_conn| {});
        let source = archive_of(
            "wattle_test_restore_truncated.wattle",
            &[("wattle.db", &database)],
        );
        let bytes = std::fs::read(&source).unwrap();
        std::fs::write(&source, &bytes[..bytes.len() / 2]).unwrap();
        let error = refused_restore("wattle_test_restore_truncated", &source);
        assert!(error.starts_with(RestoreError::INVALID_ARCHIVE), "{error}");
    }

    #[test]
    fn an_archive_without_a_database_leaves_the_journal_alone() {
        let source = archive_of(
            "wattle_test_restore_no_db.wattle",
            &[("attachments/1/2.png", b"other-bytes")],
        );
        let error = refused_restore("wattle_test_restore_no_db", &source);
        assert_eq!(error, RestoreError::MISSING_DATABASE);
    }

    #[test]
    fn a_database_that_is_not_sqlite_leaves_the_journal_alone() {
        let source = archive_of(
            "wattle_test_restore_garbage_db.wattle",
            &[(
                "wattle.db",
                b"definitely not a database file at all, not even close",
            )],
        );
        let error = refused_restore("wattle_test_restore_garbage_db", &source);
        assert!(error.starts_with(RestoreError::INVALID_DATABASE), "{error}");
    }

    #[test]
    fn a_database_that_is_not_a_journal_leaves_the_journal_alone() {
        let dir = fresh_dir("wattle_test_restore_foreign_db_source");
        let foreign = Connection::open(dir.join("foreign.db")).unwrap();
        foreign
            .execute_batch("CREATE TABLE other (x INTEGER)")
            .unwrap();
        drop(foreign);
        let database = std::fs::read(dir.join("foreign.db")).unwrap();
        std::fs::remove_dir_all(&dir).ok();

        let source = archive_of(
            "wattle_test_restore_foreign_db.wattle",
            &[("wattle.db", &database)],
        );
        let error = refused_restore("wattle_test_restore_foreign_db", &source);
        assert!(error.starts_with(RestoreError::INVALID_DATABASE), "{error}");
    }

    #[test]
    fn a_database_from_a_newer_wattle_leaves_the_journal_alone() {
        let database = database_bytes("wattle_test_restore_future_db", |conn| {
            conn.pragma_update(None, "user_version", crate::db::LATEST_VERSION + 1)
                .unwrap();
        });
        let source = archive_of(
            "wattle_test_restore_future.wattle",
            &[("wattle.db", &database)],
        );
        let error = refused_restore("wattle_test_restore_future", &source);
        assert!(error.starts_with(RestoreError::INVALID_DATABASE), "{error}");
    }

    #[test]
    fn hostile_entry_names_are_refused_before_anything_is_written() {
        let database = database_bytes("wattle_test_restore_names_db", |_conn| {});
        for (index, name) in [
            "../escaped.txt",
            "C:/escaped.txt",
            "/escaped.txt",
            "attachments/1/a:b",
            "attachments\\1\\escaped.txt",
            "attachments/1/CON",
            "attachments/../escaped.txt",
            ".wattle-restore/in-progress",
        ]
        .iter()
        .enumerate()
        {
            let source = archive_of(
                &format!("wattle_test_restore_names_{index}.wattle"),
                &[("wattle.db", &database), (name, b"escaped")],
            );
            let error = refused_restore(&format!("wattle_test_restore_names_{index}"), &source);
            assert!(
                error.starts_with(RestoreError::INVALID_ARCHIVE),
                "{name}: {error}"
            );
            assert!(!std::env::temp_dir().join("escaped.txt").exists(), "{name}");
        }
    }

    #[test]
    fn archives_over_the_limits_are_refused() {
        let source = archive_of(
            "wattle_test_restore_limits.wattle",
            &[
                ("wattle.db", b"0123456789"),
                ("attachments/1/1.png", b"0123456789"),
                ("attachments/1/2.png", b"0123456789"),
            ],
        );

        let mut archive = ZipArchive::new(File::open(&source).unwrap()).unwrap();
        let too_few_entries = RestoreLimits {
            max_entries: 2,
            max_bytes: MAX_RESTORE_BYTES,
        };
        let error = validate_archive(&mut archive, &too_few_entries).unwrap_err();
        assert!(error.starts_with(RestoreError::TOO_LARGE), "{error}");

        let too_few_bytes = RestoreLimits {
            max_entries: MAX_RESTORE_ENTRIES,
            max_bytes: 25,
        };
        let error = validate_archive(&mut archive, &too_few_bytes).unwrap_err();
        assert!(error.starts_with(RestoreError::TOO_LARGE), "{error}");

        assert!(validate_archive(&mut archive, &limits_for(0)).is_ok());
        drop(archive);
        std::fs::remove_file(&source).ok();
    }

    #[test]
    fn the_size_limit_scales_with_the_archive_within_its_bounds() {
        const MIB: u64 = 1024 * 1024;
        assert_eq!(limits_for(0).max_bytes, MIN_RESTORE_BYTES);
        assert_eq!(limits_for(100 * MIB).max_bytes, 100 * 100 * MIB);
        assert_eq!(limits_for(GIB).max_bytes, MAX_RESTORE_BYTES);
        assert_eq!(limits_for(u64::MAX).max_bytes, MAX_RESTORE_BYTES);
        assert_eq!(limits_for(0).max_entries, MAX_RESTORE_ENTRIES);
    }

    #[test]
    fn a_database_whose_attachment_rows_point_outside_is_refused() {
        for (index, stored) in ["C:\\Windows\\win.ini", "attachments/../../outside.txt"]
            .iter()
            .enumerate()
        {
            let database = database_bytes(
                &format!("wattle_test_restore_hostile_rows_db_{index}"),
                |conn| {
                    conn.execute(
                        "INSERT INTO entries (id, entry_date) VALUES (1, '2026-08-15')",
                        [],
                    )
                    .unwrap();
                    conn.execute(
                        "INSERT INTO attachments (entry_id, filename, mime_type, size, path) \
                         VALUES (1, 'outside.txt', 'text/plain', 1, ?1)",
                        [stored],
                    )
                    .unwrap();
                },
            );
            let source = archive_of(
                &format!("wattle_test_restore_hostile_rows_{index}.wattle"),
                &[("wattle.db", &database)],
            );
            let error = refused_restore(
                &format!("wattle_test_restore_hostile_rows_{index}"),
                &source,
            );
            assert!(
                error.starts_with(RestoreError::INVALID_DATABASE),
                "{stored}: {error}"
            );
        }
    }

    fn inject(failures: &[&str]) {
        INJECTED_FAILURES.with(|injected| {
            *injected.borrow_mut() = failures.iter().map(|failure| failure.to_string()).collect();
        });
    }

    fn archive_from_journal(name: &str, prepare: impl FnOnce(&Path)) -> PathBuf {
        let source_dir = fresh_dir(&format!("{name}_source"));
        std::fs::create_dir_all(source_dir.join("attachments/1")).unwrap();
        std::fs::create_dir_all(source_dir.join("sealed-letters/1")).unwrap();
        let source_conn = crate::db::init_db(&source_dir).unwrap();
        source_conn
            .execute(
                "INSERT INTO entries (title, entry_date) VALUES ('from backup', '2026-08-15')",
                [],
            )
            .unwrap();
        std::fs::write(source_dir.join("attachments/1/2.png"), b"restored-bytes").unwrap();
        std::fs::write(source_dir.join("sealed-letters/1/1"), b"new-sealed").unwrap();
        prepare(&source_dir);
        let archive = std::env::temp_dir().join(format!("{name}.wattle"));
        create_backup_impl(&source_conn, &source_dir, &archive).unwrap();
        drop(source_conn);
        std::fs::remove_dir_all(&source_dir).ok();
        archive
    }

    fn target_journal(name: &str) -> (PathBuf, Connection) {
        let (dir, conn) = journal_with_one_entry(name);
        std::fs::create_dir_all(dir.join("sealed-letters/4")).unwrap();
        std::fs::write(dir.join("sealed-letters/4/4"), b"old-sealed").unwrap();
        (dir, conn)
    }

    fn assert_original_sealed_letters(dir: &Path) {
        assert_eq!(
            std::fs::read(dir.join("sealed-letters/4/4")).unwrap(),
            b"old-sealed"
        );
        assert!(!dir.join("sealed-letters/1").exists());
    }

    fn assert_restored(conn: &Connection, dir: &Path) {
        let titles: Vec<String> = conn
            .prepare("SELECT title FROM entries")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(titles, vec!["from backup".to_string()]);
        assert_eq!(
            std::fs::read(dir.join("attachments/1/2.png")).unwrap(),
            b"restored-bytes"
        );
        assert_eq!(
            std::fs::read(dir.join("sealed-letters/1/1")).unwrap(),
            b"new-sealed"
        );
        assert!(!dir.join("sealed-letters/4").exists());
        assert!(!restore_root(dir).exists(), "nothing may be left staged");
    }

    fn stage_for(dir: &Path, archive: &Path) {
        let root = restore_root(dir);
        std::fs::remove_dir_all(&root).ok();
        std::fs::create_dir_all(root.join(STAGING_DIR)).unwrap();
        stage(archive, &root.join(STAGING_DIR)).unwrap();
    }

    const SWAP_STEPS: [&str; 13] = [
        "write-state:detaching",
        "rename-state:detaching",
        "detach:wattle.db",
        "detach:attachments",
        "detach:sealed-letters",
        "write-state:attaching",
        "rename-state:attaching",
        "attach:wattle.db",
        "attach:attachments",
        "attach:sealed-letters",
        "open:wattle.db",
        "write-state:committed",
        "rename-state:committed",
    ];

    #[test]
    fn a_failure_at_any_step_of_the_swap_rolls_back_to_the_original() {
        let archive = archive_from_journal("wattle_test_swap_failure", |_dir| {});
        for (index, step) in SWAP_STEPS.iter().enumerate() {
            let (dir, mut conn) = target_journal(&format!("wattle_test_swap_failure_{index}"));
            inject(&[step]);
            let error = restore_backup_impl(&mut conn, &dir, &archive).unwrap_err();
            inject(&[]);

            assert!(
                error.starts_with(RestoreError::ROLLED_BACK),
                "{step}: {error}"
            );
            assert_original_sealed_letters(&dir);
            assert_journal_intact(&conn, &dir);

            drop(conn);
            std::fs::remove_dir_all(&dir).ok();
        }
        std::fs::remove_file(&archive).ok();
    }

    #[test]
    fn a_crash_at_any_step_before_the_commit_is_undone_at_the_next_start() {
        let archive = archive_from_journal("wattle_test_swap_crash", |_dir| {});
        for (index, step) in SWAP_STEPS.iter().enumerate() {
            let (dir, conn) = target_journal(&format!("wattle_test_swap_crash_{index}"));
            drop(conn);
            stage_for(&dir, &archive);

            inject(&[step]);
            assert!(attach_restored(&dir).is_err(), "{step}");
            inject(&[]);

            std::fs::create_dir_all(dir.join("attachments")).unwrap();
            recover_interrupted_restore(&dir).unwrap();
            let conn = crate::db::init_db(&dir).unwrap();
            assert_original_sealed_letters(&dir);
            assert_journal_intact(&conn, &dir);

            drop(conn);
            std::fs::remove_dir_all(&dir).ok();
        }
        std::fs::remove_file(&archive).ok();
    }

    #[test]
    fn a_crash_after_the_commit_keeps_the_restored_journal_at_the_next_start() {
        let archive = archive_from_journal("wattle_test_commit_crash", |_dir| {});
        let (dir, conn) = target_journal("wattle_test_commit_crash");
        drop(conn);
        stage_for(&dir, &archive);

        let restored = attach_restored(&dir).unwrap();
        drop(restored);
        assert!(restore_root(&dir).join(PREVIOUS_DIR).exists());

        recover_interrupted_restore(&dir).unwrap();
        let conn = crate::db::init_db(&dir).unwrap();
        assert_restored(&conn, &dir);

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_file(&archive).ok();
    }

    #[test]
    fn a_cleanup_that_fails_after_the_commit_never_rolls_the_restore_back() {
        let archive = archive_from_journal("wattle_test_cleanup_failure", |_dir| {});
        let (dir, mut conn) = target_journal("wattle_test_cleanup_failure");

        inject(&["finish:previous"]);
        restore_backup_impl(&mut conn, &dir, &archive).unwrap();
        recover_interrupted_restore(&dir).unwrap_err();
        inject(&[]);

        let root = restore_root(&dir);
        assert_eq!(
            read_state(&root).unwrap().map(|state| state.phase),
            Some(Phase::Committed)
        );
        std::fs::remove_file(root.join(PREVIOUS_DIR).join(DATABASE_NAME)).unwrap();
        std::fs::remove_dir_all(root.join(PREVIOUS_DIR).join("attachments")).unwrap();

        drop(conn);
        recover_interrupted_restore(&dir).unwrap();
        let conn = crate::db::init_db(&dir).unwrap();
        assert_restored(&conn, &dir);

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_file(&archive).ok();
    }

    #[test]
    fn a_recovery_that_fails_partway_can_be_resumed() {
        let archive = archive_from_journal("wattle_test_recovery_resume", |_dir| {});
        for (index, recovery_step) in [
            "discard:wattle.db",
            "discard:sealed-letters",
            "write-state:detaching",
            "rename-state:detaching",
            "reattach:wattle.db",
            "reattach:sealed-letters",
        ]
        .iter()
        .enumerate()
        {
            let (dir, conn) = target_journal(&format!("wattle_test_recovery_resume_{index}"));
            drop(conn);
            stage_for(&dir, &archive);

            inject(&["attach:attachments"]);
            assert!(attach_restored(&dir).is_err());
            inject(&[recovery_step]);
            assert!(
                recover_interrupted_restore(&dir).is_err(),
                "{recovery_step}"
            );
            inject(&[]);

            recover_interrupted_restore(&dir).unwrap();
            let conn = crate::db::init_db(&dir).unwrap();
            assert_original_sealed_letters(&dir);
            assert_journal_intact(&conn, &dir);

            drop(conn);
            std::fs::remove_dir_all(&dir).ok();
        }
        std::fs::remove_file(&archive).ok();
    }

    #[test]
    fn a_state_file_that_cannot_be_written_stops_the_restore_before_anything_moves() {
        let archive = archive_from_journal("wattle_test_state_unwritable", |_dir| {});
        let (dir, mut conn) = target_journal("wattle_test_state_unwritable");
        stage_for(&dir, &archive);
        std::fs::create_dir_all(restore_root(&dir).join(STATE_TEMP_FILE).join("blocked")).unwrap();

        let error = replace_journal(&mut conn, &dir).unwrap_err();

        assert!(error.starts_with(RestoreError::ROLLED_BACK), "{error}");
        assert_original_sealed_letters(&dir);
        assert_journal_intact(&conn, &dir);
        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_file(&archive).ok();
    }

    #[test]
    fn a_rollback_that_cannot_finish_reads_the_original_and_recovers_on_retry() {
        let archive = archive_from_journal("wattle_test_read_only_fallback", |_dir| {});
        let (dir, mut conn) = target_journal("wattle_test_read_only_fallback");

        inject(&["attach:attachments", "reattach:wattle.db"]);
        let error = restore_backup_impl(&mut conn, &dir, &archive).unwrap_err();
        inject(&[]);

        assert!(error.starts_with(RestoreError::RESTART_REQUIRED), "{error}");
        let titles: Vec<String> = conn
            .prepare("SELECT title FROM entries")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            titles,
            vec!["original".to_string()],
            "the original is still readable"
        );
        assert!(
            conn.execute(
                "INSERT INTO entries (title, entry_date) VALUES ('lost', '2026-01-03')",
                [],
            )
            .is_err(),
            "the fallback must refuse writes"
        );

        restore_backup_impl(&mut conn, &dir, &archive).unwrap();
        assert_restored(&conn, &dir);

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_file(&archive).ok();
    }

    #[test]
    fn a_fallback_before_the_commit_prefers_the_original_over_the_restored_copy() {
        let archive = archive_from_journal("wattle_test_fallback_original", |_dir| {});
        let (dir, mut conn) = target_journal("wattle_test_fallback_original");

        inject(&["open:wattle.db", "discard:wattle.db"]);
        let error = restore_backup_impl(&mut conn, &dir, &archive).unwrap_err();
        inject(&[]);

        assert!(error.starts_with(RestoreError::RESTART_REQUIRED), "{error}");
        assert!(
            dir.join("wattle.db").is_file(),
            "the restored copy is still in place"
        );
        let title: String = conn
            .query_row("SELECT title FROM entries", [], |row| row.get(0))
            .unwrap();
        assert_eq!(title, "original");

        restore_backup_impl(&mut conn, &dir, &archive).unwrap();
        assert_restored(&conn, &dir);

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_file(&archive).ok();
    }

    #[test]
    fn a_fallback_after_the_commit_prefers_the_restored_journal() {
        let archive = archive_from_journal("wattle_test_fallback_committed", |_dir| {});
        let (dir, mut conn) = target_journal("wattle_test_fallback_committed");

        inject(&["finish:previous"]);
        restore_backup_impl(&mut conn, &dir, &archive).unwrap();
        let error = restore_backup_impl(&mut conn, &dir, &archive).unwrap_err();
        inject(&[]);

        assert!(error.starts_with(RestoreError::RESTART_REQUIRED), "{error}");
        assert!(restore_root(&dir)
            .join(PREVIOUS_DIR)
            .join("wattle.db")
            .is_file());
        let title: String = conn
            .query_row("SELECT title FROM entries", [], |row| row.get(0))
            .unwrap();
        assert_eq!(title, "from backup");

        drop(conn);
        recover_interrupted_restore(&dir).unwrap();
        let conn = crate::db::init_db(&dir).unwrap();
        assert_restored(&conn, &dir);

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_file(&archive).ok();
    }

    #[test]
    fn a_retry_after_a_failed_rollback_puts_the_original_back_first() {
        let archive = archive_from_journal("wattle_test_retry_settles", |_dir| {});
        let (dir, mut conn) = target_journal("wattle_test_retry_settles");

        inject(&["attach:attachments", "reattach:wattle.db"]);
        restore_backup_impl(&mut conn, &dir, &archive).unwrap_err();
        inject(&[]);

        let missing = std::env::temp_dir().join("wattle_test_retry_settles_missing.wattle");
        assert!(restore_backup_impl(&mut conn, &dir, &missing).is_err());
        assert_original_sealed_letters(&dir);
        assert_journal_intact(&conn, &dir);

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_file(&archive).ok();
    }

    #[test]
    fn an_unreadable_state_is_never_guessed_at() {
        let (dir, conn) = journal_with_one_entry("wattle_test_unreadable_state");
        drop(conn);
        let root = restore_root(&dir);
        let previous = root.join(PREVIOUS_DIR);
        std::fs::create_dir_all(&previous).unwrap();
        std::fs::write(previous.join("wattle.db-shm"), b"kept").unwrap();

        for state in ["", "rewinding\nwattle.db", "detaching\nnotes.txt"] {
            std::fs::write(root.join(STATE_FILE), state).unwrap();
            let error = recover_interrupted_restore(&dir).unwrap_err();
            assert!(
                error.starts_with(RestoreError::UNREADABLE_STATE),
                "{state:?}: {error}"
            );
            assert_eq!(
                std::fs::read(previous.join("wattle.db-shm")).unwrap(),
                b"kept"
            );
        }

        std::fs::remove_file(root.join(STATE_FILE)).unwrap();
        let error = recover_interrupted_restore(&dir).unwrap_err();
        assert!(error.starts_with(RestoreError::UNREADABLE_STATE), "{error}");
        assert_eq!(
            std::fs::read(previous.join("wattle.db-shm")).unwrap(),
            b"kept"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_rollback_with_an_original_missing_deletes_nothing() {
        let archive = archive_from_journal("wattle_test_missing_original", |_dir| {});
        let (dir, conn) = target_journal("wattle_test_missing_original");
        drop(conn);
        stage_for(&dir, &archive);

        inject(&["attach:attachments"]);
        assert!(attach_restored(&dir).is_err());
        inject(&[]);
        let previous = restore_root(&dir).join(PREVIOUS_DIR);
        std::fs::remove_dir_all(previous.join("sealed-letters")).unwrap();

        let error = recover_interrupted_restore(&dir).unwrap_err();
        assert!(error.starts_with(RestoreError::INCOMPLETE), "{error}");
        assert!(
            dir.join("wattle.db").is_file(),
            "the restored database must survive"
        );
        assert!(
            previous.join("wattle.db").is_file(),
            "the original database must survive"
        );
        assert!(previous.join("attachments/1/2.png").is_file());

        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_file(&archive).ok();
    }

    #[test]
    fn a_committed_state_without_a_journal_keeps_the_original() {
        let archive = archive_from_journal("wattle_test_committed_missing", |_dir| {});
        let (dir, conn) = target_journal("wattle_test_committed_missing");
        drop(conn);
        stage_for(&dir, &archive);
        drop(attach_restored(&dir).unwrap());
        std::fs::remove_file(dir.join("wattle.db")).unwrap();

        let error = recover_interrupted_restore(&dir).unwrap_err();
        assert!(error.starts_with(RestoreError::INCOMPLETE), "{error}");
        assert!(restore_root(&dir)
            .join(PREVIOUS_DIR)
            .join("wattle.db")
            .is_file());

        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_file(&archive).ok();
    }

    #[test]
    fn a_leftover_restore_folder_without_a_state_is_simply_cleared() {
        let (dir, conn) = journal_with_one_entry("wattle_test_restore_leftover");
        std::fs::create_dir_all(restore_root(&dir).join(STAGING_DIR).join("attachments")).unwrap();
        std::fs::write(restore_root(&dir).join(STATE_TEMP_FILE), b"detaching").unwrap();

        recover_interrupted_restore(&dir).unwrap();

        assert_journal_intact(&conn, &dir);
        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn backups_in_a_subfolder_survive_restore() {
        let (dir, mut conn) = target_journal("wattle_test_restore_nested_backups");
        let backups = dir.join("backups");
        std::fs::create_dir_all(&backups).unwrap();
        std::fs::write(backups.join("wattle-backup-2026-08-01.wattle"), b"older").unwrap();
        let archive = backups.join("wattle-backup-2026-09-01.wattle");
        let built = archive_from_journal("wattle_test_restore_nested_backups_archive", |source| {
            std::fs::create_dir_all(source.join("backups")).unwrap();
            std::fs::write(source.join("backups/notes.txt"), b"theirs").unwrap();
        });
        std::fs::rename(&built, &archive).unwrap();
        let archive_bytes = std::fs::read(&archive).unwrap();

        restore_backup_impl(&mut conn, &dir, &archive).unwrap();

        assert_restored(&conn, &dir);
        assert_eq!(std::fs::read(&archive).unwrap(), archive_bytes);
        assert_eq!(
            std::fs::read(backups.join("wattle-backup-2026-08-01.wattle")).unwrap(),
            b"older"
        );
        assert!(!backups.join("notes.txt").exists());

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn everything_outside_the_managed_set_survives_restore_unchanged() {
        let (dir, mut conn) = target_journal("wattle_test_restore_user_files");
        std::fs::create_dir_all(dir.join("notes")).unwrap();
        std::fs::write(dir.join("notes/today.txt"), b"mine").unwrap();
        std::fs::write(dir.join("readme.txt"), b"mine").unwrap();
        std::fs::write(dir.join("wattle.db.pre-v3.bak"), b"snapshot").unwrap();
        let archive = archive_from_journal("wattle_test_restore_user_files_archive", |source| {
            std::fs::create_dir_all(source.join("notes")).unwrap();
            std::fs::write(source.join("notes/today.txt"), b"theirs").unwrap();
            std::fs::write(source.join("notes/other.txt"), b"theirs").unwrap();
            std::fs::write(source.join("readme.txt"), b"theirs").unwrap();
            std::fs::write(source.join("wattle.db.pre-v3.bak"), b"their snapshot").unwrap();
            std::fs::create_dir_all(source.join("extra-folder")).unwrap();
            std::fs::write(source.join("extra-folder/x.txt"), b"theirs").unwrap();
        });

        restore_backup_impl(&mut conn, &dir, &archive).unwrap();

        assert_restored(&conn, &dir);
        assert_eq!(std::fs::read(dir.join("notes/today.txt")).unwrap(), b"mine");
        assert!(!dir.join("notes/other.txt").exists());
        assert_eq!(std::fs::read(dir.join("readme.txt")).unwrap(), b"mine");
        assert_eq!(
            std::fs::read(dir.join("wattle.db.pre-v3.bak")).unwrap(),
            b"snapshot"
        );
        assert!(!dir.join("extra-folder").exists());

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_file(&archive).ok();
    }

    #[test]
    fn an_archive_whose_managed_entries_have_the_wrong_shape_is_refused() {
        let database = database_bytes("wattle_test_restore_shape_db", |_conn| {});
        for (index, entries) in [
            vec![
                ("wattle.db", database.as_slice()),
                ("attachments", b"a file".as_slice()),
            ],
            vec![
                ("wattle.db", database.as_slice()),
                ("sealed-letters", b"a file".as_slice()),
            ],
            vec![
                ("wattle.db", database.as_slice()),
                ("wattle.db-wal/x", b"nested".as_slice()),
            ],
        ]
        .iter()
        .enumerate()
        {
            let source = archive_of(
                &format!("wattle_test_restore_shape_{index}.wattle"),
                entries,
            );
            let error = refused_restore(&format!("wattle_test_restore_shape_{index}"), &source);
            assert!(
                error.starts_with(RestoreError::INVALID_ARCHIVE),
                "{index}: {error}"
            );
        }
    }

    #[test]
    fn a_source_inside_what_restore_replaces_is_refused() {
        let archive = archive_from_journal("wattle_test_restore_source_inside", |_dir| {});
        for (index, folder) in ["attachments", "sealed-letters", "attachments/1"]
            .iter()
            .enumerate()
        {
            let (dir, mut conn) =
                journal_with_one_entry(&format!("wattle_test_restore_source_inside_{index}"));
            std::fs::create_dir_all(dir.join(folder)).unwrap();
            let inside = dir.join(folder).join("kept.wattle");
            std::fs::copy(&archive, &inside).unwrap();

            let error = restore_backup_impl(&mut conn, &dir, &inside).unwrap_err();

            assert!(
                error.starts_with(RestoreError::INVALID_ARCHIVE),
                "{folder}: {error}"
            );
            assert!(inside.is_file(), "{folder}");
            assert_journal_intact(&conn, &dir);
            drop(conn);
            std::fs::remove_dir_all(&dir).ok();
        }
        std::fs::remove_file(&archive).ok();
    }

    #[test]
    fn a_backup_is_never_written_inside_what_restore_replaces() {
        let conn = crate::db::init_db_at_connection_for_test();
        let wattle_dir = fresh_dir("wattle_test_backup_destinations");
        std::fs::create_dir_all(wattle_dir.join("attachments")).unwrap();
        std::fs::create_dir_all(wattle_dir.join("sealed-letters")).unwrap();
        std::fs::write(wattle_dir.join("wattle.db"), b"the journal").unwrap();

        for destination in [
            "attachments/backup.wattle",
            "ATTACHMENTS/backup.wattle",
            "sealed-letters/backup.wattle",
            "Sealed-Letters/nested/backup.wattle",
            "wattle.db",
            "WATTLE.DB",
            "wattle.db-wal",
            "wattle.db-shm",
            ".wattle-restore/backup.wattle",
            ".wattle-restore/previous/backup.wattle",
            ".wattle-restore/previous/nested/backup.wattle",
            "attachments/nested/backup.wattle",
        ] {
            let path = wattle_dir.join(destination);
            assert!(
                create_backup_impl(&conn, &wattle_dir, &path).is_err(),
                "{destination}"
            );
            if !destination.to_ascii_lowercase().starts_with("wattle.db") {
                assert!(!path.exists(), "{destination}");
            }
        }
        assert_eq!(
            std::fs::read(wattle_dir.join("wattle.db")).unwrap(),
            b"the journal"
        );
        assert!(
            !restore_root(&wattle_dir).exists(),
            "a refused backup creates nothing"
        );
        assert!(!wattle_dir.join("sealed-letters/nested").exists());
        assert!(!wattle_dir.join("attachments/nested").exists());
        recover_interrupted_restore(&wattle_dir).unwrap();

        let allowed = wattle_dir.join("backups").join("backup.wattle");
        create_backup_impl(&conn, &wattle_dir, &allowed).unwrap();
        assert!(allowed.is_file());

        std::fs::remove_dir_all(&wattle_dir).ok();
    }

    #[test]
    fn backups_are_left_out_of_a_backup_whatever_their_case() {
        let conn = crate::db::init_db_at_connection_for_test();
        let wattle_dir = fresh_dir("wattle_test_backup_case");
        std::fs::write(wattle_dir.join("wattle.db"), b"fake-db-bytes").unwrap();
        for name in [
            "wattle-backup-2026-08-01.wattle",
            "WATTLE-BACKUP-2026-08-02.WATTLE",
            "Wattle-Backup-2026-08-03.Wattle",
        ] {
            std::fs::write(wattle_dir.join(name), b"a backup").unwrap();
        }

        let destination = std::env::temp_dir().join("wattle_test_backup_case.wattle");
        create_backup_impl(&conn, &wattle_dir, &destination).unwrap();

        let mut archive = ZipArchive::new(File::open(&destination).unwrap()).unwrap();
        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().unwrap().to_string())
            .collect();
        assert!(names.contains(&"wattle.db".to_string()));
        assert!(
            !names
                .iter()
                .any(|name| name.to_ascii_lowercase().ends_with(BACKUP_EXTENSION)),
            "{names:?}"
        );

        drop(archive);
        std::fs::remove_dir_all(&wattle_dir).ok();
        std::fs::remove_file(&destination).ok();
    }

    #[test]
    fn restoring_keeps_backups_in_the_journal_folder_and_replaces_sealed_letters() {
        let source_dir = fresh_dir("wattle_test_restore_keeps_source");
        std::fs::create_dir_all(source_dir.join("attachments/1")).unwrap();
        std::fs::create_dir_all(source_dir.join("sealed-letters/1")).unwrap();
        let source_conn = crate::db::init_db(&source_dir).unwrap();
        source_conn
            .execute(
                "INSERT INTO entries (title, entry_date) VALUES ('from backup', '2026-08-15')",
                [],
            )
            .unwrap();
        std::fs::write(source_dir.join("attachments/1/2.png"), b"restored-bytes").unwrap();
        std::fs::write(source_dir.join("sealed-letters/1/1"), b"new-sealed").unwrap();

        let (target_dir, mut target_conn) =
            journal_with_one_entry("wattle_test_restore_keeps_target");
        std::fs::create_dir_all(target_dir.join("sealed-letters/9")).unwrap();
        std::fs::write(target_dir.join("sealed-letters/9/9"), b"stale-sealed").unwrap();
        std::fs::write(target_dir.join("my-other.wattle"), b"another backup").unwrap();
        let archive = target_dir.join("wattle-backup-2026-09-01.wattle");
        create_backup_impl(&source_conn, &source_dir, &archive).unwrap();
        drop(source_conn);

        restore_backup_impl(&mut target_conn, &target_dir, &archive).unwrap();

        let titles: Vec<String> = target_conn
            .prepare("SELECT title FROM entries")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(titles, vec!["from backup".to_string()]);
        assert_eq!(
            std::fs::read(target_dir.join("attachments/1/2.png")).unwrap(),
            b"restored-bytes"
        );
        assert_eq!(
            std::fs::read(target_dir.join("sealed-letters/1/1")).unwrap(),
            b"new-sealed"
        );
        assert!(!target_dir.join("sealed-letters/9").exists());
        assert!(archive.is_file(), "the backup restored from must survive");
        assert_eq!(
            std::fs::read(target_dir.join("my-other.wattle")).unwrap(),
            b"another backup"
        );
        assert!(!restore_root(&target_dir).exists());

        drop(target_conn);
        std::fs::remove_dir_all(&source_dir).ok();
        std::fs::remove_dir_all(&target_dir).ok();
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
    fn a_backup_leaves_out_restore_leftovers_and_links() {
        let conn = crate::db::init_db_at_connection_for_test();
        let wattle_dir = fresh_dir("wattle_test_backup_skips");
        let outside = fresh_dir("wattle_test_backup_skips_outside");
        std::fs::write(outside.join("secret.txt"), b"not the journal's").unwrap();
        std::fs::write(wattle_dir.join("wattle.db"), b"fake-db-bytes").unwrap();
        std::fs::create_dir_all(wattle_dir.join("attachments")).unwrap();
        std::fs::create_dir_all(restore_root(&wattle_dir).join(STAGING_DIR)).unwrap();
        std::fs::write(
            restore_root(&wattle_dir).join(STAGING_DIR).join("leftover"),
            b"x",
        )
        .unwrap();
        let linked = link_dir(&wattle_dir.join("attachments").join("linked"), &outside);
        assert!(linked || !cfg!(windows), "a junction could not be created");

        let destination = std::env::temp_dir().join("wattle_test_backup_skips.wattle");
        create_backup_impl(&conn, &wattle_dir, &destination).unwrap();

        let mut archive = ZipArchive::new(File::open(&destination).unwrap()).unwrap();
        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().unwrap().to_string())
            .collect();
        assert!(names.contains(&"wattle.db".to_string()));
        assert!(
            !names.iter().any(|name| name.starts_with(RESTORE_DIR)),
            "{names:?}"
        );
        if linked {
            assert!(
                !names.iter().any(|name| name.contains("linked")),
                "{names:?}"
            );
        }

        drop(archive);
        std::fs::remove_dir(wattle_dir.join("attachments").join("linked")).ok();
        std::fs::remove_dir_all(&wattle_dir).ok();
        std::fs::remove_dir_all(&outside).ok();
        std::fs::remove_file(&destination).ok();
    }
}
