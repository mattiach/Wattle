//! Letters to a future self.

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;
use zeroize::Zeroizing;

use crate::commands::entries::is_calendar_date;
use crate::crypto;
use crate::state::AppState;

/// The closest a letter may be sealed for.
const MIN_DAYS_AHEAD: i64 = 7;

/// The furthest, counted in days so the check needs no calendar arithmetic:
/// fifty average Gregorian years, rounded up.
const MAX_DAYS_AHEAD: i64 = 18_263;

/// The first field of the associated data, and the reason a letter sealed by
/// some other program cannot be mistaken for one of these.
const AAD_PREFIX: &str = "wattle-letter-v1";

/// ASCII unit separator: it cannot occur in an id, a calendar date or an
/// ISO-8601 instant, so the four fields below cannot be made to run together.
const AAD_SEPARATOR: u8 = 0x1F;

/// What can go wrong, as codes the interface turns into sentences.
pub struct LetterError;

impl LetterError {
    pub const NOT_FOUND: &'static str = "letter:notFound";
    /// Asked for before its day. The commonest refusal, and not a failure.
    pub const NOT_YET: &'static str = "letter:notYet";
    /// A write aimed at a letter that is no longer a draft.
    pub const SEALED: &'static str = "letter:sealed";
    /// Nothing written, so there is nothing to seal.
    pub const EMPTY: &'static str = "letter:empty";
    pub const TOO_SOON: &'static str = "letter:tooSoon";
    pub const TOO_FAR: &'static str = "letter:tooFar";
    pub const BAD_DATE: &'static str = "letter:badDate";
    /// The row is there and its key is not.
    pub const NO_KEY: &'static str = "letter:noKey";
    /// The seal no longer matches what it was closed with.
    pub const CORRUPT: &'static str = "letter:corrupt";
    /// Sealed by a newer Wattle than this one.
    pub const FUTURE_ENVELOPE: &'static str = "letter:futureEnvelope";
}

/// A letter as the archive and the home screen see it: **never its words.**
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LetterSummaryDto {
    pub id: i64,
    /// "draft" or "sealed".
    pub status: String,
    pub written_on: String,
    /// Empty while a draft has not been given a date yet.
    pub unlock_on: String,
    pub word_count: i64,
    pub sealed_at: String,
    pub opened_at: String,
    /// `sealed AND today >= unlock_on`, worked out at the moment of asking.
    pub available: bool,
    pub prompt_id: String,
}

/// A letter with its words in it. Only ever a draft, or one whose day has come.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LetterDto {
    pub id: i64,
    pub status: String,
    /// Tiptap JSON - the same representation `entries.content` uses, so the
    /// exporters and the editor need nothing new to read a letter.
    pub content: String,
    pub written_on: String,
    pub unlock_on: String,
    pub word_count: i64,
    pub sealed_at: String,
    pub opened_at: String,
    pub prompt_id: String,
}

/// A letter's own file, as the editor sees it.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LetterAttachmentDto {
    pub id: i64,
    pub letter_id: i64,
    pub filename: String,
    pub mime_type: String,
    pub size: i64,
    /// Where the readable file is, relative to the Wattle folder.
    pub path: String,
    pub created_at: String,
}

/// What the home screen needs, in one question rather than three.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LetterStatusDto {
    /// Letters whose day has come and which have not been opened.
    pub arrived: Vec<LetterSummaryDto>,
    /// The **nearest** letter still waiting, and only that one.
    pub waiting: Option<LetterSummaryDto>,
}

/// The row, as everything here reads it.
#[cfg_attr(test, derive(Debug))]
struct Row {
    id: i64,
    status: String,
    content: String,
    ciphertext: Option<Vec<u8>>,
    nonce: Option<Vec<u8>>,
    algorithm: String,
    envelope: i64,
    written_on: String,
    unlock_on: Option<String>,
    sealed_at: Option<String>,
    opened_at: Option<String>,
    word_count: i64,
    prompt_id: String,
}

const SELECT: &str = "SELECT id, status, content, ciphertext, nonce, algorithm, envelope, \
                             written_on, unlock_on, sealed_at, opened_at, word_count, prompt_id \
                      FROM letters";

fn read_row(row: &rusqlite::Row) -> rusqlite::Result<Row> {
    Ok(Row {
        id: row.get(0)?,
        status: row.get(1)?,
        content: row.get(2)?,
        ciphertext: row.get(3)?,
        nonce: row.get(4)?,
        algorithm: row.get(5)?,
        envelope: row.get(6)?,
        written_on: row.get(7)?,
        unlock_on: row.get(8)?,
        sealed_at: row.get(9)?,
        opened_at: row.get(10)?,
        word_count: row.get(11)?,
        prompt_id: row.get(12)?,
    })
}

fn fetch(conn: &Connection, id: i64) -> Result<Row, String> {
    conn.query_row(&format!("{SELECT} WHERE id = ?1"), params![id], read_row)
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| LetterError::NOT_FOUND.to_string())
}

impl Row {
    fn unlock(&self) -> &str {
        self.unlock_on.as_deref().unwrap_or_default()
    }

    /// **The derivation, in one place.** A sealed letter whose day has come is
    /// available; nothing was written to make that true and nothing will be
    /// written when it stops being false.
    fn is_available(&self, today: &str) -> bool {
        self.status == "sealed" && !self.unlock().is_empty() && today >= self.unlock()
    }

    fn to_summary(&self, today: &str) -> LetterSummaryDto {
        LetterSummaryDto {
            available: self.is_available(today),
            id: self.id,
            opened_at: self.opened_at.clone().unwrap_or_default(),
            prompt_id: self.prompt_id.clone(),
            sealed_at: self.sealed_at.clone().unwrap_or_default(),
            status: self.status.clone(),
            unlock_on: self.unlock().to_string(),
            word_count: self.word_count,
            written_on: self.written_on.clone(),
        }
    }

    fn to_letter(&self, content: String) -> LetterDto {
        LetterDto {
            content,
            id: self.id,
            opened_at: self.opened_at.clone().unwrap_or_default(),
            prompt_id: self.prompt_id.clone(),
            sealed_at: self.sealed_at.clone().unwrap_or_default(),
            status: self.status.clone(),
            unlock_on: self.unlock().to_string(),
            word_count: self.word_count,
            written_on: self.written_on.clone(),
        }
    }
}

/// Today, where the reader is, taken from the machine and never from a caller.
fn today(conn: &Connection) -> Result<String, String> {
    conn.query_row("SELECT date('now','localtime')", [], |row| row.get(0))
        .map_err(|e| e.to_string())
}

fn now(conn: &Connection) -> Result<String, String> {
    conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |row| {
        row.get(0)
    })
    .map_err(|e| e.to_string())
}

/// What the seal is bound to, rebuilt from the row's own columns.
fn associated_data(id: i64, unlock_on: &str, sealed_at: &str) -> Vec<u8> {
    let mut aad = Vec::with_capacity(64);
    aad.extend_from_slice(AAD_PREFIX.as_bytes());
    for field in [id.to_string().as_str(), unlock_on, sealed_at] {
        aad.push(AAD_SEPARATOR);
        aad.extend_from_slice(field.as_bytes());
    }
    aad
}

/// Where a letter's files live while it is a draft.
fn draft_attachment_dir(letter_id: i64) -> String {
    format!("attachments/letters/{letter_id}")
}

/// Where they live once it is sealed: **outside** `attachments/`, so the asset
/// protocol cannot serve them even if a path were somehow handed to it.
fn sealed_attachment_dir(letter_id: i64) -> String {
    format!("sealed-letters/{letter_id}")
}

