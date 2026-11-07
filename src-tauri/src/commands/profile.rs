use std::path::Path;

use rusqlite::{params, OptionalExtension};
use tauri::State;

use crate::models::ProfileDto;
use crate::state::AppState;

const SELECT: &str = "SELECT name, created_at FROM profile WHERE id = 1";

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<ProfileDto> {
    Ok(ProfileDto {
        name: row.get(0)?,
        created_at: row.get(1)?,
    })
}

fn load_profile_impl(conn: &rusqlite::Connection) -> Result<ProfileDto, String> {
    let existing = conn
        .query_row(SELECT, [], map_row)
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some(profile) = existing {
        return Ok(profile);
    }

    conn.execute("INSERT INTO profile (id) VALUES (1)", [])
        .map_err(|e| e.to_string())?;
    conn.query_row(SELECT, [], map_row)
        .map_err(|e| e.to_string())
}

fn save_profile_impl(conn: &rusqlite::Connection, profile: ProfileDto) -> Result<(), String> {
    conn.execute(
        "UPDATE profile SET name = ?1 WHERE id = 1",
        params![profile.name],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Empties this profile so it can be set up again from nothing.
fn reset_profile_impl(conn: &mut rusqlite::Connection, wattle_dir: &Path) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute("DELETE FROM deleted_entries", [])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM entries", [])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM letters", [])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM letters_fts", [])
        .map_err(|e| e.to_string())?;
    tx.execute("UPDATE profile SET name = ''", [])
        .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE settings SET version = '', zoom_level = 1, navigation = 'both', \
         on_this_day = 1, spark_echo = 1, entry_lock = 1, layout_width = 'default', \
         palette = 'wattle', editor_scale = 'default', onboarded = 0 WHERE id = 1",
        [],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
        .map_err(|e| e.to_string())?;
    conn.execute_batch("VACUUM").map_err(|e| e.to_string())?;

    let attachments_dir = wattle_dir.join("attachments");
    if attachments_dir.exists() {
        std::fs::remove_dir_all(&attachments_dir).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(&attachments_dir).map_err(|e| e.to_string())?;

    let sealed_dir = wattle_dir.join("sealed-letters");
    if sealed_dir.exists() {
        std::fs::remove_dir_all(&sealed_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn reset_profile(state: State<AppState>) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    reset_profile_impl(&mut conn, &state.wattle_dir()?)
}

#[tauri::command]
pub fn load_profile(state: State<AppState>) -> Result<ProfileDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    load_profile_impl(&conn)
}

#[tauri::command]
pub fn save_profile(state: State<AppState>, profile: ProfileDto) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    save_profile_impl(&conn, profile)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_creates_default_row_then_persists_saved_name() {
        let conn = crate::db::init_db_at_connection_for_test();

        let defaults = load_profile_impl(&conn).unwrap();
        assert_eq!(defaults.name, "");
        assert!(!defaults.created_at.is_empty());

        save_profile_impl(
            &conn,
            ProfileDto {
                name: "User".to_string(),
                created_at: defaults.created_at.clone(),
            },
        )
        .unwrap();

        let reloaded = load_profile_impl(&conn).unwrap();
        assert_eq!(reloaded.name, "User");
        assert_eq!(reloaded.created_at, defaults.created_at);
    }

    #[test]
    fn resetting_leaves_no_journal_text_or_key_material_in_the_files() {
        let dir = std::env::temp_dir().join("wattle_test_reset_residue");
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(dir.join("attachments")).unwrap();
        let mut conn = crate::db::init_db(&dir).unwrap();

        let key: Vec<u8> = (0..32u8).map(|byte| 0xA0 ^ byte).collect();
        conn.execute(
            "INSERT INTO letters (id, status, written_on, unlock_on, sealed_at, ciphertext) \
             VALUES (1, 'sealed', '2026-01-01', '2031-03-14', '2026-01-01T09:00:00.000Z', x'ABCD')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO letter_keys (letter_id, key) VALUES (1, ?1)",
            params![key],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO entries (title, content_text, entry_date) \
             VALUES ('a private thing', 'quince-marmalade-77', '2026-01-01')",
            [],
        )
        .unwrap();

        reset_profile_impl(&mut conn, &dir).unwrap();

        const TEXT: &[u8] = b"quince-marmalade-77";
        for name in ["wattle.db", "wattle.db-wal", "wattle.db-shm"] {
            let path = dir.join(name);
            if !path.exists() {
                continue;
            }
            let bytes = std::fs::read(&path).unwrap();
            assert!(
                !bytes
                    .windows(key.len())
                    .any(|window| window == key.as_slice()),
                "{name} still holds a sealed letter's key after a reset"
            );
            assert!(
                !bytes.windows(TEXT.len()).any(|window| window == TEXT),
                "{name} still holds deleted writing after a reset"
            );
        }

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resetting_empties_the_journal_but_keeps_what_is_not_the_journal() {
        let dir = std::env::temp_dir().join("wattle_test_profile_reset");
        std::fs::create_dir_all(dir.join("attachments").join("1")).unwrap();
        std::fs::write(dir.join("attachments").join("1").join("2.png"), b"bytes").unwrap();
        let mut conn = crate::db::init_db(&dir).unwrap();

        conn.execute(
            "INSERT INTO entries (title, content_text, entry_date) \
             VALUES ('a private thing', 'findable words', '2026-01-01')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (id, theme, language, palette, editor_scale, tours_seen, backup_dir, ai_enabled, ai_model, onboarded) \
             VALUES (1, 'dark', 'it', 'moss', 'largest', '[\"/app\"]', 'D:/backups', 1, 'qwen3.5:4b', 1)",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO profile (id, name) VALUES (1, 'User')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO deleted_entries (id, title, entry_date) VALUES (99, 'binned', '2026-01-01')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO letters (id, status, written_on, unlock_on, sealed_at, ciphertext)              VALUES (1, 'sealed', '2026-01-01', '2031-03-14', '2026-01-01T09:00:00.000Z', x'ABCD')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO letter_keys (letter_id, key) VALUES (1, x'0011')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO letters_fts (rowid, content_text) VALUES (1, 'findable letter words')",
            [],
        )
        .unwrap();

        reset_profile_impl(&mut conn, &dir).unwrap();

        let entries: i64 = conn
            .query_row("SELECT count(*) FROM entries", [], |row| row.get(0))
            .unwrap();
        assert_eq!(entries, 0);
        let waiting: i64 = conn
            .query_row("SELECT count(*) FROM deleted_entries", [], |row| row.get(0))
            .unwrap();
        assert_eq!(waiting, 0, "an emptied journal keeps nothing in its trash");
        let found: i64 = conn
            .query_row(
                "SELECT count(*) FROM entries_fts WHERE entries_fts MATCH 'findable'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(found, 0, "deleted writing must not stay searchable");
        assert_eq!(load_profile_impl(&conn).unwrap().name, "");

        for table in ["letters", "letter_keys", "letters_fts"] {
            let left: i64 = conn
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(left, 0, "{table} must be emptied by a reset");
        }

        assert!(dir.join("attachments").exists());
        assert_eq!(
            std::fs::read_dir(dir.join("attachments")).unwrap().count(),
            0
        );

        let (theme, language, palette, tours, backup_dir, ai_enabled, ai_model, onboarded): (
            String,
            String,
            String,
            String,
            String,
            bool,
            String,
            bool,
        ) = conn
            .query_row(
                "SELECT theme, language, palette, tours_seen, backup_dir, ai_enabled, ai_model, \
                 onboarded FROM settings WHERE id = 1",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                    ))
                },
            )
            .unwrap();

        assert_eq!(theme, "dark");
        assert_eq!(
            language, "it",
            "a reset must not hand back a flow the reader cannot read"
        );
        assert_eq!(tours, "[\"/app\"]", "tours must not replay after a reset");
        assert_eq!(backup_dir, "D:/backups");
        assert!(ai_enabled);
        assert_eq!(ai_model, "qwen3.5:4b");
        assert_eq!(palette, "wattle");
        let editor_scale: String = conn
            .query_row(
                "SELECT editor_scale FROM settings WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(editor_scale, "default");
        assert!(!onboarded, "a reset profile must be set up again");

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }
}
