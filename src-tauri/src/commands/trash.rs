use std::path::Path;

use rusqlite::{params, Connection};
use tauri::State;

use crate::models::TrashedEntryDto;
use crate::state::AppState;

/// How long a deleted page waits before it is gone for good.
pub const TRASH_RETENTION_DAYS: i64 = 30;

/// Every column of `entries`, in the order both tables declare them.
const ENTRY_COLUMNS: &str = "id, title, content, content_text, preview, word_count, kind, \
     entry_date, created_at, updated_at";

const ATTACHMENT_COLUMNS: &str = "id, entry_id, filename, mime_type, size, path, created_at";

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<TrashedEntryDto> {
    Ok(TrashedEntryDto {
        id: row.get(0)?,
        title: row.get(1)?,
        preview: row.get(2)?,
        word_count: row.get(3)?,
        kind: row.get(4)?,
        entry_date: row.get(5)?,
        deleted_at: row.get(6)?,
    })
}

/// Moves a page into the trash: the row, its attachment rows, and nothing else.
pub fn trash_entry(conn: &mut Connection, id: i64) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        &format!(
            "INSERT OR REPLACE INTO deleted_entries ({ENTRY_COLUMNS}) \
             SELECT {ENTRY_COLUMNS} FROM entries WHERE id = ?1"
        ),
        params![id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        &format!(
            "INSERT OR REPLACE INTO deleted_attachments ({ATTACHMENT_COLUMNS}) \
             SELECT {ATTACHMENT_COLUMNS} FROM attachments WHERE entry_id = ?1"
        ),
        params![id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM entries WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

/// Puts a page back under the id it had, with its attachments.
fn restore_entry_impl(conn: &mut Connection, id: i64) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let restored = tx
        .execute(
            &format!(
                "INSERT INTO entries ({ENTRY_COLUMNS}) \
                 SELECT {ENTRY_COLUMNS} FROM deleted_entries WHERE id = ?1"
            ),
            params![id],
        )
        .map_err(|e| e.to_string())?;
    if restored == 0 {
        return Err(format!("nothing in the trash with id {id}"));
    }
    tx.execute(
        &format!(
            "INSERT INTO attachments ({ATTACHMENT_COLUMNS}) \
             SELECT {ATTACHMENT_COLUMNS} FROM deleted_attachments WHERE entry_id = ?1"
        ),
        params![id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM deleted_entries WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

/// Destroys one page for good, files included.
fn purge_one(conn: &Connection, wattle_dir: &Path, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM deleted_entries WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    let entry_dir = wattle_dir.join("attachments").join(id.to_string());
    if entry_dir.exists() {
        std::fs::remove_dir_all(entry_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn list_trash_impl(conn: &Connection) -> Result<Vec<TrashedEntryDto>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, preview, word_count, kind, entry_date, deleted_at \
             FROM deleted_entries ORDER BY deleted_at DESC, id DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], map_row).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

/// Everything whose thirty days are up, destroyed.
pub fn purge_expired(conn: &Connection, wattle_dir: &Path) -> Result<usize, String> {
    let expired: Vec<i64> = {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT id FROM deleted_entries WHERE deleted_at < \
                 strftime('%Y-%m-%dT%H:%M:%fZ','now','-{TRASH_RETENTION_DAYS} days')"
            ))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    for id in &expired {
        purge_one(conn, wattle_dir, *id)?;
    }
    Ok(expired.len())
}

/// Empties the trash: every page in it, and every file those pages held.
pub fn empty_trash_impl(conn: &Connection, wattle_dir: &Path) -> Result<(), String> {
    let ids: Vec<i64> = {
        let mut stmt = conn
            .prepare("SELECT id FROM deleted_entries")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    for id in ids {
        purge_one(conn, wattle_dir, id)?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_trash(state: State<AppState>) -> Result<Vec<TrashedEntryDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    list_trash_impl(&conn)
}

#[tauri::command]
pub fn restore_entry(state: State<AppState>, id: i64) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    restore_entry_impl(&mut conn, id)
}

#[tauri::command]
pub fn purge_entry(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    purge_one(&conn, &state.wattle_dir()?, id)
}

#[tauri::command]
pub fn empty_trash(state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    empty_trash_impl(&conn, &state.wattle_dir()?)
}

/// How long a page waits, so the copy on screen and the rule in here cannot
/// disagree about the number of days.
#[tauri::command]
pub fn trash_retention_days() -> i64 {
    TRASH_RETENTION_DAYS
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed(conn: &Connection, title: &str) -> i64 {
        conn.execute(
            "INSERT INTO entries (title, content_text, preview, word_count, entry_date) \
             VALUES (?1, ?1, ?1, 1, '2026-01-01')",
            params![title],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn a_deleted_page_leaves_the_journal_and_comes_back_whole() {
        let mut conn = crate::db::init_db_at_connection_for_test();
        let id = seed(&conn, "findable");
        conn.execute(
            "INSERT INTO attachments (entry_id, filename, mime_type, size, path) \
             VALUES (?1, 'a.png', 'image/png', 3, 'attachments/1/1.png')",
            params![id],
        )
        .unwrap();

        trash_entry(&mut conn, id).unwrap();

        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM entries", [], |row| row.get(0))
            .unwrap();
        assert_eq!(left, 0, "a trashed page is out of `entries`");
        let findable: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM entries_fts WHERE entries_fts MATCH 'findable'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(findable, 0, "a trashed page must not stay searchable");
        assert_eq!(list_trash_impl(&conn).unwrap().len(), 1);

        restore_entry_impl(&mut conn, id).unwrap();

        let (back, title): (i64, String) = conn
            .query_row("SELECT id, title FROM entries", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap();
        assert_eq!(back, id, "the page comes back under the id its files use");
        assert_eq!(title, "findable");
        let attachments: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM attachments WHERE entry_id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(attachments, 1, "its files come back with it");
        assert!(list_trash_impl(&conn).unwrap().is_empty());
        let findable: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM entries_fts WHERE entries_fts MATCH 'findable'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(findable, 1);
    }

    #[test]
    fn only_pages_past_their_thirty_days_are_purged() {
        let dir = std::env::temp_dir().join("wattle_test_trash_purge");
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(dir.join("attachments").join("1")).unwrap();
        std::fs::write(dir.join("attachments").join("1").join("1.png"), b"bytes").unwrap();
        let mut conn = crate::db::init_db(&dir).unwrap();

        let old = seed(&conn, "long gone");
        let recent = seed(&conn, "yesterday");
        trash_entry(&mut conn, old).unwrap();
        trash_entry(&mut conn, recent).unwrap();
        conn.execute(
            "UPDATE deleted_entries SET deleted_at = \
             strftime('%Y-%m-%dT%H:%M:%fZ','now','-31 days') WHERE id = ?1",
            params![old],
        )
        .unwrap();
        conn.execute(
            "UPDATE deleted_entries SET deleted_at = \
             strftime('%Y-%m-%dT%H:%M:%fZ','now','-29 days') WHERE id = ?1",
            params![recent],
        )
        .unwrap();

        assert_eq!(purge_expired(&conn, &dir).unwrap(), 1);
        let remaining = list_trash_impl(&conn).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, recent);
        assert!(!dir.join("attachments").join(old.to_string()).exists());

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }
}