/// The seal on one file.
fn attachment_associated_data(
    letter_id: i64,
    attachment_id: i64,
    unlock_on: &str,
    sealed_at: &str,
) -> Vec<u8> {
    let mut aad = Vec::with_capacity(96);
    aad.extend_from_slice(b"wattle-letter-attachment-v1");
    for field in [
        letter_id.to_string().as_str(),
        attachment_id.to_string().as_str(),
        unlock_on,
        sealed_at,
    ] {
        aad.push(AAD_SEPARATOR);
        aad.extend_from_slice(field.as_bytes());
    }
    aad
}

/// Whether a chosen date is one a letter may be sealed for, judged against the
/// day of sealing - never against the day the draft happened to be started, so
/// a draft left alone for a year is re-judged rather than let through.
fn check_unlock_date(unlock_on: &str, today: &str) -> Result<(), String> {
    if !is_calendar_date(unlock_on) {
        return Err(LetterError::BAD_DATE.to_string());
    }
    let (Some(chosen), Some(now)) = (
        crate::commands::calendar::days_from_civil(unlock_on),
        crate::commands::calendar::days_from_civil(today),
    ) else {
        return Err(LetterError::BAD_DATE.to_string());
    };
    let ahead = chosen - now;
    if ahead < MIN_DAYS_AHEAD {
        return Err(LetterError::TOO_SOON.to_string());
    }
    if ahead > MAX_DAYS_AHEAD {
        return Err(LetterError::TOO_FAR.to_string());
    }
    Ok(())
}

fn require_draft(row: &Row) -> Result<(), String> {
    if row.status == "draft" {
        Ok(())
    } else {
        Err(LetterError::SEALED.to_string())
    }
}

fn create_impl(conn: &Connection, prompt_id: &str) -> Result<LetterDto, String> {
    let written_on = today(conn)?;
    conn.execute(
        "INSERT INTO letters (written_on, prompt_id) VALUES (?1, ?2)",
        params![written_on, prompt_id],
    )
    .map_err(|e| e.to_string())?;
    let row = fetch(conn, conn.last_insert_rowid())?;
    let content = row.content.clone();
    Ok(row.to_letter(content))
}

/// Saves the draft, and the date chosen for it so far.
fn save_draft_impl(
    conn: &Connection,
    id: i64,
    content: &str,
    unlock_on: &str,
    prompt_id: &str,
) -> Result<LetterDto, String> {
    require_draft(&fetch(conn, id)?)?;
    let derived = crate::content::derive(content);
    conn.execute(
        "UPDATE letters SET content = ?1, word_count = ?2, unlock_on = NULLIF(?3, ''), \
         prompt_id = ?4, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?5",
        params![content, derived.word_count, unlock_on, prompt_id, id],
    )
    .map_err(|e| e.to_string())?;
    let row = fetch(conn, id)?;
    let saved = row.content.clone();
    Ok(row.to_letter(saved))
}

