use std::path::Path;

use rusqlite::{params, Connection};
use tauri::State;

use crate::models::AttachmentDto;
use crate::state::AppState;

fn fetch_attachment(conn: &Connection, id: i64) -> Result<AttachmentDto, String> {
    conn.query_row(
        "SELECT id, entry_id, filename, mime_type, size, path, created_at FROM attachments WHERE id = ?1",
        params![id],
        |row| {
            Ok(AttachmentDto {
                id: row.get(0)?,
                entry_id: row.get(1)?,
                filename: row.get(2)?,
                mime_type: row.get(3)?,
                size: row.get(4)?,
                path: row.get(5)?,
                created_at: row.get(6)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

fn add_attachment_impl(
    conn: &mut Connection,
    wattle_dir: &Path,
    entry_id: i64,
    source_path: String,
) -> Result<AttachmentDto, String> {
    let source = Path::new(&source_path);
    let filename = source
        .file_name()
        .ok_or_else(|| "invalid source path".to_string())?
        .to_string_lossy()
        .to_string();
    let extension = source
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("");
    let mime_type = mime_guess::from_path(source)
        .first_or_octet_stream()
        .to_string();
    let size = std::fs::metadata(source).map_err(|e| e.to_string())?.len() as i64;

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO attachments (entry_id, filename, mime_type, size, path) VALUES (?1, ?2, ?3, ?4, '')",
        params![entry_id, filename, mime_type, size],
    )
    .map_err(|e| e.to_string())?;
    let id = tx.last_insert_rowid();

    let relative_path = if extension.is_empty() {
        format!("attachments/{entry_id}/{id}")
    } else {
        format!("attachments/{entry_id}/{id}.{extension}")
    };

    let destination = crate::paths::stored_path(wattle_dir, &relative_path)?;
    let destination_dir = destination
        .parent()
        .ok_or_else(|| "invalid destination path".to_string())?;
    std::fs::create_dir_all(destination_dir).map_err(|e| e.to_string())?;
    let destination = crate::paths::stored_path(wattle_dir, &relative_path)?;
    std::fs::copy(source, &destination).map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE attachments SET path = ?1 WHERE id = ?2",
        params![relative_path, id],
    )
    .map_err(|e| e.to_string())?;

    let result = fetch_attachment(&tx, id);
    tx.commit().map_err(|e| e.to_string())?;
    result
}

pub fn list_attachments_impl(
    conn: &Connection,
    entry_id: i64,
) -> Result<Vec<AttachmentDto>, String> {
    let mut stmt = conn
        .prepare("SELECT id, entry_id, filename, mime_type, size, path, created_at FROM attachments WHERE entry_id = ?1 ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![entry_id], |row| {
            Ok(AttachmentDto {
                id: row.get(0)?,
                entry_id: row.get(1)?,
                filename: row.get(2)?,
                mime_type: row.get(3)?,
                size: row.get(4)?,
                path: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

/// Where files that nothing references any more are put.
const ORPHAN_DIR: &str = "attachments/.orphaned";

/// Moves the files of attachment rows their entry's document no longer
/// references, and drops those rows.
pub fn quarantine_orphans(conn: &Connection, wattle_dir: &Path) -> Result<usize, String> {
    let entries: Vec<i64> = {
        let mut stmt = conn
            .prepare("SELECT id FROM entries")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    let mut quarantined = 0;
    for entry_id in entries {
        quarantined += quarantine_entry_orphans(conn, wattle_dir, entry_id)?;
    }
    Ok(quarantined)
}

/// The same reconciliation for a single entry, against the document as stored.
pub fn quarantine_entry_orphans(
    conn: &Connection,
    wattle_dir: &Path,
    entry_id: i64,
) -> Result<usize, String> {
    let content: String = match conn.query_row(
        "SELECT content FROM entries WHERE id = ?1",
        params![entry_id],
        |row| row.get(0),
    ) {
        Ok(content) => content,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(0),
        Err(error) => return Err(error.to_string()),
    };

    let Ok(document) = serde_json::from_str::<serde_json::Value>(&content) else {
        return Ok(0);
    };
    let referenced = crate::content::collect_attachment_ids(&document);

    let stored: Vec<(i64, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, path FROM attachments WHERE entry_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![entry_id], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    let mut quarantined = 0;
    for (attachment_id, path) in stored {
        if referenced.contains(&attachment_id) {
            continue;
        }
        if !move_to_quarantine(wattle_dir, entry_id, &path) {
            continue;
        }
        conn.execute(
            "DELETE FROM attachments WHERE id = ?1",
            params![attachment_id],
        )
        .map_err(|e| e.to_string())?;
        quarantined += 1;
    }

    Ok(quarantined)
}

/// True when the row may now be dropped: either the file was moved aside, or it
/// was already gone and there is nothing to preserve.
fn move_to_quarantine(wattle_dir: &Path, entry_id: i64, path: &str) -> bool {
    let source = match crate::paths::trusted_stored_path(wattle_dir, path) {
        Ok(Some(source)) => source,
        Ok(None) => return true,
        Err(_) => return false,
    };
    match source.try_exists() {
        Ok(true) => {}
        Ok(false) => return true,
        Err(_) => return false,
    }

    let Some(filename) = source.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let relative = format!("{ORPHAN_DIR}/{entry_id}/{filename}");
    let Ok(destination) = crate::paths::stored_path(wattle_dir, &relative) else {
        return false;
    };
    let Some(destination_dir) = destination.parent() else {
        return false;
    };
    if std::fs::create_dir_all(destination_dir).is_err() {
        return false;
    }
    let Ok(destination) = crate::paths::stored_path(wattle_dir, &relative) else {
        return false;
    };

    std::fs::rename(&source, destination).is_ok()
}

fn delete_attachment_impl(conn: &Connection, wattle_dir: &Path, id: i64) -> Result<(), String> {
    let path: String = conn
        .query_row(
            "SELECT path FROM attachments WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let file_path = crate::paths::trusted_stored_path(wattle_dir, &path)?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM attachments WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if let Some(file_path) = file_path {
        crate::paths::remove_file_if_present(&file_path)?;
    }
    tx.commit().map_err(|e| e.to_string())
}

/// Copies an attachment out to a path the reader named.
fn save_attachment_impl(
    conn: &Connection,
    wattle_dir: &Path,
    id: i64,
    destination_path: &Path,
) -> Result<(), String> {
    let path: String = conn
        .query_row(
            "SELECT path FROM attachments WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let source = crate::paths::stored_path(wattle_dir, &path)?;
    if !source.is_file() {
        return Err("the attachment is no longer on disk".to_string());
    }
    std::fs::copy(&source, destination_path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn save_attachment_as(
    state: State<AppState>,
    id: i64,
    destination_path: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    save_attachment_impl(
        &conn,
        &state.wattle_dir()?,
        id,
        std::path::Path::new(&destination_path),
    )
}

#[tauri::command]
pub fn add_attachment(
    state: State<AppState>,
    entry_id: i64,
    source_path: String,
) -> Result<AttachmentDto, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    add_attachment_impl(&mut conn, &state.wattle_dir()?, entry_id, source_path)
}

#[tauri::command]
pub fn list_attachments(
    state: State<AppState>,
    entry_id: i64,
) -> Result<Vec<AttachmentDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    list_attachments_impl(&conn, entry_id)
}

#[tauri::command]
pub fn delete_attachment(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    delete_attachment_impl(&conn, &state.wattle_dir()?, id)
}

/// Brings an entry's attachments back in line with its document.
#[tauri::command]
pub fn reconcile_entry_attachments(state: State<AppState>, entry_id: i64) -> Result<usize, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    quarantine_entry_orphans(&conn, &state.wattle_dir()?, entry_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_temp_file(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(name);
        std::fs::write(&path, bytes).unwrap();
        path
    }

    fn document_referencing(ids: &[i64]) -> String {
        let nodes = ids
            .iter()
            .map(|id| format!(r#"{{"type":"imageAttachment","attrs":{{"attachmentId":{id}}}}}"#))
            .collect::<Vec<_>>()
            .join(",");
        format!(r#"{{"type":"doc","content":[{nodes}]}}"#)
    }

    fn seed_attachment(conn: &Connection, wattle_dir: &Path, entry_id: i64, name: &str) -> i64 {
        let relative = format!("attachments/{entry_id}/{name}");
        std::fs::create_dir_all(wattle_dir.join(format!("attachments/{entry_id}"))).unwrap();
        std::fs::write(wattle_dir.join(&relative), b"bytes").unwrap();
        conn.execute(
            "INSERT INTO attachments (entry_id, filename, mime_type, size, path) \
             VALUES (?1, ?2, 'image/png', 5, ?3)",
            params![entry_id, name, relative],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn saving_an_attachment_copies_it_and_leaves_the_original_alone() {
        let conn = crate::db::init_db_at_connection_for_test();
        let wattle_dir = std::env::temp_dir().join("wattle_test_save_attachment");
        std::fs::remove_dir_all(&wattle_dir).ok();
        std::fs::create_dir_all(&wattle_dir).unwrap();

        conn.execute(
            "INSERT INTO entries (id, entry_date) VALUES (1, '2026-08-15')",
            [],
        )
        .unwrap();
        let id = seed_attachment(&conn, &wattle_dir, 1, "notes.pdf");
        let destination = wattle_dir.join("elsewhere.pdf");

        save_attachment_impl(&conn, &wattle_dir, id, &destination).unwrap();

        assert_eq!(std::fs::read(&destination).unwrap(), b"bytes");
        assert!(
            wattle_dir.join("attachments/1/notes.pdf").is_file(),
            "the journal's own copy must survive being downloaded"
        );
        assert!(
            conn.query_row(
                "SELECT COUNT(*) FROM attachments WHERE id = ?1",
                params![id],
                |row| row.get::<_, i64>(0)
            )
            .unwrap()
                == 1
        );

        std::fs::remove_file(wattle_dir.join("attachments/1/notes.pdf")).unwrap();
        assert!(save_attachment_impl(&conn, &wattle_dir, id, &destination).is_err());

        std::fs::remove_dir_all(&wattle_dir).ok();
    }

    #[test]
    fn orphans_are_quarantined_while_referenced_attachments_are_left_alone() {
        let conn = crate::db::init_db_at_connection_for_test();
        let wattle_dir = std::env::temp_dir().join("wattle_test_quarantine_orphans");
        std::fs::remove_dir_all(&wattle_dir).ok();
        std::fs::create_dir_all(&wattle_dir).unwrap();

        conn.execute(
            "INSERT INTO entries (id, entry_date) VALUES (1, '2026-08-15')",
            [],
        )
        .unwrap();
        let kept = seed_attachment(&conn, &wattle_dir, 1, "kept.png");
        let orphan = seed_attachment(&conn, &wattle_dir, 1, "orphan.png");
        let ghost = seed_attachment(&conn, &wattle_dir, 1, "ghost.png");
        std::fs::remove_file(wattle_dir.join(format!("attachments/1/ghost.png"))).unwrap();

        conn.execute(
            "UPDATE entries SET content = ?1 WHERE id = 1",
            params![document_referencing(&[kept])],
        )
        .unwrap();

        let quarantined = quarantine_orphans(&conn, &wattle_dir).unwrap();
        assert_eq!(quarantined, 2);

        assert!(wattle_dir.join("attachments/1/kept.png").exists());
        assert_eq!(list_attachments_impl(&conn, 1).unwrap().len(), 1);
        assert_eq!(list_attachments_impl(&conn, 1).unwrap()[0].id, kept);

        assert!(!wattle_dir.join("attachments/1/orphan.png").exists());
        assert!(wattle_dir
            .join("attachments/.orphaned/1/orphan.png")
            .exists());
        assert_eq!(
            std::fs::read(wattle_dir.join("attachments/.orphaned/1/orphan.png")).unwrap(),
            b"bytes"
        );

        let remaining: Vec<i64> = list_attachments_impl(&conn, 1)
            .unwrap()
            .iter()
            .map(|a| a.id)
            .collect();
        assert!(!remaining.contains(&orphan));
        assert!(!remaining.contains(&ghost));

        std::fs::remove_dir_all(&wattle_dir).ok();
    }

    #[test]
    fn an_unreadable_document_protects_its_attachments_rather_than_orphaning_them() {
        let conn = crate::db::init_db_at_connection_for_test();
        let wattle_dir = std::env::temp_dir().join("wattle_test_quarantine_unreadable");
        std::fs::remove_dir_all(&wattle_dir).ok();
        std::fs::create_dir_all(&wattle_dir).unwrap();

        conn.execute(
            "INSERT INTO entries (id, content, entry_date) VALUES (1, 'not json', '2026-08-15')",
            [],
        )
        .unwrap();
        seed_attachment(&conn, &wattle_dir, 1, "unknowable.png");

        assert_eq!(quarantine_orphans(&conn, &wattle_dir).unwrap(), 0);
        assert!(wattle_dir.join("attachments/1/unknowable.png").exists());
        assert_eq!(list_attachments_impl(&conn, 1).unwrap().len(), 1);

        std::fs::remove_dir_all(&wattle_dir).ok();
    }

    #[test]
    fn closing_an_entry_reconciles_nodes_removed_by_any_means() {
        let conn = crate::db::init_db_at_connection_for_test();
        let wattle_dir = std::env::temp_dir().join("wattle_test_reconcile_on_close");
        std::fs::remove_dir_all(&wattle_dir).ok();
        std::fs::create_dir_all(&wattle_dir).unwrap();

        conn.execute(
            "INSERT INTO entries (id, entry_date) VALUES (1, '2026-08-15')",
            [],
        )
        .unwrap();
        let kept = seed_attachment(&conn, &wattle_dir, 1, "kept.png");
        let removed = seed_attachment(&conn, &wattle_dir, 1, "removed.png");

        conn.execute(
            "UPDATE entries SET content = ?1 WHERE id = 1",
            params![document_referencing(&[kept, removed])],
        )
        .unwrap();
        assert_eq!(quarantine_entry_orphans(&conn, &wattle_dir, 1).unwrap(), 0);
        assert!(wattle_dir.join("attachments/1/removed.png").exists());

        conn.execute(
            "UPDATE entries SET content = ?1 WHERE id = 1",
            params![document_referencing(&[kept])],
        )
        .unwrap();
        assert_eq!(quarantine_entry_orphans(&conn, &wattle_dir, 1).unwrap(), 1);

        assert!(wattle_dir.join("attachments/1/kept.png").exists());
        assert!(!wattle_dir.join("attachments/1/removed.png").exists());
        assert!(wattle_dir
            .join("attachments/.orphaned/1/removed.png")
            .exists());
        assert_eq!(list_attachments_impl(&conn, 1).unwrap().len(), 1);
    }

    #[test]
    fn undoing_a_deletion_before_closing_keeps_the_attachment() {
        let conn = crate::db::init_db_at_connection_for_test();
        let wattle_dir = std::env::temp_dir().join("wattle_test_reconcile_undo");
        std::fs::remove_dir_all(&wattle_dir).ok();
        std::fs::create_dir_all(&wattle_dir).unwrap();

        conn.execute(
            "INSERT INTO entries (id, entry_date) VALUES (1, '2026-08-15')",
            [],
        )
        .unwrap();
        let attachment = seed_attachment(&conn, &wattle_dir, 1, "restored.png");

        conn.execute(
            "UPDATE entries SET content = ?1 WHERE id = 1",
            params![document_referencing(&[])],
        )
        .unwrap();
        conn.execute(
            "UPDATE entries SET content = ?1 WHERE id = 1",
            params![document_referencing(&[attachment])],
        )
        .unwrap();

        assert_eq!(quarantine_entry_orphans(&conn, &wattle_dir, 1).unwrap(), 0);
        assert!(wattle_dir.join("attachments/1/restored.png").exists());
        assert_eq!(list_attachments_impl(&conn, 1).unwrap().len(), 1);
    }

    #[test]
    fn reconciling_only_touches_the_entry_it_was_asked_about() {
        let conn = crate::db::init_db_at_connection_for_test();
        let wattle_dir = std::env::temp_dir().join("wattle_test_reconcile_scope");
        std::fs::remove_dir_all(&wattle_dir).ok();
        std::fs::create_dir_all(&wattle_dir).unwrap();

        for id in [1, 2] {
            conn.execute(
                "INSERT INTO entries (id, entry_date) VALUES (?1, '2026-08-15')",
                params![id],
            )
            .unwrap();
            seed_attachment(&conn, &wattle_dir, id, "orphan.png");
        }

        assert_eq!(quarantine_entry_orphans(&conn, &wattle_dir, 1).unwrap(), 1);
        assert!(wattle_dir.join("attachments/2/orphan.png").exists());
        assert_eq!(list_attachments_impl(&conn, 2).unwrap().len(), 1);

        assert_eq!(quarantine_entry_orphans(&conn, &wattle_dir, 99).unwrap(), 0);
    }

    #[test]
    fn quarantine_is_idempotent() {
        let conn = crate::db::init_db_at_connection_for_test();
        let wattle_dir = std::env::temp_dir().join("wattle_test_quarantine_twice");
        std::fs::remove_dir_all(&wattle_dir).ok();
        std::fs::create_dir_all(&wattle_dir).unwrap();

        conn.execute(
            "INSERT INTO entries (id, entry_date) VALUES (1, '2026-08-15')",
            [],
        )
        .unwrap();
        seed_attachment(&conn, &wattle_dir, 1, "orphan.png");

        assert_eq!(quarantine_orphans(&conn, &wattle_dir).unwrap(), 1);
        assert_eq!(quarantine_orphans(&conn, &wattle_dir).unwrap(), 0);

        std::fs::remove_dir_all(&wattle_dir).ok();
    }

    #[test]
    fn add_list_delete_attachment_roundtrip() {
        let mut conn = crate::db::init_db_at_connection_for_test();
        conn.execute(
            "INSERT INTO entries (id, entry_date) VALUES (1, '2026-08-15')",
            [],
        )
        .unwrap();

        let wattle_dir = std::env::temp_dir().join("wattle_test_attachments_add_list_delete");
        std::fs::create_dir_all(&wattle_dir).unwrap();
        let source = write_temp_file("wattle_test_attachment_source.png", b"fake-png-bytes");

        let added = add_attachment_impl(
            &mut conn,
            &wattle_dir,
            1,
            source.to_string_lossy().to_string(),
        )
        .unwrap();
        assert_eq!(added.entry_id, 1);
        assert_eq!(added.filename, "wattle_test_attachment_source.png");
        assert_eq!(added.mime_type, "image/png");
        assert_eq!(added.size, 14);
        assert_eq!(added.path, format!("attachments/1/{}.png", added.id));
        assert!(wattle_dir.join(&added.path).exists());

        let list = list_attachments_impl(&conn, 1).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, added.id);

        delete_attachment_impl(&conn, &wattle_dir, added.id).unwrap();
        assert!(!wattle_dir.join(&added.path).exists());
        assert!(list_attachments_impl(&conn, 1).unwrap().is_empty());

        std::fs::remove_file(&source).ok();
        std::fs::remove_dir_all(&wattle_dir).ok();
    }

    fn victim(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(name);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("victim.txt");
        std::fs::write(&path, b"not wattle's").unwrap();
        path
    }

    fn seed_stored_path(conn: &Connection, entry_id: i64, stored: &str) -> i64 {
        conn.execute(
            "INSERT INTO attachments (entry_id, filename, mime_type, size, path) \
             VALUES (?1, 'victim.txt', 'text/plain', 12, ?2)",
            params![entry_id, stored],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn hostile_journal(
        name: &str,
    ) -> (
        Connection,
        std::path::PathBuf,
        std::path::PathBuf,
        Vec<String>,
    ) {
        let conn = crate::db::init_db_at_connection_for_test();
        let wattle_dir = std::env::temp_dir().join(name);
        std::fs::remove_dir_all(&wattle_dir).ok();
        std::fs::create_dir_all(wattle_dir.join("attachments/1")).unwrap();
        conn.execute(
            "INSERT INTO entries (id, entry_date) VALUES (1, '2026-08-15')",
            [],
        )
        .unwrap();
        let victim_dir = format!("{name}_victim");
        let victim = victim(&victim_dir);
        let stored = vec![
            victim.to_string_lossy().to_string(),
            format!("attachments/../../{victim_dir}/victim.txt"),
            format!("attachments/1/../../../{victim_dir}/victim.txt"),
        ];
        (conn, wattle_dir, victim, stored)
    }

    #[test]
    fn reconciling_rows_that_point_outside_drops_them_and_leaves_the_files() {
        let (conn, wattle_dir, victim, stored) = hostile_journal("wattle_test_hostile_reconcile");
        for path in &stored {
            seed_stored_path(&conn, 1, path);
        }

        quarantine_entry_orphans(&conn, &wattle_dir, 1).unwrap();

        assert_eq!(std::fs::read(&victim).unwrap(), b"not wattle's");
        assert!(list_attachments_impl(&conn, 1).unwrap().is_empty());
        assert!(!wattle_dir
            .join(ORPHAN_DIR)
            .join("1")
            .join("victim.txt")
            .exists());

        std::fs::remove_dir_all(&wattle_dir).ok();
        std::fs::remove_dir_all(victim.parent().unwrap()).ok();
    }

    #[test]
    fn deleting_a_row_that_points_outside_leaves_the_file() {
        let (conn, wattle_dir, victim, stored) = hostile_journal("wattle_test_hostile_delete");
        for path in &stored {
            let id = seed_stored_path(&conn, 1, path);
            delete_attachment_impl(&conn, &wattle_dir, id).unwrap();
            assert_eq!(std::fs::read(&victim).unwrap(), b"not wattle's", "{path}");
        }
        assert!(list_attachments_impl(&conn, 1).unwrap().is_empty());

        std::fs::remove_dir_all(&wattle_dir).ok();
        std::fs::remove_dir_all(victim.parent().unwrap()).ok();
    }

    #[test]
    fn saving_a_row_that_points_outside_is_refused() {
        let (conn, wattle_dir, victim, stored) = hostile_journal("wattle_test_hostile_save");
        let destination = wattle_dir.join("copied.txt");
        for path in &stored {
            let id = seed_stored_path(&conn, 1, path);
            assert_eq!(
                save_attachment_impl(&conn, &wattle_dir, id, &destination).unwrap_err(),
                crate::paths::PATH_OUTSIDE_JOURNAL,
                "{path}"
            );
        }
        assert!(!destination.exists());

        std::fs::remove_dir_all(&wattle_dir).ok();
        std::fs::remove_dir_all(victim.parent().unwrap()).ok();
    }

    #[cfg(windows)]
    #[test]
    fn an_unreadable_folder_never_costs_a_row() {
        let conn = crate::db::init_db_at_connection_for_test();
        let wattle_dir = std::env::temp_dir().join("wattle_test_transient_rows");
        std::fs::remove_dir_all(&wattle_dir).ok();
        std::fs::create_dir_all(&wattle_dir).unwrap();
        conn.execute(
            "INSERT INTO entries (id, entry_date) VALUES (1, '2026-08-15')",
            [],
        )
        .unwrap();
        seed_attachment(&conn, &wattle_dir, 1, "orphan.png");
        let deleted = seed_attachment(&conn, &wattle_dir, 1, "deleted.png");

        {
            let _denied = crate::paths::test_support::Denied::on(&wattle_dir.join("attachments/1"));
            assert_eq!(quarantine_entry_orphans(&conn, &wattle_dir, 1).unwrap(), 0);
            assert!(delete_attachment_impl(&conn, &wattle_dir, deleted).is_err());
            assert_eq!(
                list_attachments_impl(&conn, 1).unwrap().len(),
                2,
                "no row may be lost to an I/O error"
            );
        }

        assert!(wattle_dir.join("attachments/1/orphan.png").is_file());
        assert!(wattle_dir.join("attachments/1/deleted.png").is_file());
        delete_attachment_impl(&conn, &wattle_dir, deleted).unwrap();
        assert!(!wattle_dir.join("attachments/1/deleted.png").exists());
        assert_eq!(quarantine_entry_orphans(&conn, &wattle_dir, 1).unwrap(), 1);
        assert!(list_attachments_impl(&conn, 1).unwrap().is_empty());

        std::fs::remove_dir_all(&wattle_dir).ok();
    }

    #[test]
    fn an_orphan_is_never_moved_through_a_link_in_the_quarantine() {
        let conn = crate::db::init_db_at_connection_for_test();
        let wattle_dir = std::env::temp_dir().join("wattle_test_quarantine_link");
        let outside = std::env::temp_dir().join("wattle_test_quarantine_link_outside");
        std::fs::remove_dir_all(&wattle_dir).ok();
        std::fs::remove_dir_all(&outside).ok();
        std::fs::create_dir_all(wattle_dir.join(ORPHAN_DIR)).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        conn.execute(
            "INSERT INTO entries (id, entry_date) VALUES (1, '2026-08-15')",
            [],
        )
        .unwrap();
        seed_attachment(&conn, &wattle_dir, 1, "orphan.png");
        let linked = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(wattle_dir.join("attachments").join(".orphaned").join("1"))
            .arg(&outside)
            .output()
            .is_ok_and(|output| output.status.success());
        assert!(linked || !cfg!(windows), "a junction could not be created");
        if !linked {
            return;
        }

        assert_eq!(quarantine_entry_orphans(&conn, &wattle_dir, 1).unwrap(), 0);
        assert!(wattle_dir.join("attachments/1/orphan.png").is_file());
        assert_eq!(std::fs::read_dir(&outside).unwrap().count(), 0);
        assert_eq!(list_attachments_impl(&conn, 1).unwrap().len(), 1);

        std::fs::remove_dir(wattle_dir.join("attachments").join(".orphaned").join("1")).ok();
        std::fs::remove_dir_all(&wattle_dir).ok();
        std::fs::remove_dir_all(&outside).ok();
    }
}
