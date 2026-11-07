use std::path::{Path, PathBuf};

use rusqlite::{Connection, Transaction};

const SCHEMA: &str = r#"
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL DEFAULT '',
  content      TEXT NOT NULL DEFAULT '{"type":"doc","content":[]}',
  content_text TEXT NOT NULL DEFAULT '',
  preview      TEXT NOT NULL DEFAULT '',
  word_count   INTEGER NOT NULL DEFAULT 0,
  kind         TEXT NOT NULL DEFAULT 'entry' CHECK (kind IN ('entry','spark')),
  entry_date   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_entries_entry_date ON entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_entries_kind_date ON entries(kind, entry_date DESC);

CREATE TABLE IF NOT EXISTS attachments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id    INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size        INTEGER NOT NULL,
  path        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_attachments_entry_id ON attachments(entry_id);

CREATE TABLE IF NOT EXISTS settings (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  language    TEXT NOT NULL DEFAULT 'en',
  theme       TEXT NOT NULL DEFAULT 'light',
  version     TEXT NOT NULL DEFAULT '',
  zoom_level  REAL NOT NULL DEFAULT 1,
  navigation  TEXT NOT NULL DEFAULT 'both',
  on_this_day INTEGER NOT NULL DEFAULT 1,
  ai_enabled  INTEGER NOT NULL DEFAULT 0,
  ai_model    TEXT NOT NULL DEFAULT '',
  spark_echo  INTEGER NOT NULL DEFAULT 1,
  entry_lock  INTEGER NOT NULL DEFAULT 1,
  layout_width TEXT NOT NULL DEFAULT 'default',
  accent      TEXT NOT NULL DEFAULT 'wattle',
  palette     TEXT NOT NULL DEFAULT 'wattle',
  onboarded   INTEGER NOT NULL DEFAULT 0,
  backup_dir  TEXT NOT NULL DEFAULT '',
  editor_scale TEXT NOT NULL DEFAULT 'default',
  tours_seen  TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS profile (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  name        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
"#;

/// Where similarity is kept.
const EMBEDDING_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS entry_embeddings (
  entry_id          INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  embedding         BLOB NOT NULL,
  model             TEXT NOT NULL,
  dim               INTEGER NOT NULL,
  source_updated_at TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
"#;

/// Where a deleted page waits before it is really gone.
const TRASH_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS deleted_entries (
  id           INTEGER PRIMARY KEY,
  title        TEXT NOT NULL DEFAULT '',
  content      TEXT NOT NULL DEFAULT '{"type":"doc","content":[]}',
  content_text TEXT NOT NULL DEFAULT '',
  preview      TEXT NOT NULL DEFAULT '',
  word_count   INTEGER NOT NULL DEFAULT 0,
  kind         TEXT NOT NULL DEFAULT 'entry',
  entry_date   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_deleted_entries_deleted_at
  ON deleted_entries(deleted_at DESC);

CREATE TABLE IF NOT EXISTS deleted_attachments (
  id          INTEGER PRIMARY KEY,
  entry_id    INTEGER NOT NULL REFERENCES deleted_entries(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size        INTEGER NOT NULL,
  path        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deleted_attachments_entry_id
  ON deleted_attachments(entry_id);
"#;

/// Where letters to a future self live.
const LETTERS_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS letters (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 'draft' | 'sealed'.
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sealed')),

  -- The draft, as Tiptap JSON - the same representation `entries.content` uses,
  -- so the exporters work on an opened letter with no new code. Emptied at the
  -- moment of sealing and never written again.
  content       TEXT NOT NULL DEFAULT '',

  -- The sealed letter. NULL while drafting; set once, and immutable after.
  ciphertext    BLOB,
  nonce         BLOB,
  algorithm     TEXT NOT NULL DEFAULT '',
  envelope      INTEGER NOT NULL DEFAULT 0,

  -- The day it was written and the day it may be read. Plain calendar dates,
  -- never timestamps: a letter is addressed to a day, not to an instant.
  written_on    TEXT NOT NULL,
  unlock_on     TEXT,

  -- Instants, for the record and for the associated data the seal is bound to.
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  sealed_at     TEXT,
  opened_at     TEXT,

  -- Kept in the clear so the waiting card can say something true without
  -- saying anything private. It reveals length and nothing else.
  word_count    INTEGER NOT NULL DEFAULT 0,

  -- Which writing direction this letter started from, or ''. The id of a
  -- template, never the model's words.
  prompt_id     TEXT NOT NULL DEFAULT '',

  -- A draft may exist before a date has been chosen. A sealed letter may not:
  -- its unlock date is bound into the seal, and a NULL there would be a letter
  -- nothing could ever open.
  CHECK (status <> 'sealed' OR unlock_on IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_letters_unlock ON letters(unlock_on);
CREATE INDEX IF NOT EXISTS idx_letters_status ON letters(status, unlock_on);

-- Separate from `letters` on purpose: the code that reads ciphertext and the
-- code that reads keys are then different paths, and only one function in the
-- whole application touches both.
CREATE TABLE IF NOT EXISTS letter_keys (
  letter_id INTEGER PRIMARY KEY REFERENCES letters(id) ON DELETE CASCADE,
  key       BLOB NOT NULL
);
"#;

/// A letter's own attachments.
const LETTER_ATTACHMENT_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS letter_attachments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  letter_id   INTEGER NOT NULL REFERENCES letters(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size        INTEGER NOT NULL,

  -- Where the readable file is, or '' while the letter is sealed.
  path        TEXT NOT NULL DEFAULT '',

  -- 24 bytes, set at sealing and cleared at opening. NULL means the file is
  -- in the clear; non-NULL means it is not, and this is what it was closed
  -- with.
  nonce       BLOB,

  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_letter_attachments_letter
  ON letter_attachments(letter_id);
"#;

/// The search index for letters that have been **opened**.
const LETTERS_SEARCH_SCHEMA: &str = r#"
CREATE VIRTUAL TABLE IF NOT EXISTS letters_fts USING fts5(
  content_text,
  tokenize = "unicode61 remove_diacritics 2",
  prefix = '2 3'
);
"#;

/// The search index and the triggers that keep it in step with `entries`.
const SEARCH_SCHEMA: &str = r#"
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  title,
  content_text,
  tokenize = "unicode61 remove_diacritics 2",
  prefix = '2 3'
);

CREATE TRIGGER IF NOT EXISTS entries_fts_after_insert AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts (rowid, title, content_text)
  VALUES (new.id, new.title, new.content_text);
END;

CREATE TRIGGER IF NOT EXISTS entries_fts_after_delete AFTER DELETE ON entries BEGIN
  DELETE FROM entries_fts WHERE rowid = old.id;
END;

CREATE TRIGGER IF NOT EXISTS entries_fts_after_update AFTER UPDATE ON entries BEGIN
  DELETE FROM entries_fts WHERE rowid = old.id;
  INSERT INTO entries_fts (rowid, title, content_text)
  VALUES (new.id, new.title, new.content_text);
END;
"#;

/// A migration brings the database from version `index` to version `index + 1`.
type Migration = fn(&Transaction, &Path) -> Result<(), String>;

/// The ordered migration list: index `n` migrates `user_version = n` to `n + 1`.
const MIGRATIONS: &[Migration] = &[
    migration_1_baseline,
    migration_2_derived_content,
    migration_3_search_index,
    migration_4_quarantine_orphans,
    migration_5_repair_entry_dates,
    migration_6_on_this_day_setting,
    migration_7_entry_kind,
    migration_8_ai_settings,
    migration_9_spark_echo_setting,
    migration_10_appearance_settings,
    migration_11_onboarding_and_tours,
    migration_12_unused,
    migration_13_entry_embeddings,
    migration_14_letters,
    migration_15_letters_search,
    migration_16_letter_attachments,
    migration_17_palette,
    migration_18_trash_and_editor_scale,
];

/// The version a database reaches once every migration has been applied.
pub const LATEST_VERSION: i32 = MIGRATIONS.len() as i32;

#[derive(Debug)]
pub enum MigrationError {
    /// The database was written by a newer Wattle than this binary.
    FutureVersion {
        found: i32,
        supported: i32,
    },
    Failed(String),
}

impl std::fmt::Display for MigrationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::FutureVersion { found, supported } => write!(
                f,
                "This journal was created by a newer version of Wattle (database version {found}, this version supports {supported}). Update Wattle, or restore a backup."
            ),
            Self::Failed(message) => write!(f, "Migration failed: {message}"),
        }
    }
}

impl std::error::Error for MigrationError {}

impl From<String> for MigrationError {
    fn from(message: String) -> Self {
        Self::Failed(message)
    }
}

/// Ensures `settings.navigation` exists.
fn migration_1_baseline(tx: &Transaction, _wattle_dir: &Path) -> Result<(), String> {
    if tx.prepare("SELECT navigation FROM settings").is_err() {
        tx.execute(
            "ALTER TABLE settings ADD COLUMN navigation TEXT NOT NULL DEFAULT 'both'",
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Adds the columns derived from an entry's content, then fills them in for
/// every entry already written.
fn migration_2_derived_content(tx: &Transaction, _wattle_dir: &Path) -> Result<(), String> {
    for (column, definition) in [
        ("content_text", "TEXT NOT NULL DEFAULT ''"),
        ("preview", "TEXT NOT NULL DEFAULT ''"),
        ("word_count", "INTEGER NOT NULL DEFAULT 0"),
    ] {
        if !column_exists(tx, "entries", column) {
            tx.execute(
                &format!("ALTER TABLE entries ADD COLUMN {column} {definition}"),
                [],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    let documents: Vec<(i64, String)> = {
        let mut stmt = tx
            .prepare("SELECT id, content FROM entries")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    for (id, content) in documents {
        let derived = crate::content::derive(&content);
        tx.execute(
            "UPDATE entries SET content_text = ?1, preview = ?2, word_count = ?3 WHERE id = ?4",
            rusqlite::params![derived.text, derived.preview, derived.word_count, id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Cheapest reliable column probe: ask for it and see whether SQLite objects.
fn column_exists(tx: &Transaction, table: &str, column: &str) -> bool {
    tx.prepare(&format!("SELECT {column} FROM {table}")).is_ok()
}

/// Builds the search index over the text migration 2 derived.
fn migration_3_search_index(tx: &Transaction, _wattle_dir: &Path) -> Result<(), String> {
    tx.execute_batch(SEARCH_SCHEMA).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM entries_fts", [])
        .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO entries_fts (rowid, title, content_text) \
         SELECT id, title, content_text FROM entries",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn user_version(conn: &Connection) -> Result<i32, String> {
    conn.pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|e| e.to_string())
}

fn set_user_version(conn: &Connection, version: i32) -> Result<(), String> {
    conn.pragma_update(None, "user_version", version)
        .map_err(|e| e.to_string())
}

/// True once the database holds real content, as opposed to a file that was
/// just created.
pub(crate) fn is_initialised(conn: &Connection) -> Result<bool, String> {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'entries'",
        [],
        |_row| Ok(()),
    )
    .map(|()| true)
    .or_else(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => Ok(false),
        other => Err(other.to_string()),
    })
}

/// Clears out attachments left behind before the editor started keeping the
/// table in step with the document.
fn migration_4_quarantine_orphans(tx: &Transaction, wattle_dir: &Path) -> Result<(), String> {
    crate::commands::attachments::quarantine_orphans(tx, wattle_dir)?;
    Ok(())
}

/// Repairs entries whose date is not a date.
fn migration_5_repair_entry_dates(tx: &Transaction, _wattle_dir: &Path) -> Result<(), String> {
    tx.execute(
        "UPDATE entries SET entry_date = substr(created_at, 1, 10) \
         WHERE entry_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Adds the switch that turns resurfacing off.
fn migration_6_on_this_day_setting(tx: &Transaction, _wattle_dir: &Path) -> Result<(), String> {
    if !column_exists(tx, "settings", "on_this_day") {
        tx.execute(
            "ALTER TABLE settings ADD COLUMN on_this_day INTEGER NOT NULL DEFAULT 1",
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Marks what kind of writing an entry is.
fn migration_7_entry_kind(tx: &Transaction, _wattle_dir: &Path) -> Result<(), String> {
    if !column_exists(tx, "entries", "kind") {
        tx.execute(
            "ALTER TABLE entries ADD COLUMN kind TEXT NOT NULL DEFAULT 'entry'              CHECK (kind IN ('entry','spark'))",
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute(
        "CREATE INDEX IF NOT EXISTS idx_entries_kind_date ON entries(kind, entry_date DESC)",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Gives AI somewhere to be off.
fn migration_8_ai_settings(tx: &Transaction, _wattle_dir: &Path) -> Result<(), String> {
    if !column_exists(tx, "settings", "ai_enabled") {
        tx.execute(
            "ALTER TABLE settings ADD COLUMN ai_enabled INTEGER NOT NULL DEFAULT 0",
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    if !column_exists(tx, "settings", "ai_model") {
        tx.execute(
            "ALTER TABLE settings ADD COLUMN ai_model TEXT NOT NULL DEFAULT ''",
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Adds the switch that turns the spark echo off.
fn migration_9_spark_echo_setting(tx: &Transaction, _wattle_dir: &Path) -> Result<(), String> {
    if !column_exists(tx, "settings", "spark_echo") {
        tx.execute(
            "ALTER TABLE settings ADD COLUMN spark_echo INTEGER NOT NULL DEFAULT 1",
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Adds how an entry opens, and how the interface is shaped.
fn migration_10_appearance_settings(tx: &Transaction, _wattle_dir: &Path) -> Result<(), String> {
    for (column, definition) in [
        ("entry_lock", "INTEGER NOT NULL DEFAULT 1"),
        ("layout_width", "TEXT NOT NULL DEFAULT 'default'"),
        ("accent", "TEXT NOT NULL DEFAULT 'wattle'"),
    ] {
        if !column_exists(tx, "settings", column) {
            tx.execute(
                &format!("ALTER TABLE settings ADD COLUMN {column} {definition}"),
                [],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Adds onboarding, the backup folder, and which tours have been seen - then
/// declares this journal already onboarded.
fn migration_11_onboarding_and_tours(tx: &Transaction, _wattle_dir: &Path) -> Result<(), String> {
    for (column, definition) in [
        ("onboarded", "INTEGER NOT NULL DEFAULT 0"),
        ("backup_dir", "TEXT NOT NULL DEFAULT ''"),
        ("tours_seen", "TEXT NOT NULL DEFAULT '[]'"),
    ] {
        if !column_exists(tx, "settings", column) {
            tx.execute(
                &format!("ALTER TABLE settings ADD COLUMN {column} {definition}"),
                [],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    tx.execute(
        "INSERT INTO settings (id, onboarded) VALUES (1, 1) \
         ON CONFLICT(id) DO UPDATE SET onboarded = 1",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// A retired step, kept only for its number.
fn migration_12_unused(_tx: &Transaction, _wattle_dir: &Path) -> Result<(), String> {
    Ok(())
}

/// Gives similarity somewhere to live.
fn migration_13_entry_embeddings(tx: &Transaction, _wattle_dir: &Path) -> Result<(), String> {
    tx.execute_batch(EMBEDDING_SCHEMA)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Gives letters somewhere to live.
fn migration_14_letters(tx: &Transaction, _wattle_dir: &Path) -> Result<(), String> {
    tx.execute_batch(LETTERS_SCHEMA)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Gives *opened* letters somewhere to be found.
fn migration_15_letters_search(tx: &Transaction, _wattle_dir: &Path) -> Result<(), String> {
    tx.execute_batch(LETTERS_SEARCH_SCHEMA)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Gives a letter's own files somewhere to live.
fn migration_16_letter_attachments(tx: &Transaction, _wattle_dir: &Path) -> Result<(), String> {
    tx.execute_batch(LETTER_ATTACHMENT_SCHEMA)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Widens the appearance choice from an accent to a whole theme.
fn migration_17_palette(tx: &Transaction, _wattle_dir: &Path) -> Result<(), String> {
    if !column_exists(tx, "settings", "palette") {
        tx.execute(
            "ALTER TABLE settings ADD COLUMN palette TEXT NOT NULL DEFAULT 'wattle'",
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Gives a deleted page somewhere to wait, and the writing a size of its own.
fn migration_18_trash_and_editor_scale(tx: &Transaction, _wattle_dir: &Path) -> Result<(), String> {
    tx.execute_batch(TRASH_SCHEMA).map_err(|e| e.to_string())?;
    if !column_exists(tx, "settings", "editor_scale") {
        tx.execute(
            "ALTER TABLE settings ADD COLUMN editor_scale TEXT NOT NULL DEFAULT 'default'",
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn run_migrations(conn: &mut Connection, wattle_dir: &Path) -> Result<(), MigrationError> {
    run_migrations_with(conn, wattle_dir, MIGRATIONS, LATEST_VERSION)
}

/// The runner proper.
fn run_migrations_with(
    conn: &mut Connection,
    wattle_dir: &Path,
    migrations: &[Migration],
    latest: i32,
) -> Result<(), MigrationError> {
    let current = user_version(conn)?;

    if current > latest {
        return Err(MigrationError::FutureVersion {
            found: current,
            supported: latest,
        });
    }

    for (index, migration) in migrations.iter().enumerate() {
        let version = index as i32 + 1;
        if version <= current {
            continue;
        }

        let tx = conn.transaction().map_err(|e| e.to_string())?;
        migration(&tx, wattle_dir)?;
        set_user_version(&tx, version)?;
        tx.commit().map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Picks a snapshot filename, never overwriting one that is already there.
fn snapshot_path(wattle_dir: &Path, from_version: i32) -> Result<PathBuf, String> {
    let base = wattle_dir.join(format!("wattle.db.pre-v{from_version}.bak"));
    if !base.exists() {
        return Ok(base);
    }
    for attempt in 1..=9 {
        let candidate = wattle_dir.join(format!("wattle.db.pre-v{from_version}.bak-{attempt}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("too many leftover pre-migration snapshots; move them aside before continuing".to_string())
}

/// Takes the pre-migration snapshot.
fn snapshot_database(conn: &Connection, target: &Path) -> Result<(), String> {
    let escaped = target.to_string_lossy().replace('\'', "''");
    conn.execute_batch(&format!("VACUUM INTO '{escaped}'"))
        .map_err(|e| e.to_string())
}

pub fn init_db(wattle_dir: &Path) -> Result<Connection, String> {
    let mut conn = Connection::open(wattle_dir.join("wattle.db")).map_err(|e| e.to_string())?;

    let initialised = is_initialised(&conn)?;
    let stored_version = user_version(&conn)?;

    if initialised && stored_version > LATEST_VERSION {
        return Err(MigrationError::FutureVersion {
            found: stored_version,
            supported: LATEST_VERSION,
        }
        .to_string());
    }

    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;

    conn.pragma_update(None, "secure_delete", "ON")
        .map_err(|e| e.to_string())?;

    if initialised {
        if stored_version < LATEST_VERSION {
            // ponytail: no free-space pre-check, which would need a new crate.
            // `VACUUM INTO` fails loudly when the disk is full and that aborts
            // the migration, which is the outcome the check would have forced.
            let target = snapshot_path(wattle_dir, stored_version)?;
            snapshot_database(&conn, &target)?;
        }
        run_migrations(&mut conn, wattle_dir).map_err(|e| e.to_string())?;
        conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
        conn.execute_batch(EMBEDDING_SCHEMA)
            .map_err(|e| e.to_string())?;
        conn.execute_batch(LETTERS_SCHEMA)
            .map_err(|e| e.to_string())?;
        conn.execute_batch(LETTERS_SEARCH_SCHEMA)
            .map_err(|e| e.to_string())?;
        conn.execute_batch(LETTER_ATTACHMENT_SCHEMA)
            .map_err(|e| e.to_string())?;
        conn.execute_batch(TRASH_SCHEMA)
            .map_err(|e| e.to_string())?;
    } else {
        conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
        conn.execute_batch(SEARCH_SCHEMA)
            .map_err(|e| e.to_string())?;
        conn.execute_batch(EMBEDDING_SCHEMA)
            .map_err(|e| e.to_string())?;
        conn.execute_batch(LETTERS_SCHEMA)
            .map_err(|e| e.to_string())?;
        conn.execute_batch(LETTERS_SEARCH_SCHEMA)
            .map_err(|e| e.to_string())?;
        conn.execute_batch(LETTER_ATTACHMENT_SCHEMA)
            .map_err(|e| e.to_string())?;
        conn.execute_batch(TRASH_SCHEMA)
            .map_err(|e| e.to_string())?;
        set_user_version(&conn, LATEST_VERSION)?;
    }

    Ok(conn)
}

#[cfg(test)]
pub fn init_db_at_connection_for_test() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(SCHEMA).unwrap();
    conn.execute_batch(SEARCH_SCHEMA).unwrap();
    conn.execute_batch(EMBEDDING_SCHEMA).unwrap();
    conn.execute_batch(LETTERS_SCHEMA).unwrap();
    conn.execute_batch(LETTERS_SEARCH_SCHEMA).unwrap();
    conn.execute_batch(LETTER_ATTACHMENT_SCHEMA).unwrap();
    conn.execute_batch(TRASH_SCHEMA).unwrap();
    conn.pragma_update(None, "foreign_keys", true).unwrap();
    conn.pragma_update(None, "secure_delete", "ON").unwrap();
    set_user_version(&conn, LATEST_VERSION).unwrap();
    conn
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "wattle_{name}_{}_{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn legacy_db(dir: &Path, with_navigation: bool) -> Connection {
        let conn = Connection::open(dir.join("wattle.db")).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        if !with_navigation {
            conn.execute("ALTER TABLE settings DROP COLUMN navigation", [])
                .unwrap();
        }
        set_user_version(&conn, 0).unwrap();
        conn
    }

    fn has_navigation(conn: &Connection) -> bool {
        conn.prepare("SELECT navigation FROM settings").is_ok()
    }

    #[test]
    fn a_database_that_predates_ai_settings_migrates_with_ai_off() {
        let dir = temp_dir("legacy_without_ai");
        let conn = Connection::open(dir.join("wattle.db")).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        for column in ["ai_enabled", "ai_model"] {
            conn.execute(&format!("ALTER TABLE settings DROP COLUMN {column}"), [])
                .unwrap();
        }
        conn.execute(
            "INSERT INTO settings (id, language, theme) VALUES (1, 'it', 'dark')",
            [],
        )
        .unwrap();
        set_user_version(&conn, 7).unwrap();
        drop(conn);

        let conn = init_db(&dir).unwrap();
        assert_eq!(user_version(&conn).unwrap(), LATEST_VERSION);

        let (enabled, model, language): (bool, String, String) = conn
            .query_row(
                "SELECT ai_enabled, ai_model, language FROM settings WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert!(!enabled, "an existing journal must migrate with AI off");
        assert_eq!(model, "");
        assert_eq!(language, "it");

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }

    fn pre_onboarding_db(dir: &Path, with_settings_row: bool) {
        let conn = Connection::open(dir.join("wattle.db")).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        for column in ["onboarded", "backup_dir", "tours_seen"] {
            conn.execute(&format!("ALTER TABLE settings DROP COLUMN {column}"), [])
                .unwrap();
        }
        if with_settings_row {
            conn.execute(
                "INSERT INTO settings (id, language, theme) VALUES (1, 'it', 'dark')",
                [],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO entries (title, entry_date) VALUES ('already writing', '2026-01-01')",
            [],
        )
        .unwrap();
        set_user_version(&conn, 10).unwrap();
    }

    fn onboarded_flag(conn: &Connection) -> bool {
        conn.query_row("SELECT onboarded FROM settings WHERE id = 1", [], |row| {
            row.get(0)
        })
        .unwrap()
    }

    #[test]
    fn a_journal_written_before_onboarding_existed_comes_back_already_onboarded() {
        let dir = temp_dir("legacy_onboarded");
        pre_onboarding_db(&dir, true);

        let conn = init_db(&dir).unwrap();
        assert_eq!(user_version(&conn).unwrap(), LATEST_VERSION);
        assert!(
            onboarded_flag(&conn),
            "an existing journal must not onboard"
        );

        let (language, backup_dir, tours): (String, String, String) = conn
            .query_row(
                "SELECT language, backup_dir, tours_seen FROM settings WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(language, "it");
        assert_eq!(backup_dir, "");
        assert_eq!(tours, "[]");

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_journal_with_no_settings_row_still_comes_back_already_onboarded() {
        let dir = temp_dir("legacy_onboarded_no_row");
        pre_onboarding_db(&dir, false);

        let conn = init_db(&dir).unwrap();
        assert_eq!(user_version(&conn).unwrap(), LATEST_VERSION);
        assert!(
            onboarded_flag(&conn),
            "a journal with entries must not onboard just because it had no settings row"
        );

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_brand_new_journal_still_has_onboarding_to_do() {
        let dir = temp_dir("fresh_not_onboarded");

        let conn = init_db(&dir).unwrap();
        conn.execute("INSERT INTO settings (id) VALUES (1)", [])
            .unwrap();
        assert!(!onboarded_flag(&conn));

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn init_db_creates_wattle_db_with_wal_and_expected_tables() {
        let dir = temp_dir("db_schema_test");

        let conn = init_db(&dir).unwrap();

        assert!(dir.join("wattle.db").exists());

        let mode: String = conn
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .unwrap();
        assert_eq!(mode.to_lowercase(), "wal");

        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .unwrap();
        let tables: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        for expected in [
            "attachments",
            "entries",
            "entries_fts",
            "profile",
            "settings",
        ] {
            assert!(
                tables.iter().any(|name| name == expected),
                "missing table {expected}, found {tables:?}"
            );
        }

        let mut trigger_stmt = conn
            .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'entries_fts_%'")
            .unwrap();
        let triggers: i64 = trigger_stmt.query_row([], |row| row.get(0)).unwrap();
        assert_eq!(triggers, 3, "insert, update and delete must all be covered");

        drop(trigger_stmt);
        drop(stmt);
        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn fresh_database_is_stamped_at_latest_without_a_snapshot() {
        let dir = temp_dir("fresh_stamp");

        let conn = init_db(&dir).unwrap();

        assert_eq!(user_version(&conn).unwrap(), LATEST_VERSION);
        assert!(!dir.join("wattle.db.pre-v0.bak").exists());

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn legacy_database_with_navigation_migrates_and_keeps_its_data() {
        let dir = temp_dir("legacy_with_nav");
        let conn = legacy_db(&dir, true);
        conn.execute(
            "INSERT INTO entries (title, entry_date) VALUES ('kept', '2026-08-15')",
            [],
        )
        .unwrap();
        drop(conn);

        let conn = init_db(&dir).unwrap();

        assert_eq!(user_version(&conn).unwrap(), LATEST_VERSION);
        assert!(has_navigation(&conn));
        let title: String = conn
            .query_row("SELECT title FROM entries", [], |row| row.get(0))
            .unwrap();
        assert_eq!(title, "kept");

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn legacy_database_without_navigation_gains_the_column() {
        let dir = temp_dir("legacy_without_nav");
        let conn = legacy_db(&dir, false);
        assert!(!has_navigation(&conn));
        drop(conn);

        let conn = init_db(&dir).unwrap();

        assert_eq!(user_version(&conn).unwrap(), LATEST_VERSION);
        assert!(has_navigation(&conn));
        let navigation: String = conn
            .query_row("SELECT navigation FROM settings WHERE id = 1", [], |row| {
                row.get(0)
            })
            .or_else(|_| Ok::<String, String>("both".to_string()))
            .unwrap();
        assert_eq!(navigation, "both");

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_accent_that_no_longer_exists_falls_back_to_the_default() {
        let dir = temp_dir("legacy_accent");
        let conn = Connection::open(dir.join("wattle.db")).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute("ALTER TABLE settings DROP COLUMN palette", [])
            .unwrap();
        conn.execute("INSERT INTO settings (id, accent) VALUES (1, 'moss')", [])
            .unwrap();
        set_user_version(&conn, 16).unwrap();
        drop(conn);

        let conn = init_db(&dir).unwrap();

        assert_eq!(user_version(&conn).unwrap(), LATEST_VERSION);
        let palette: String = conn
            .query_row("SELECT palette FROM settings WHERE id = 1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(palette, "wattle");

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn migrations_are_idempotent_when_rerun() {
        let dir = temp_dir("idempotent");

        let first = init_db(&dir).unwrap();
        assert_eq!(user_version(&first).unwrap(), LATEST_VERSION);
        drop(first);

        let second = init_db(&dir).unwrap();
        assert_eq!(user_version(&second).unwrap(), LATEST_VERSION);
        assert!(has_navigation(&second));
        drop(second);

        assert!(!dir.join("wattle.db.pre-v1.bak").exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn failing_step_rolls_back_and_leaves_the_version_unchanged() {
        let dir = temp_dir("failing_step");
        let mut conn = legacy_db(&dir, true);

        fn ok_step(tx: &Transaction, _dir: &Path) -> Result<(), String> {
            tx.execute("CREATE TABLE applied (id INTEGER PRIMARY KEY)", [])
                .map_err(|e| e.to_string())
                .map(|_| ())
        }
        fn failing_step(tx: &Transaction, _dir: &Path) -> Result<(), String> {
            tx.execute("CREATE TABLE half_applied (id INTEGER PRIMARY KEY)", [])
                .map_err(|e| e.to_string())?;
            Err("deliberate failure".to_string())
        }

        let result = run_migrations_with(&mut conn, &dir, &[ok_step, failing_step], 2);

        assert!(matches!(result, Err(MigrationError::Failed(_))));
        assert_eq!(user_version(&conn).unwrap(), 1);
        assert!(conn.prepare("SELECT id FROM applied").is_ok());
        assert!(conn.prepare("SELECT id FROM half_applied").is_err());
        assert!(conn.prepare("SELECT id FROM entries").is_ok());

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn database_from_a_newer_wattle_is_refused_and_left_untouched() {
        let dir = temp_dir("future_version");
        let db_path = dir.join("wattle.db");

        let conn = init_db(&dir).unwrap();
        conn.execute(
            "INSERT INTO entries (title, entry_date) VALUES ('from the future', '2026-08-15')",
            [],
        )
        .unwrap();
        set_user_version(&conn, LATEST_VERSION + 1).unwrap();
        drop(conn);

        let before = std::fs::read(&db_path).unwrap();
        let error = init_db(&dir).unwrap_err();
        let after = std::fs::read(&db_path).unwrap();

        assert!(
            error.contains("newer version of Wattle"),
            "expected the future-version error, got: {error}"
        );
        assert_eq!(before, after, "a refused database must not be written to");
        assert!(!dir
            .join(format!("wattle.db.pre-v{}.bak", LATEST_VERSION + 1))
            .exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn future_version_is_a_distinct_error_from_an_ordinary_failure() {
        let mut conn = Connection::open_in_memory().unwrap();
        set_user_version(&conn, 99).unwrap();

        let result =
            run_migrations_with(&mut conn, &std::env::temp_dir(), MIGRATIONS, LATEST_VERSION);

        match result {
            Err(MigrationError::FutureVersion { found, supported }) => {
                assert_eq!(found, 99);
                assert_eq!(supported, LATEST_VERSION);
            }
            other => panic!("expected FutureVersion, got {other:?}"),
        }
    }

    #[test]
    fn snapshot_captures_rows_still_sitting_in_the_wal() {
        let dir = temp_dir("snapshot_wal");
        let conn = init_db(&dir).unwrap();
        conn.execute(
            "INSERT INTO entries (title, entry_date) VALUES ('uncheckpointed', '2026-08-15')",
            [],
        )
        .unwrap();

        let target = dir.join("snapshot.bak");
        snapshot_database(&conn, &target).unwrap();

        let snapshot = Connection::open(&target).unwrap();
        let title: String = snapshot
            .query_row("SELECT title FROM entries", [], |row| row.get(0))
            .unwrap();
        assert_eq!(title, "uncheckpointed");

        drop(snapshot);
        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn migrating_an_existing_database_writes_a_snapshot_first() {
        let dir = temp_dir("snapshot_on_migrate");
        let conn = legacy_db(&dir, false);
        conn.execute(
            "INSERT INTO entries (title, entry_date) VALUES ('before migration', '2026-08-15')",
            [],
        )
        .unwrap();
        drop(conn);

        let conn = init_db(&dir).unwrap();
        drop(conn);

        let snapshot_file = dir.join("wattle.db.pre-v0.bak");
        assert!(snapshot_file.exists(), "expected a pre-migration snapshot");

        let snapshot = Connection::open(&snapshot_file).unwrap();
        let title: String = snapshot
            .query_row("SELECT title FROM entries", [], |row| row.get(0))
            .unwrap();
        assert_eq!(title, "before migration");
        assert_eq!(user_version(&snapshot).unwrap(), 0);
        assert!(!has_navigation(&snapshot));

        drop(snapshot);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn backfill_derives_content_for_entries_written_before_the_columns_existed() {
        let dir = temp_dir("backfill");

        let conn = Connection::open(dir.join("wattle.db")).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        for column in ["content_text", "preview", "word_count"] {
            conn.execute(&format!("ALTER TABLE entries DROP COLUMN {column}"), [])
                .unwrap();
        }
        let document = r#"{"type":"doc","content":[{"type":"paragraph","content":[
            {"type":"text","text":"a "},
            {"type":"text","marks":[{"type":"bold"}],"text":"bold"},
            {"type":"text","text":" word"}]}]}"#;
        conn.execute(
            "INSERT INTO entries (title, content, entry_date) VALUES ('old', ?1, '2026-08-15')",
            [document],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO entries (title, content, entry_date) VALUES ('broken', 'not json', '2026-08-14')",
            [],
        )
        .unwrap();
        set_user_version(&conn, 1).unwrap();
        drop(conn);

        let conn = init_db(&dir).unwrap();

        assert_eq!(user_version(&conn).unwrap(), LATEST_VERSION);

        let (text, preview, words): (String, String, i64) = conn
            .query_row(
                "SELECT content_text, preview, word_count FROM entries WHERE title = 'old'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        let expected = crate::content::derive(document);
        assert_eq!(text, expected.text);
        assert_eq!(preview, expected.preview);
        assert_eq!(words, expected.word_count);
        assert_eq!(text, "a bold word");

        let (broken_text, broken_content): (String, String) = conn
            .query_row(
                "SELECT content_text, content FROM entries WHERE title = 'broken'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(broken_text, "");
        assert_eq!(broken_content, "not json");

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_dateless_entry_is_repaired_from_the_day_it_was_written() {
        let dir = temp_dir("repair_entry_dates");

        let conn = Connection::open(dir.join("wattle.db")).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute_batch(SEARCH_SCHEMA).unwrap();
        conn.execute(
            "INSERT INTO entries (id, title, entry_date, created_at) \
             VALUES (38, '7tyuhj', '', '2026-08-15T22:50:46.062Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO entries (id, title, entry_date, created_at) \
             VALUES (39, 'malformed', '2026-8-1', '2026-07-04T09:00:00.000Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO entries (id, title, entry_date, created_at) \
             VALUES (40, 'fine', '2026-01-02', '2026-06-06T09:00:00.000Z')",
            [],
        )
        .unwrap();
        set_user_version(&conn, 4).unwrap();
        drop(conn);

        let conn = init_db(&dir).unwrap();

        let repaired: Vec<(i64, String)> = conn
            .prepare("SELECT id, entry_date FROM entries ORDER BY id")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();

        assert_eq!(
            repaired,
            vec![
                (38, "2026-08-15".to_string()),
                (39, "2026-07-04".to_string()),
                (40, "2026-01-02".to_string()),
            ]
        );

        for (id, date) in &repaired {
            assert!(
                crate::commands::entries::is_calendar_date(date),
                "entry {id} still holds {date:?}"
            );
        }

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn entries_written_before_sparks_existed_become_ordinary_entries() {
        let dir = temp_dir("entry_kind_upgrade");

        let conn = Connection::open(dir.join("wattle.db")).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute_batch(SEARCH_SCHEMA).unwrap();
        conn.execute("DROP INDEX IF EXISTS idx_entries_kind_date", [])
            .unwrap();
        conn.execute("ALTER TABLE entries DROP COLUMN kind", [])
            .unwrap();
        conn.execute(
            "INSERT INTO entries (title, entry_date) VALUES ('written earlier', '2026-08-15')",
            [],
        )
        .unwrap();
        set_user_version(&conn, 6).unwrap();
        drop(conn);

        let conn = init_db(&dir).unwrap();

        assert_eq!(user_version(&conn).unwrap(), LATEST_VERSION);
        let kind: String = conn
            .query_row(
                "SELECT kind FROM entries WHERE title = 'written earlier'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(kind, "entry");

        let indexed: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_entries_kind_date'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(indexed, 1);

        assert!(
            conn.execute(
                "INSERT INTO entries (entry_date, kind) VALUES ('2026-08-16', 'task')",
                [],
            )
            .is_err(),
            "the kind check constraint did not survive the migration"
        );

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_journal_written_before_embeddings_gains_an_empty_table() {
        let dir = temp_dir("embeddings_upgrade");

        let conn = Connection::open(dir.join("wattle.db")).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute_batch(SEARCH_SCHEMA).unwrap();
        conn.execute("DROP TABLE IF EXISTS entry_embeddings", [])
            .unwrap();
        conn.execute(
            "INSERT INTO entries (title, content_text, entry_date) \
             VALUES ('kept', 'every word of it', '2026-08-15')",
            [],
        )
        .unwrap();
        set_user_version(&conn, 12).unwrap();
        drop(conn);

        let conn = init_db(&dir).unwrap();

        assert_eq!(user_version(&conn).unwrap(), LATEST_VERSION);
        let vectors: i64 = conn
            .query_row("SELECT COUNT(*) FROM entry_embeddings", [], |row| {
                row.get(0)
            })
            .expect("entry_embeddings missing after migration");
        assert_eq!(vectors, 0, "upgrading must never embed anything");
        let text: String = conn
            .query_row("SELECT content_text FROM entries", [], |row| row.get(0))
            .unwrap();
        assert_eq!(text, "every word of it");

        conn.execute(
            "INSERT INTO entry_embeddings (entry_id, embedding, model, dim, source_updated_at) \
             SELECT id, x'0000', 'bge-m3', 1, updated_at FROM entries",
            [],
        )
        .unwrap();
        assert!(
            conn.execute(
                "INSERT INTO entry_embeddings (entry_id, embedding, model, dim, source_updated_at) \
                 SELECT id, x'0000', 'bge-m3', 1, updated_at FROM entries",
                [],
            )
            .is_err(),
            "an entry may hold one vector, not two"
        );
        conn.execute("DELETE FROM entries", []).unwrap();
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM entry_embeddings", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(
            left, 0,
            "a vector describes writing, and does not outlive it"
        );

        assert!(dir.join("wattle.db.pre-v12.bak").exists());

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_journal_written_before_letters_gains_them_and_a_sealed_one_survives_migrating() {
        let dir = temp_dir("letters_upgrade");

        let conn = Connection::open(dir.join("wattle.db")).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute_batch(SEARCH_SCHEMA).unwrap();
        conn.execute_batch(EMBEDDING_SCHEMA).unwrap();
        conn.execute(
            "INSERT INTO entries (title, content_text, entry_date)              VALUES ('kept', 'every word of it', '2026-08-15')",
            [],
        )
        .unwrap();
        set_user_version(&conn, 13).unwrap();
        drop(conn);

        let conn = init_db(&dir).unwrap();
        assert_eq!(user_version(&conn).unwrap(), LATEST_VERSION);

        for table in ["letters", "letter_keys", "letters_fts"] {
            let count: i64 = conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap_or_else(|_| panic!("{table} missing after migration"));
            assert_eq!(count, 0, "upgrading must not invent a letter");
        }
        let text: String = conn
            .query_row("SELECT content_text FROM entries", [], |row| row.get(0))
            .unwrap();
        assert_eq!(text, "every word of it");

        assert!(
            conn.execute(
                "INSERT INTO letters (status, written_on) VALUES ('sealed', '2026-08-21')",
                [],
            )
            .is_err(),
            "a sealed letter with no unlock date must be refused by the schema"
        );

        conn.execute(
            "INSERT INTO letters (id, status, written_on, unlock_on, sealed_at, ciphertext)              VALUES (1, 'sealed', '2026-08-21', '2031-03-14', '2026-08-21T10:00:00.000Z', x'ABCD')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO letter_keys (letter_id, key) VALUES (1, x'0011')",
            [],
        )
        .unwrap();

        let before: (i64, String, String, Vec<u8>) = conn
            .query_row(
                "SELECT id, unlock_on, sealed_at, ciphertext FROM letters WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        drop(conn);

        let conn = init_db(&dir).unwrap();
        let after: (i64, String, String, Vec<u8>) = conn
            .query_row(
                "SELECT id, unlock_on, sealed_at, ciphertext FROM letters WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            before, after,
            "a sealed letter must survive an upgrade untouched"
        );

        assert!(dir.join("wattle.db.pre-v13.bak").exists());

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_existing_snapshot_is_never_overwritten() {
        let dir = temp_dir("snapshot_no_clobber");
        std::fs::write(dir.join("wattle.db.pre-v0.bak"), b"precious").unwrap();

        let chosen = snapshot_path(&dir, 0).unwrap();

        assert_eq!(chosen.file_name().unwrap(), "wattle.db.pre-v0.bak-1");
        assert_eq!(
            std::fs::read(dir.join("wattle.db.pre-v0.bak")).unwrap(),
            b"precious"
        );

        std::fs::remove_dir_all(&dir).ok();
    }
}