/// Throws a draft away. **Only a draft.**
fn delete_impl(conn: &Connection, wattle_dir: &Path, id: i64) -> Result<(), String> {
    require_draft(&fetch(conn, id)?)?;
    conn.execute("DELETE FROM letters WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    std::fs::remove_dir_all(wattle_dir.join(draft_attachment_dir(id))).ok();
    Ok(())
}

const ATTACHMENT_SELECT: &str =
    "SELECT id, letter_id, filename, mime_type, size, path, created_at \
     FROM letter_attachments";

fn read_attachment(row: &rusqlite::Row) -> rusqlite::Result<LetterAttachmentDto> {
    Ok(LetterAttachmentDto {
        id: row.get(0)?,
        letter_id: row.get(1)?,
        filename: row.get(2)?,
        mime_type: row.get(3)?,
        size: row.get(4)?,
        path: row.get(5)?,
        created_at: row.get(6)?,
    })
}

/// Whether this letter's files may be handled at all right now.
fn require_readable_attachments(row: &Row) -> Result<(), String> {
    if row.status == "draft" || row.opened_at.is_some() {
        Ok(())
    } else {
        Err(LetterError::NOT_YET.to_string())
    }
}

fn add_attachment_impl(
    conn: &mut Connection,
    wattle_dir: &Path,
    letter_id: i64,
    source_path: &str,
) -> Result<LetterAttachmentDto, String> {
    require_draft(&fetch(conn, letter_id)?)?;

    let source = Path::new(source_path);
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
        "INSERT INTO letter_attachments (letter_id, filename, mime_type, size) \
         VALUES (?1, ?2, ?3, ?4)",
        params![letter_id, filename, mime_type, size],
    )
    .map_err(|e| e.to_string())?;
    let id = tx.last_insert_rowid();

    let relative = if extension.is_empty() {
        format!("{}/{id}", draft_attachment_dir(letter_id))
    } else {
        format!("{}/{id}.{extension}", draft_attachment_dir(letter_id))
    };
    let destination = crate::paths::stored_path(wattle_dir, &relative)?;
    std::fs::create_dir_all(
        destination
            .parent()
            .ok_or_else(|| "invalid destination path".to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let destination = crate::paths::stored_path(wattle_dir, &relative)?;
    std::fs::copy(source, &destination).map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE letter_attachments SET path = ?1 WHERE id = ?2",
        params![relative, id],
    )
    .map_err(|e| e.to_string())?;
    let added = tx
        .query_row(
            &format!("{ATTACHMENT_SELECT} WHERE id = ?1"),
            params![id],
            read_attachment,
        )
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(added)
}

fn list_attachments_impl(
    conn: &Connection,
    letter_id: i64,
) -> Result<Vec<LetterAttachmentDto>, String> {
    require_readable_attachments(&fetch(conn, letter_id)?)?;
    let mut stmt = conn
        .prepare(&format!(
            "{ATTACHMENT_SELECT} WHERE letter_id = ?1 AND path <> '' ORDER BY created_at ASC, id ASC"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![letter_id], read_attachment)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

/// The letter an attachment belongs to, and the attachment's own row.
fn fetch_attachment(conn: &Connection, id: i64) -> Result<(Row, LetterAttachmentDto), String> {
    let attachment = conn
        .query_row(
            &format!("{ATTACHMENT_SELECT} WHERE id = ?1"),
            params![id],
            read_attachment,
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| LetterError::NOT_FOUND.to_string())?;
    Ok((fetch(conn, attachment.letter_id)?, attachment))
}

fn delete_attachment_impl(conn: &Connection, wattle_dir: &Path, id: i64) -> Result<(), String> {
    let (letter, attachment) = fetch_attachment(conn, id)?;
    require_draft(&letter)?;
    let file = crate::paths::trusted_stored_path(wattle_dir, &attachment.path)?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM letter_attachments WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if let Some(file) = file {
        crate::paths::remove_file_if_present(&file)?;
    }
    tx.commit().map_err(|e| e.to_string())
}

/// Copies one file back out to a path the reader named.
fn save_attachment_impl(
    conn: &Connection,
    wattle_dir: &Path,
    id: i64,
    destination: &Path,
) -> Result<(), String> {
    let (letter, attachment) = fetch_attachment(conn, id)?;
    require_readable_attachments(&letter)?;
    if attachment.path.is_empty() {
        return Err(LetterError::NOT_YET.to_string());
    }
    std::fs::copy(
        crate::paths::stored_path(wattle_dir, &attachment.path)?,
        destination,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Drops the rows and files a draft's document no longer references.
fn reconcile_attachments_impl(
    conn: &Connection,
    wattle_dir: &Path,
    letter_id: i64,
) -> Result<(), String> {
    let letter = fetch(conn, letter_id)?;
    require_draft(&letter)?;
    let Ok(document) = serde_json::from_str::<serde_json::Value>(&letter.content) else {
        return Ok(());
    };
    let referenced = crate::content::collect_attachment_ids(&document);

    let mut stmt = conn
        .prepare(&format!("{ATTACHMENT_SELECT} WHERE letter_id = ?1"))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![letter_id], read_attachment)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut dropped = Vec::new();
    for attachment in rows
        .iter()
        .filter(|attachment| !referenced.contains(&attachment.id))
    {
        match crate::paths::trusted_stored_path(wattle_dir, &attachment.path) {
            Ok(None) => dropped.push(attachment.id),
            Ok(Some(file)) => {
                if crate::paths::remove_file_if_present(&file).is_ok() {
                    dropped.push(attachment.id);
                }
            }
            Err(_) => {}
        }
    }
    if dropped.is_empty() {
        return Ok(());
    }

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for id in &dropped {
        tx.execute("DELETE FROM letter_attachments WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

/// One file, encrypted into the sealed folder.
fn seal_one_attachment(
    wattle_dir: &Path,
    letter_id: i64,
    attachment: &LetterAttachmentDto,
    key: &[u8],
    unlock_on: &str,
    sealed_at: &str,
) -> Result<Vec<u8>, String> {
    let plain = std::fs::read(crate::paths::stored_path(wattle_dir, &attachment.path)?)
        .map_err(|e| e.to_string())?;
    let nonce = crypto::random_nonce()?;
    let aad = attachment_associated_data(letter_id, attachment.id, unlock_on, sealed_at);
    let sealed = crypto::seal(key, &nonce, &plain, &aad)?;

    let relative = format!("{}/{}", sealed_attachment_dir(letter_id), attachment.id);
    let target = crate::paths::sealed_path(wattle_dir, &relative)?;
    std::fs::create_dir_all(
        target
            .parent()
            .ok_or_else(|| "invalid destination path".to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let target = crate::paths::sealed_path(wattle_dir, &relative)?;
    std::fs::write(target, sealed).map_err(|e| e.to_string())?;
    Ok(nonce)
}

/// One file, opened back into the place the editor expects to find it.
fn unseal_one_attachment(
    wattle_dir: &Path,
    row: &Row,
    attachment_id: i64,
    filename: &str,
    nonce: &[u8],
    key: &[u8],
) -> Option<String> {
    let letter_id = row.id;
    let sealed_path = crate::paths::sealed_path(
        wattle_dir,
        &format!("{}/{attachment_id}", sealed_attachment_dir(letter_id)),
    )
    .ok()?;
    let sealed = std::fs::read(&sealed_path).ok()?;
    let aad = attachment_associated_data(
        letter_id,
        attachment_id,
        row.unlock(),
        row.sealed_at.as_deref().unwrap_or_default(),
    );
    let plain = crypto::unseal(key, nonce, &sealed, &aad).ok()?;

    let extension = Path::new(filename)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("");
    let relative = if extension.is_empty() {
        format!("{}/{attachment_id}", draft_attachment_dir(letter_id))
    } else {
        format!(
            "{}/{attachment_id}.{extension}",
            draft_attachment_dir(letter_id)
        )
    };
    let destination = crate::paths::stored_path(wattle_dir, &relative).ok()?;
    std::fs::create_dir_all(destination.parent()?).ok()?;
    let destination = crate::paths::stored_path(wattle_dir, &relative).ok()?;
    std::fs::write(&destination, plain).ok()?;
    std::fs::remove_file(&sealed_path).ok();
    Some(relative)
}

/// Closes a letter, permanently.
fn seal_impl(
    conn: &mut Connection,
    wattle_dir: &Path,
    id: i64,
    unlock_on: &str,
    today: &str,
) -> Result<LetterSummaryDto, String> {
    let row = fetch(conn, id)?;
    require_draft(&row)?;
    check_unlock_date(unlock_on, today)?;

    let derived = crate::content::derive(&row.content);
    let attachment_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM letter_attachments WHERE letter_id = ?1 AND path <> ''",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if derived.text.trim().is_empty() && attachment_count == 0 {
        return Err(LetterError::EMPTY.to_string());
    }

    let sealed_at = now(conn)?;
    let key = crypto::random_key()?;
    let nonce = crypto::random_nonce()?;
    let aad = associated_data(row.id, unlock_on, &sealed_at);
    let ciphertext = crypto::seal(&key, &nonce, row.content.as_bytes(), &aad)?;

    let attachments = {
        let mut stmt = conn
            .prepare(&format!(
                "{ATTACHMENT_SELECT} WHERE letter_id = ?1 AND path <> ''"
            ))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![id], read_attachment)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    let mut sealed_files = Vec::with_capacity(attachments.len());
    for attachment in &attachments {
        match seal_one_attachment(wattle_dir, id, attachment, &key, unlock_on, &sealed_at) {
            Ok(nonce) => sealed_files.push((attachment.id, attachment.path.clone(), nonce)),
            Err(error) => {
                std::fs::remove_dir_all(wattle_dir.join(sealed_attachment_dir(id))).ok();
                return Err(error);
            }
        }
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE letters SET status = 'sealed', content = '', ciphertext = ?1, nonce = ?2, \
         algorithm = ?3, envelope = ?4, unlock_on = ?5, sealed_at = ?6, word_count = ?7, \
         updated_at = ?6 WHERE id = ?8 AND status = 'draft'",
        params![
            ciphertext,
            nonce,
            crypto::ALGORITHM,
            crypto::ENVELOPE_VERSION,
            unlock_on,
            sealed_at,
            derived.word_count,
            id
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO letter_keys (letter_id, key) VALUES (?1, ?2)",
        params![id, key],
    )
    .map_err(|e| e.to_string())?;
    for (attachment_id, _, nonce) in &sealed_files {
        tx.execute(
            "UPDATE letter_attachments SET path = '', nonce = ?1 WHERE id = ?2",
            params![nonce, attachment_id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;

    for (_, path, _) in &sealed_files {
        if let Ok(file) = crate::paths::stored_path(wattle_dir, path) {
            std::fs::remove_file(file).ok();
        }
    }

    scrub(conn);

    let row = fetch(conn, id)?;
    Ok(row.to_summary(today))
}

/// Checkpoints and vacuums the database so a sealed draft's plaintext is not
/// left behind. Best effort, never fatal.
fn scrub(conn: &Connection) {
    let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)");
    let _ = conn.execute_batch("VACUUM");
}

/// The one gate: returns a draft as is, and a sealed letter only once its day
/// has come, taking the day from the machine and never from a caller.
fn open_impl(conn: &Connection, wattle_dir: &Path, id: i64) -> Result<LetterDto, String> {
    let row = fetch(conn, id)?;
    if row.status == "draft" {
        let content = row.content.clone();
        return Ok(row.to_letter(content));
    }

    if !row.is_available(&today(conn)?) {
        return Err(LetterError::NOT_YET.to_string());
    }
    if row.envelope > crypto::ENVELOPE_VERSION || row.algorithm != crypto::ALGORITHM {
        return Err(LetterError::FUTURE_ENVELOPE.to_string());
    }

    let (Some(ciphertext), Some(nonce)) = (row.ciphertext.as_ref(), row.nonce.as_ref()) else {
        return Err(LetterError::CORRUPT.to_string());
    };
    let key: Vec<u8> = conn
        .query_row(
            "SELECT key FROM letter_keys WHERE letter_id = ?1",
            params![id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| LetterError::NO_KEY.to_string())?;

    let aad = associated_data(
        row.id,
        row.unlock(),
        row.sealed_at.as_deref().unwrap_or_default(),
    );
    let plaintext = Zeroizing::new(
        crypto::unseal(&key, nonce, ciphertext, &aad)
            .map_err(|_| LetterError::CORRUPT.to_string())?,
    );
    let content =
        String::from_utf8(plaintext.to_vec()).map_err(|_| LetterError::CORRUPT.to_string())?;

    if row.opened_at.is_none() {
        restore_attachments(conn, wattle_dir, &row, &key)?;
        let opened_at = now(conn)?;
        conn.execute(
            "UPDATE letters SET opened_at = ?1, updated_at = ?1 WHERE id = ?2 AND opened_at IS NULL",
            params![opened_at, id],
        )
        .map_err(|e| e.to_string())?;
        index_opened(conn, id, &content)?;
        let reread = fetch(conn, id)?;
        return Ok(reread.to_letter(content));
    }

    Ok(row.to_letter(content))
}

/// Gives a letter's files back, at the moment its words come back.
fn restore_attachments(
    conn: &Connection,
    wattle_dir: &Path,
    row: &Row,
    key: &[u8],
) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, filename, nonce FROM letter_attachments \
                  WHERE letter_id = ?1 AND nonce IS NOT NULL",
        )
        .map_err(|e| e.to_string())?;
    let sealed = stmt
        .query_map(params![row.id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Vec<u8>>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    for (attachment_id, filename, nonce) in sealed {
        let Some(path) =
            unseal_one_attachment(wattle_dir, row, attachment_id, &filename, &nonce, key)
        else {
            continue;
        };
        conn.execute(
            "UPDATE letter_attachments SET path = ?1, nonce = NULL WHERE id = ?2",
            params![path, attachment_id],
        )
        .map_err(|e| e.to_string())?;
    }

    let dir = wattle_dir.join(sealed_attachment_dir(row.id));
    if dir.exists()
        && std::fs::read_dir(&dir)
            .map(|mut d| d.next().is_none())
            .unwrap_or(false)
    {
        std::fs::remove_dir_all(&dir).ok();
    }
    Ok(())
}

/// Puts an opened letter's words into the search index.
fn index_opened(conn: &Connection, id: i64, content: &str) -> Result<(), String> {
    let derived = crate::content::derive(content);
    conn.execute("DELETE FROM letters_fts WHERE rowid = ?1", params![id])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO letters_fts (rowid, content_text) VALUES (?1, ?2)",
        params![id, derived.text],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn list_impl(conn: &Connection) -> Result<Vec<LetterSummaryDto>, String> {
    let today = today(conn)?;
    let mut stmt = conn
        .prepare(&format!(
            "{SELECT} ORDER BY unlock_on IS NULL DESC, unlock_on ASC, id ASC"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], read_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows.iter().map(|row| row.to_summary(&today)).collect())
}

/// What the home screen shows, and the whole of it.
fn status_impl(conn: &Connection) -> Result<LetterStatusDto, String> {
    let today = today(conn)?;
    let letters = list_impl(conn)?;
    Ok(LetterStatusDto {
        arrived: letters
            .into_iter()
            .filter(|letter| letter.available && letter.opened_at.is_empty())
            .collect(),
        waiting: conn
            .query_row(
                &format!(
                    "{SELECT} WHERE status = 'sealed' AND unlock_on > ?1 \
                     ORDER BY unlock_on ASC, id ASC LIMIT 1"
                ),
                params![today],
                read_row,
            )
            .optional()
            .map_err(|e| e.to_string())?
            .map(|row| row.to_summary(&today)),
    })
}

/// One letter, for a file the reader asked for.
pub fn open_letter_for_export(
    conn: &Connection,
    wattle_dir: &Path,
    id: i64,
) -> Result<LetterDto, String> {
    let letter = open_impl(conn, wattle_dir, id)?;
    if letter.status == "draft" {
        return Err(LetterError::NOT_YET.to_string());
    }
    Ok(letter)
}

/// An opened letter's files, for the export.
pub fn opened_attachments(
    conn: &Connection,
    letter_id: i64,
) -> Result<Vec<LetterAttachmentDto>, String> {
    list_attachments_impl(conn, letter_id)
}

/// A draft with words in it, for another module's tests.
#[cfg(test)]
pub fn draft_for_test(conn: &Connection, content: &str) -> i64 {
    let letter = create_impl(conn, "").unwrap();
    save_draft_impl(conn, letter.id, content, "", "").unwrap();
    letter.id
}

#[cfg(test)]
pub fn seal_for_test(
    conn: &mut Connection,
    wattle_dir: &Path,
    id: i64,
    unlock_on: &str,
    sealing_day: &str,
) {
    seal_impl(conn, wattle_dir, id, unlock_on, sealing_day).unwrap();
}

#[tauri::command]
pub fn create_letter(
    state: State<AppState>,
    prompt_id: Option<String>,
) -> Result<LetterDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    create_impl(&conn, prompt_id.as_deref().unwrap_or_default())
}

#[tauri::command]
pub fn save_letter_draft(
    state: State<AppState>,
    id: i64,
    content: String,
    unlock_on: String,
    prompt_id: Option<String>,
) -> Result<LetterDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    save_draft_impl(
        &conn,
        id,
        &content,
        &unlock_on,
        prompt_id.as_deref().unwrap_or_default(),
    )
}

#[tauri::command]
pub fn delete_letter(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    delete_impl(&conn, &state.wattle_dir()?, id)
}

#[tauri::command]
pub fn seal_letter(
    state: State<AppState>,
    id: i64,
    unlock_on: String,
) -> Result<LetterSummaryDto, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let today = today(&conn)?;
    seal_impl(&mut conn, &state.wattle_dir()?, id, &unlock_on, &today)
}

#[tauri::command]
pub fn list_letters(state: State<AppState>) -> Result<Vec<LetterSummaryDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    list_impl(&conn)
}

#[tauri::command]
pub fn letter_status(state: State<AppState>) -> Result<LetterStatusDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    status_impl(&conn)
}

#[tauri::command]
pub fn add_letter_attachment(
    state: State<AppState>,
    letter_id: i64,
    source_path: String,
) -> Result<LetterAttachmentDto, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    add_attachment_impl(&mut conn, &state.wattle_dir()?, letter_id, &source_path)
}

#[tauri::command]
pub fn list_letter_attachments(
    state: State<AppState>,
    letter_id: i64,
) -> Result<Vec<LetterAttachmentDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    list_attachments_impl(&conn, letter_id)
}

#[tauri::command]
pub fn delete_letter_attachment(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    delete_attachment_impl(&conn, &state.wattle_dir()?, id)
}

#[tauri::command]
pub fn save_letter_attachment_as(
    state: State<AppState>,
    id: i64,
    destination_path: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    save_attachment_impl(
        &conn,
        &state.wattle_dir()?,
        id,
        Path::new(&destination_path),
    )
}

#[tauri::command]
pub fn reconcile_letter_attachments(state: State<AppState>, letter_id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    reconcile_attachments_impl(&conn, &state.wattle_dir()?, letter_id)
}

#[tauri::command]
pub fn open_letter(state: State<AppState>, id: i64) -> Result<LetterDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    open_impl(&conn, &state.wattle_dir()?, id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "wattle_letters_{name}_{}_{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn doc(text: &str) -> String {
        serde_json::json!({
            "type": "doc",
            "content": [{
                "type": "paragraph",
                "content": [{ "type": "text", "text": text }]
            }]
        })
        .to_string()
    }

    fn drafted(conn: &Connection, text: &str) -> i64 {
        let letter = create_impl(conn, "").unwrap();
        save_draft_impl(conn, letter.id, &doc(text), "", "").unwrap();
        letter.id
    }

    fn sealed_for(conn: &mut Connection, text: &str, unlock_on: &str, sealing_day: &str) -> i64 {
        let id = drafted(conn, text);
        let dir = scratch("sealed_for");
        seal_impl(conn, &dir, id, unlock_on, sealing_day).unwrap();
        id
    }

    #[test]
    fn a_draft_is_written_saved_and_read_back() {
        let conn = crate::db::init_db_at_connection_for_test();
        let id = drafted(&conn, "something for later");
        let letter = open_impl(&conn, &scratch("open"), id).unwrap();
        assert_eq!(letter.status, "draft");
        assert!(letter.content.contains("something for later"));
        assert_eq!(letter.word_count, 3);
        assert_eq!(letter.opened_at, "");
    }

    #[test]
    fn a_draft_can_be_thrown_away() {
        let conn = crate::db::init_db_at_connection_for_test();
        let id = drafted(&conn, "never mind");
        delete_impl(&conn, &scratch("delete"), id).unwrap();
        assert_eq!(fetch(&conn, id).unwrap_err(), LetterError::NOT_FOUND);
    }

    #[test]
    fn sealing_leaves_no_plaintext_anywhere_in_the_database() {
        let dir =
            std::env::temp_dir().join(format!("wattle_letters_residue_{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        let mut conn = crate::db::init_db(&dir).unwrap();

        const SENTINEL: &str = "zwitterion-pomegranate-47";
        let id = drafted(&conn, SENTINEL);
        seal_impl(&mut conn, &scratch("seal"), id, "2031-03-14", "2026-08-21").unwrap();

        let row = fetch(&conn, id).unwrap();
        assert_eq!(row.status, "sealed");
        assert_eq!(row.content, "", "the draft column must be emptied");
        assert!(row.ciphertext.is_some());
        assert_eq!(row.algorithm, crypto::ALGORITHM);
        assert_eq!(row.envelope, crypto::ENVELOPE_VERSION);
        assert_eq!(row.word_count, 1, "length stays in the clear, on purpose");

        let residue = |bytes: &[u8]| {
            bytes
                .windows(SENTINEL.len())
                .any(|window| window == SENTINEL.as_bytes())
        };
        for name in ["wattle.db", "wattle.db-wal", "wattle.db-shm"] {
            let path = dir.join(name);
            if !path.exists() {
                continue;
            }
            assert!(
                !residue(&std::fs::read(&path).unwrap()),
                "{name} still holds the letter in the clear while Wattle is running"
            );
        }

        drop(conn);
        for name in ["wattle.db", "wattle.db-wal", "wattle.db-shm"] {
            let path = dir.join(name);
            if !path.exists() {
                continue;
            }
            assert!(
                !residue(&std::fs::read(&path).unwrap()),
                "{name} still holds the letter in the clear"
            );
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_seal_refuses_a_date_that_is_too_close_or_too_far() {
        let mut conn = crate::db::init_db_at_connection_for_test();
        let id = drafted(&conn, "a letter");
        assert_eq!(
            seal_impl(&mut conn, &scratch("seal"), id, "2026-08-27", "2026-08-21").unwrap_err(),
            LetterError::TOO_SOON,
            "six days is not a letter"
        );
        assert_eq!(
            seal_impl(&mut conn, &scratch("seal"), id, "2026-08-21", "2026-08-21").unwrap_err(),
            LetterError::TOO_SOON
        );
        assert_eq!(
            seal_impl(&mut conn, &scratch("seal"), id, "2020-01-01", "2026-08-21").unwrap_err(),
            LetterError::TOO_SOON,
            "a draft left for a year is judged against today, not against then"
        );
        assert_eq!(
            seal_impl(&mut conn, &scratch("seal"), id, "2126-08-21", "2026-08-21").unwrap_err(),
            LetterError::TOO_FAR
        );
        assert_eq!(
            seal_impl(&mut conn, &scratch("seal"), id, "not-a-date", "2026-08-21").unwrap_err(),
            LetterError::BAD_DATE
        );
        seal_impl(&mut conn, &scratch("seal"), id, "2026-08-28", "2026-08-21").unwrap();
    }

    #[test]
    fn an_empty_letter_cannot_be_sealed() {
        let mut conn = crate::db::init_db_at_connection_for_test();
        let letter = create_impl(&conn, "").unwrap();
        assert_eq!(
            seal_impl(
                &mut conn,
                &scratch("seal"),
                letter.id,
                "2031-03-14",
                "2026-08-21"
            )
            .unwrap_err(),
            LetterError::EMPTY
        );
        save_draft_impl(&conn, letter.id, &doc("   "), "", "").unwrap();
        assert_eq!(
            seal_impl(
                &mut conn,
                &scratch("seal"),
                letter.id,
                "2031-03-14",
                "2026-08-21"
            )
            .unwrap_err(),
            LetterError::EMPTY
        );
    }

    #[test]
    fn a_sealed_letter_is_immutable() {
        let mut conn = crate::db::init_db_at_connection_for_test();
        let id = drafted(&conn, "the letter");
        seal_impl(&mut conn, &scratch("seal"), id, "2031-03-14", "2026-08-21").unwrap();

        assert_eq!(
            save_draft_impl(&conn, id, &doc("second thoughts"), "", "").unwrap_err(),
            LetterError::SEALED
        );
        assert_eq!(
            delete_impl(&conn, &scratch("delete"), id).unwrap_err(),
            LetterError::SEALED
        );
        assert_eq!(
            seal_impl(&mut conn, &scratch("seal"), id, "2035-01-01", "2026-08-21").unwrap_err(),
            LetterError::SEALED,
            "re-sealing would be re-dating"
        );
        let row = fetch(&conn, id).unwrap();
        assert_eq!(row.unlock(), "2031-03-14");
        assert_eq!(row.content, "");
    }

    #[test]
    fn a_sealed_letter_will_not_open_before_its_day() {
        let mut conn = crate::db::init_db_at_connection_for_test();
        let id = sealed_for(&mut conn, "not yet", "2126-01-01", "2125-12-01");
        assert_eq!(
            open_impl(&conn, &scratch("open"), id).unwrap_err(),
            LetterError::NOT_YET
        );
        assert!(fetch(&conn, id).unwrap().opened_at.is_none());
    }

    #[test]
    fn a_letter_whose_day_has_come_opens_and_records_it_once() {
        let mut conn = crate::db::init_db_at_connection_for_test();
        let id = sealed_for(&mut conn, "hello from before", "2020-01-01", "2019-06-01");

        let opened = open_impl(&conn, &scratch("open"), id).unwrap();
        assert!(opened.content.contains("hello from before"));
        assert_ne!(opened.opened_at, "");

        let again = open_impl(&conn, &scratch("open"), id).unwrap();
        assert!(again.content.contains("hello from before"));
        assert_eq!(
            again.opened_at, opened.opened_at,
            "a letter arrives once, however often it is read"
        );
        assert_eq!(
            delete_impl(&conn, &scratch("delete"), id).unwrap_err(),
            LetterError::SEALED
        );
    }

    #[test]
    fn moving_the_unlock_date_destroys_the_letter() {
        let mut conn = crate::db::init_db_at_connection_for_test();
        let id = sealed_for(&mut conn, "the secret", "2126-01-01", "2125-12-01");

        conn.execute(
            "UPDATE letters SET unlock_on = '2020-01-01' WHERE id = ?1",
            params![id],
        )
        .unwrap();

        assert_eq!(
            open_impl(&conn, &scratch("open"), id).unwrap_err(),
            LetterError::CORRUPT,
            "a tampered date must report corruption, never open and never say 'not yet'"
        );
    }

    #[test]
    fn moving_the_sealing_instant_destroys_the_letter_too() {
        let mut conn = crate::db::init_db_at_connection_for_test();
        let id = sealed_for(&mut conn, "the secret", "2020-01-01", "2019-06-01");

        conn.execute(
            "UPDATE letters SET sealed_at = '2019-01-01T00:00:00.000Z' WHERE id = ?1",
            params![id],
        )
        .unwrap();

        assert_eq!(
            open_impl(&conn, &scratch("open"), id).unwrap_err(),
            LetterError::CORRUPT
        );
    }

    #[test]
    fn a_letter_whose_key_has_gone_says_so_rather_than_saying_not_yet() {
        let mut conn = crate::db::init_db_at_connection_for_test();
        let id = sealed_for(&mut conn, "orphan", "2020-01-01", "2019-06-01");
        conn.execute("DELETE FROM letter_keys WHERE letter_id = ?1", params![id])
            .unwrap();
        assert_eq!(
            open_impl(&conn, &scratch("open"), id).unwrap_err(),
            LetterError::NO_KEY
        );
    }

    #[test]
    fn an_envelope_from_a_newer_wattle_is_refused_rather_than_guessed_at() {
        let mut conn = crate::db::init_db_at_connection_for_test();
        let id = sealed_for(&mut conn, "from the future", "2020-01-01", "2019-06-01");
        conn.execute(
            "UPDATE letters SET envelope = ?1 WHERE id = ?2",
            params![crypto::ENVELOPE_VERSION + 1, id],
        )
        .unwrap();
        assert_eq!(
            open_impl(&conn, &scratch("open"), id).unwrap_err(),
            LetterError::FUTURE_ENVELOPE
        );
    }

    #[test]
    fn availability_is_derived_and_costs_the_row_nothing() {
        let mut conn = crate::db::init_db_at_connection_for_test();
        let id = sealed_for(&mut conn, "a letter", "2020-01-01", "2019-06-01");

        let before: Vec<u8> = conn
            .query_row(
                "SELECT ciphertext FROM letters WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        let stamps: (Option<String>, String, Option<String>) = conn
            .query_row(
                "SELECT opened_at, unlock_on, sealed_at FROM letters WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();

        let row = fetch(&conn, id).unwrap();
        assert!(!row.is_available("2019-12-31"));
        assert!(row.is_available("2020-01-01"), "the day itself counts");
        assert!(row.is_available("2026-08-21"));

        let after: Vec<u8> = conn
            .query_row(
                "SELECT ciphertext FROM letters WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        let stamps_after: (Option<String>, String, Option<String>) = conn
            .query_row(
                "SELECT opened_at, unlock_on, sealed_at FROM letters WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(before, after);
        assert_eq!(stamps, stamps_after);
    }

    #[test]
    fn the_home_screen_is_told_about_arrivals_and_the_nearest_wait_only() {
        let mut conn = crate::db::init_db_at_connection_for_test();
        let arrived = sealed_for(&mut conn, "already here", "2020-01-01", "2019-06-01");
        let near = sealed_for(&mut conn, "soon", "2126-01-01", "2125-12-01");
        let _far = sealed_for(&mut conn, "later", "2130-01-01", "2125-12-01");
        drafted(&conn, "still writing");

        let status = status_impl(&conn).unwrap();
        assert_eq!(status.arrived.len(), 1);
        assert_eq!(status.arrived[0].id, arrived);
        assert_eq!(
            status.waiting.as_ref().map(|letter| letter.id),
            Some(near),
            "the nearest one, and nothing about how many there are"
        );

        open_impl(&conn, &scratch("open"), arrived).unwrap();
        let status = status_impl(&conn).unwrap();
        assert!(status.arrived.is_empty());
        assert_eq!(status.waiting.map(|letter| letter.id), Some(near));
    }

    #[test]
    fn the_archive_lists_drafts_first_then_the_nearest_date() {
        let mut conn = crate::db::init_db_at_connection_for_test();
        let later = sealed_for(&mut conn, "later", "2130-01-01", "2125-12-01");
        let sooner = sealed_for(&mut conn, "sooner", "2126-01-01", "2125-12-01");
        let draft = drafted(&conn, "unfinished");

        let listed: Vec<i64> = list_impl(&conn).unwrap().iter().map(|l| l.id).collect();
        assert_eq!(listed, vec![draft, sooner, later]);
    }

    #[test]
    fn only_an_opened_letter_reaches_the_search_index() {
        let mut conn = crate::db::init_db_at_connection_for_test();
        let waiting = sealed_for(&mut conn, "gooseberry", "2126-01-01", "2125-12-01");
        let arrived = sealed_for(&mut conn, "redcurrant", "2020-01-01", "2019-06-01");
        drafted(&conn, "blackcurrant");

        let matches = |term: &str| -> i64 {
            conn.query_row(
                "SELECT count(*) FROM letters_fts WHERE letters_fts MATCH ?1",
                params![term],
                |row| row.get(0),
            )
            .unwrap()
        };

        assert_eq!(matches("gooseberry"), 0);
        assert_eq!(matches("blackcurrant"), 0, "a draft is never searchable");
        assert_eq!(matches("redcurrant"), 0, "not until it is actually opened");

        open_impl(&conn, &scratch("open"), arrived).unwrap();
        assert_eq!(matches("redcurrant"), 1);
        open_impl(&conn, &scratch("open"), arrived).unwrap();
        assert_eq!(matches("redcurrant"), 1);
        assert_eq!(matches("gooseberry"), 0);
        let _ = waiting;
    }

    #[test]
    fn a_letter_reaches_the_interface_under_the_names_it_formats_dates_by() {
        let conn = crate::db::init_db_at_connection_for_test();
        let id = drafted(&conn, "a letter");
        let letter = open_impl(&conn, &scratch("open"), id).unwrap();

        let wire = serde_json::to_value(&letter).unwrap();
        for field in [
            "writtenOn",
            "unlockOn",
            "openedAt",
            "sealedAt",
            "wordCount",
            "promptId",
            "status",
            "content",
            "id",
        ] {
            assert!(wire.get(field).is_some(), "the interface reads `{field}`");
        }
        assert_eq!(wire["unlockOn"], "");
        assert_eq!(wire["openedAt"], "");
        assert_eq!(wire["writtenOn"], serde_json::json!(today(&conn).unwrap()));

        let summary = list_impl(&conn).unwrap().pop().unwrap();
        let wire = serde_json::to_value(&summary).unwrap();
        for field in ["writtenOn", "unlockOn", "openedAt", "sealedAt", "available"] {
            assert!(wire.get(field).is_some(), "the interface reads `{field}`");
        }
    }

    #[test]
    fn the_associated_data_is_the_published_construction() {
        assert_eq!(
            associated_data(7, "2031-03-14", "2026-08-21T10:00:00.000Z"),
            b"wattle-letter-v1\x1f7\x1f2031-03-14\x1f2026-08-21T10:00:00.000Z".to_vec()
        );
    }

    fn doc_with_image(text: &str, attachment_id: i64) -> String {
        serde_json::json!({
            "type": "doc",
            "content": [
                { "type": "paragraph",
                  "content": [{ "type": "text", "text": text }] },
                { "type": "imageAttachment",
                  "attrs": { "attachmentId": attachment_id, "path": "", "mimeType": "image/png" } }
            ]
        })
        .to_string()
    }

    fn a_file(dir: &Path, name: &str, bytes: &[u8]) -> String {
        let path = dir.join(name);
        std::fs::write(&path, bytes).unwrap();
        path.to_string_lossy().to_string()
    }

    #[test]
    fn a_letters_files_are_sealed_with_it_and_come_back_with_it() {
        let dir = scratch("attachment_lifecycle");
        let source = scratch("attachment_source");
        let mut conn = crate::db::init_db(&dir).unwrap();

        const PIXELS: &[u8] = b"\x89PNG\r\n\x1a\n-pomegranate-pixels-47";
        let letter = create_impl(&conn, "").unwrap();
        let attachment = add_attachment_impl(
            &mut conn,
            &dir,
            letter.id,
            &a_file(&source, "picture.png", PIXELS),
        )
        .unwrap();

        assert!(attachment.path.starts_with("attachments/letters/"));
        let readable = dir.join(&attachment.path);
        assert_eq!(std::fs::read(&readable).unwrap(), PIXELS);
        assert_eq!(list_attachments_impl(&conn, letter.id).unwrap().len(), 1);

        save_draft_impl(
            &conn,
            letter.id,
            &doc_with_image("look at this", attachment.id),
            "",
            "",
        )
        .unwrap();
        seal_impl(&mut conn, &dir, letter.id, "2020-01-01", "2019-06-01").unwrap();

        assert!(
            !readable.exists(),
            "the readable file must not survive sealing"
        );
        let sealed_file = dir
            .join(sealed_attachment_dir(letter.id))
            .join(attachment.id.to_string());
        assert!(sealed_file.exists());
        let sealed_bytes = std::fs::read(&sealed_file).unwrap();
        assert!(
            !sealed_bytes
                .windows(PIXELS.len())
                .any(|window| window == PIXELS),
            "the sealed file must not hold the picture in the clear"
        );

        assert_eq!(
            list_attachments_impl(&conn, letter.id).unwrap_err(),
            LetterError::NOT_YET
        );
        assert_eq!(
            save_attachment_impl(&conn, &dir, attachment.id, &source.join("stolen.png"))
                .unwrap_err(),
            LetterError::NOT_YET
        );
        assert!(!source.join("stolen.png").exists());
        assert_eq!(
            delete_attachment_impl(&conn, &dir, attachment.id).unwrap_err(),
            LetterError::SEALED
        );

        let opened = open_impl(&conn, &dir, letter.id).unwrap();
        assert!(opened.content.contains("look at this"));
        let listed = list_attachments_impl(&conn, letter.id).unwrap();
        assert_eq!(listed.len(), 1);
        assert!(listed[0].path.starts_with("attachments/letters/"));
        assert_eq!(std::fs::read(dir.join(&listed[0].path)).unwrap(), PIXELS);
        assert!(!sealed_file.exists(), "the sealed copy is not kept as well");

        save_attachment_impl(&conn, &dir, attachment.id, &source.join("saved.png")).unwrap();
        assert_eq!(std::fs::read(source.join("saved.png")).unwrap(), PIXELS);

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&source).ok();
    }

    #[test]
    fn a_letter_of_only_a_picture_can_be_sealed() {
        let dir = scratch("attachment_only");
        let source = scratch("attachment_only_source");
        let mut conn = crate::db::init_db(&dir).unwrap();

        let letter = create_impl(&conn, "").unwrap();
        assert_eq!(
            seal_impl(&mut conn, &dir, letter.id, "2126-01-01", "2125-12-01").unwrap_err(),
            LetterError::EMPTY
        );

        let attachment = add_attachment_impl(
            &mut conn,
            &dir,
            letter.id,
            &a_file(&source, "a.png", b"pixels"),
        )
        .unwrap();
        let wordless = serde_json::json!({
            "type": "doc",
            "content": [{ "type": "imageAttachment",
                          "attrs": { "attachmentId": attachment.id } }]
        })
        .to_string();
        save_draft_impl(&conn, letter.id, &wordless, "", "").unwrap();

        seal_impl(&mut conn, &dir, letter.id, "2126-01-01", "2125-12-01").unwrap();
        assert_eq!(fetch(&conn, letter.id).unwrap().status, "sealed");

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&source).ok();
    }

    #[test]
    fn moving_the_unlock_date_destroys_the_files_too() {
        let dir = scratch("attachment_tamper");
        let source = scratch("attachment_tamper_source");
        let mut conn = crate::db::init_db(&dir).unwrap();

        let letter = create_impl(&conn, "").unwrap();
        let attachment = add_attachment_impl(
            &mut conn,
            &dir,
            letter.id,
            &a_file(&source, "a.png", b"pixels"),
        )
        .unwrap();
        save_draft_impl(
            &conn,
            letter.id,
            &doc_with_image("x", attachment.id),
            "",
            "",
        )
        .unwrap();
        seal_impl(&mut conn, &dir, letter.id, "2126-01-01", "2125-12-01").unwrap();

        conn.execute(
            "UPDATE letters SET unlock_on = '2020-01-01' WHERE id = ?1",
            params![letter.id],
        )
        .unwrap();

        assert_eq!(
            open_impl(&conn, &dir, letter.id).unwrap_err(),
            LetterError::CORRUPT
        );
        assert_eq!(
            list_attachments_impl(&conn, letter.id).unwrap_err(),
            LetterError::NOT_YET
        );

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&source).ok();
    }

    #[test]
    fn deleting_a_draft_takes_its_files() {
        let dir = scratch("attachment_delete");
        let source = scratch("attachment_delete_source");
        let mut conn = crate::db::init_db(&dir).unwrap();

        let letter = create_impl(&conn, "").unwrap();
        let attachment = add_attachment_impl(
            &mut conn,
            &dir,
            letter.id,
            &a_file(&source, "a.png", b"pixels"),
        )
        .unwrap();
        let file = dir.join(&attachment.path);
        assert!(file.exists());

        delete_impl(&conn, &dir, letter.id).unwrap();

        assert!(!file.exists());
        let rows: i64 = conn
            .query_row("SELECT count(*) FROM letter_attachments", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(rows, 0, "the rows cascade with the letter");

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&source).ok();
    }

    #[test]
    fn reconciling_a_draft_drops_what_the_document_no_longer_references() {
        let dir = scratch("attachment_reconcile");
        let source = scratch("attachment_reconcile_source");
        let mut conn = crate::db::init_db(&dir).unwrap();

        let letter = create_impl(&conn, "").unwrap();
        let kept = add_attachment_impl(&mut conn, &dir, letter.id, &a_file(&source, "a.png", b"a"))
            .unwrap();
        let dropped =
            add_attachment_impl(&mut conn, &dir, letter.id, &a_file(&source, "b.png", b"b"))
                .unwrap();
        save_draft_impl(&conn, letter.id, &doc_with_image("x", kept.id), "", "").unwrap();

        reconcile_attachments_impl(&conn, &dir, letter.id).unwrap();

        let listed = list_attachments_impl(&conn, letter.id).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, kept.id);
        assert!(!dir.join(&dropped.path).exists());

        seal_impl(&mut conn, &dir, letter.id, "2126-01-01", "2125-12-01").unwrap();
        assert_eq!(
            reconcile_attachments_impl(&conn, &dir, letter.id).unwrap_err(),
            LetterError::SEALED
        );

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&source).ok();
    }

    #[test]
    fn the_readme_publishes_the_envelope_this_code_actually_writes() {
        let readme = std::fs::read_to_string("../README.md").unwrap();
        let cipher = ["XCha", "Cha20-Poly1305"].concat();
        assert!(readme.contains(&cipher), "the README must name the cipher");
        for fact in [
            AAD_PREFIX,
            "wattle-letter-attachment-v1",
            crypto::ALGORITHM,
            "0x1F",
            "letters.unlock_on",
            "letters.sealed_at",
            "letter_attachments.id",
        ] {
            assert!(
                readme.contains(fact),
                "the README must publish {fact:?} for the envelope to be openable without Wattle"
            );
        }
    }

    #[test]
    fn the_gate_never_takes_the_day_from_its_caller() {
        let source = std::fs::read_to_string("src/commands/letters.rs").unwrap();
        assert!(
            source
                .contains("fn open_impl(conn: &Connection, id: i64) -> Result<LetterDto, String>"),
            "open_impl's signature must stay free of a caller-supplied date"
        );
        let smuggled = [
            "pub fn open_letter(state: State<AppState>, id: i64, ",
            "today",
        ]
        .concat();
        assert!(
            !source.contains(&smuggled),
            "the command must not grow a date argument either"
        );
    }

    #[test]
    fn no_migration_rewrites_what_a_seal_is_bound_to() {
        let source = std::fs::read_to_string("src/db/mod.rs").unwrap();
        for column in ["unlock_on", "sealed_at"] {
            assert!(
                !source.contains(&format!("UPDATE letters SET {column}")),
                "no migration may rewrite letters.{column} on a sealed letter"
            );
        }
    }

    #[test]
    fn the_journals_surfaces_never_reach_into_letters() {
        for file in [
            "src/commands/calendar.rs",
            "src/commands/memories.rs",
            "src/commands/ai.rs",
        ] {
            let source = std::fs::read_to_string(file).unwrap();
            for table in ["letters", "letter_keys", "letters_fts"] {
                assert!(
                    !source.contains(&format!("FROM {table}"))
                        && !source.contains(&format!("INTO {table}"))
                        && !source.contains(&format!("UPDATE {table}")),
                    "{file} must not reach into {table}"
                );
            }
        }
    }

    fn hostile_letter_paths(name: &str) -> (std::path::PathBuf, Vec<String>) {
        let victim_dir = std::env::temp_dir().join(format!("wattle_letters_{name}_victim"));
        std::fs::remove_dir_all(&victim_dir).ok();
        std::fs::create_dir_all(&victim_dir).unwrap();
        let victim = victim_dir.join("victim.txt");
        std::fs::write(&victim, b"not wattle's").unwrap();
        let folder = victim_dir
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        let stored = vec![
            victim.to_string_lossy().to_string(),
            format!("attachments/letters/1/../../../../{folder}/victim.txt"),
        ];
        (victim, stored)
    }

    fn seed_letter_path(conn: &Connection, letter_id: i64, stored: &str) -> i64 {
        conn.execute(
            "INSERT INTO letter_attachments (letter_id, filename, mime_type, size, path) \
             VALUES (?1, 'victim.txt', 'text/plain', 12, ?2)",
            params![letter_id, stored],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn a_draft_whose_rows_point_outside_never_touches_those_files() {
        let dir = scratch("hostile_draft");
        let conn = crate::db::init_db(&dir).unwrap();
        let (victim, stored) = hostile_letter_paths("hostile_draft");
        let letter = drafted(&conn, "nothing attached");

        for path in &stored {
            seed_letter_path(&conn, letter, path);
        }
        reconcile_attachments_impl(&conn, &dir, letter).unwrap();
        assert_eq!(std::fs::read(&victim).unwrap(), b"not wattle's");
        assert!(list_attachments_impl(&conn, letter).unwrap().is_empty());

        for path in &stored {
            let id = seed_letter_path(&conn, letter, path);
            let destination = dir.join("copied.txt");
            assert_eq!(
                save_attachment_impl(&conn, &dir, id, &destination).unwrap_err(),
                crate::paths::PATH_OUTSIDE_JOURNAL
            );
            assert!(!destination.exists());
            delete_attachment_impl(&conn, &dir, id).unwrap();
            assert_eq!(std::fs::read(&victim).unwrap(), b"not wattle's", "{path}");
        }
        assert!(list_attachments_impl(&conn, letter).unwrap().is_empty());

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(victim.parent().unwrap()).ok();
    }

    #[test]
    fn sealing_a_draft_whose_rows_point_outside_is_refused() {
        let dir = scratch("hostile_seal");
        let mut conn = crate::db::init_db(&dir).unwrap();
        let (victim, stored) = hostile_letter_paths("hostile_seal");

        for path in &stored {
            let letter = drafted(&conn, "a letter with a stowaway");
            seed_letter_path(&conn, letter, path);
            assert!(seal_impl(&mut conn, &dir, letter, "2031-03-14", "2026-08-21").is_err());
            assert_eq!(fetch(&conn, letter).unwrap().status, "draft");
            assert_eq!(std::fs::read(&victim).unwrap(), b"not wattle's", "{path}");
        }

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(victim.parent().unwrap()).ok();
    }

    #[test]
    fn an_opened_file_never_lands_in_an_alternate_stream() {
        let dir = scratch("hostile_stream");
        let source = scratch("hostile_stream_source");
        let mut conn = crate::db::init_db(&dir).unwrap();
        let letter = create_impl(&conn, "").unwrap();
        let picture = std::fs::write(source.join("picture.png"), b"pixels")
            .map(|()| source.join("picture.png").to_string_lossy().to_string())
            .unwrap();
        let attachment = add_attachment_impl(&mut conn, &dir, letter.id, &picture).unwrap();
        save_draft_impl(&conn, letter.id, &doc("with a picture"), "", "").unwrap();
        conn.execute(
            "UPDATE letter_attachments SET filename = 'picture.png:hidden' WHERE id = ?1",
            params![attachment.id],
        )
        .unwrap();

        seal_for_test(&mut conn, &dir, letter.id, "2020-01-01", "2019-06-01");
        open_impl(&conn, &dir, letter.id).unwrap();

        let plain = dir.join(format!(
            "{}/{}.png",
            draft_attachment_dir(letter.id),
            attachment.id
        ));
        assert!(
            !plain.exists(),
            "nothing may be written beside an alternate stream"
        );

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&source).ok();
    }

    #[cfg(windows)]
    #[test]
    fn an_unreadable_folder_never_costs_a_letter_row() {
        let dir = scratch("transient_rows");
        let source = scratch("transient_rows_source");
        let mut conn = crate::db::init_db(&dir).unwrap();
        let letter = create_impl(&conn, "").unwrap();
        let first = add_attachment_impl(
            &mut conn,
            &dir,
            letter.id,
            &a_file(&source, "one.png", b"one"),
        )
        .unwrap();
        let second = add_attachment_impl(
            &mut conn,
            &dir,
            letter.id,
            &a_file(&source, "two.png", b"two"),
        )
        .unwrap();
        save_draft_impl(&conn, letter.id, &doc("nothing attached any more"), "", "").unwrap();

        {
            let _denied =
                crate::paths::test_support::Denied::on(&dir.join(draft_attachment_dir(letter.id)));
            reconcile_attachments_impl(&conn, &dir, letter.id).unwrap();
            assert!(delete_attachment_impl(&conn, &dir, first.id).is_err());
            assert_eq!(
                list_attachments_impl(&conn, letter.id).unwrap().len(),
                2,
                "no row may be lost to an I/O error"
            );
        }

        assert!(dir.join(&second.path).is_file());
        delete_attachment_impl(&conn, &dir, first.id).unwrap();
        assert!(!dir.join(&first.path).exists());
        reconcile_attachments_impl(&conn, &dir, letter.id).unwrap();
        assert!(list_attachments_impl(&conn, letter.id).unwrap().is_empty());
        assert!(!dir.join(&second.path).exists());

        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&source).ok();
    }

    #[test]
    fn a_sealed_file_is_never_written_through_a_link() {
        let dir = scratch("sealed_link");
        let source = scratch("sealed_link_source");
        let outside = scratch("sealed_link_outside");
        let mut conn = crate::db::init_db(&dir).unwrap();
        let letter = create_impl(&conn, "").unwrap();
        add_attachment_impl(
            &mut conn,
            &dir,
            letter.id,
            &a_file(&source, "picture.png", b"pixels"),
        )
        .unwrap();
        save_draft_impl(&conn, letter.id, &doc("with a picture"), "", "").unwrap();
        std::fs::create_dir_all(dir.join("sealed-letters")).unwrap();
        let linked = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(dir.join("sealed-letters").join(letter.id.to_string()))
            .arg(&outside)
            .output()
            .is_ok_and(|output| output.status.success());
        assert!(linked || !cfg!(windows), "a junction could not be created");
        if !linked {
            return;
        }

        assert!(seal_impl(&mut conn, &dir, letter.id, "2031-03-14", "2026-08-21").is_err());
        assert_eq!(fetch(&conn, letter.id).unwrap().status, "draft");
        assert_eq!(std::fs::read_dir(&outside).unwrap().count(), 0);

        std::fs::remove_dir(dir.join("sealed-letters").join(letter.id.to_string())).ok();
        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&source).ok();
        std::fs::remove_dir_all(&outside).ok();
    }
}
