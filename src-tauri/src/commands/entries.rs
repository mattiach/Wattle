use rusqlite::{params, Connection};
use tauri::State;

use crate::models::{EntryDto, EntrySummaryDto};
use crate::state::AppState;

/// True for a real `YYYY-MM-DD` calendar date.
pub fn is_calendar_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    if !bytes
        .iter()
        .enumerate()
        .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
    {
        return false;
    }

    let Ok(year) = value[0..4].parse::<i32>() else {
        return false;
    };
    let Ok(month) = value[5..7].parse::<u32>() else {
        return false;
    };
    let Ok(day) = value[8..10].parse::<u32>() else {
        return false;
    };

    if !(1..=12).contains(&month) || day < 1 {
        return false;
    }

    let is_leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let last_day = match month {
        2 if is_leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    day <= last_day
}

fn check_entry_date(entry_date: &str) -> Result<(), String> {
    if is_calendar_date(entry_date) {
        Ok(())
    } else {
        Err(format!("invalid entry date: {entry_date:?}"))
    }
}

fn fetch_entry(conn: &Connection, id: i64) -> Result<EntryDto, String> {
    conn.query_row(
        "SELECT id, title, content, preview, word_count, kind, entry_date, created_at, updated_at FROM entries WHERE id = ?1",
        params![id],
        |row| {
            Ok(EntryDto {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                preview: row.get(3)?,
                word_count: row.get(4)?,
                kind: row.get(5)?,
                entry_date: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

/// The two surfaces writing arrives on.
pub const ENTRY_KINDS: [&str; 2] = ["entry", "spark"];

fn check_kind(kind: &str) -> Result<(), String> {
    if ENTRY_KINDS.contains(&kind) {
        Ok(())
    } else {
        Err(format!("unknown entry kind: {kind:?}"))
    }
}

/// A new entry starts as an empty document, and the column defaults already
/// describe exactly that - no text, no words, no excerpt.
fn create_entry_impl(
    conn: &Connection,
    entry_date: String,
    kind: &str,
) -> Result<EntryDto, String> {
    check_entry_date(&entry_date)?;
    check_kind(kind)?;
    conn.execute(
        "INSERT INTO entries (entry_date, kind) VALUES (?1, ?2)",
        params![entry_date, kind],
    )
    .map_err(|e| e.to_string())?;
    fetch_entry(conn, conn.last_insert_rowid())
}

fn update_entry_impl(
    conn: &Connection,
    id: i64,
    title: String,
    content: String,
    entry_date: String,
) -> Result<EntryDto, String> {
    check_entry_date(&entry_date)?;
    let derived = crate::content::derive(&content);
    conn.execute(
        "UPDATE entries SET title = ?1, content = ?2, content_text = ?3, preview = ?4, word_count = ?5, entry_date = ?6, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?7",
        params![
            title,
            content,
            derived.text,
            derived.preview,
            derived.word_count,
            entry_date,
            id
        ],
    )
    .map_err(|e| e.to_string())?;
    fetch_entry(conn, id)
}

/// Wraps a highlighted run in the snippet.
const HIGHLIGHT_OPEN: &str = "\u{2}";
const HIGHLIGHT_CLOSE: &str = "\u{3}";
/// Tokens of context around a match.
const SNIPPET_TOKENS: i64 = 12;

/// Browsing: no query, so the journal reads in date order.
const BROWSE_SQL: &str =
    "SELECT id, title, preview, word_count, kind, entry_date, created_at, updated_at \
     FROM entries \
     WHERE (?1 = '' OR entry_date >= ?1) AND (?2 = '' OR entry_date <= ?2) \
       AND (?3 = '' OR kind = ?3) \
     ORDER BY entry_date DESC, id DESC \
     LIMIT ?4 OFFSET ?5";

/// The kind a letter wears in a search result.
pub const LETTER_KIND: &str = "letter";

/// Searching: FTS5 over the derived text, best match first, with a snippet
/// showing why each entry matched.
const SEARCH_SQL: &str = "SELECT id, title, preview, word_count, kind, entry_date, created_at, updated_at, snippet FROM ( \
       SELECT e.id AS id, e.title AS title, e.preview AS preview, e.word_count AS word_count, \
              e.kind AS kind, e.entry_date AS entry_date, e.created_at AS created_at, \
              e.updated_at AS updated_at, snippet(entries_fts, 1, ?2, ?3, '…', ?4) AS snippet, \
              bm25(entries_fts) AS rank \
       FROM entries_fts \
       JOIN entries e ON e.id = entries_fts.rowid \
       WHERE entries_fts MATCH ?1 \
         AND (?5 = '' OR e.entry_date >= ?5) AND (?6 = '' OR e.entry_date <= ?6) \
         AND (?7 = '' OR e.kind = ?7) \
     UNION ALL \
       SELECT l.id, '', '', l.word_count, 'letter', l.written_on, l.created_at, l.updated_at, \
              snippet(letters_fts, 0, ?2, ?3, '…', ?4), bm25(letters_fts) \
       FROM letters_fts \
       JOIN letters l ON l.id = letters_fts.rowid \
       WHERE letters_fts MATCH ?1 AND l.opened_at IS NOT NULL \
         AND (?5 = '' OR l.written_on >= ?5) AND (?6 = '' OR l.written_on <= ?6) \
         AND (?7 = '' OR ?7 = 'letter') \
     ) \
     ORDER BY rank, entry_date DESC, id DESC \
     LIMIT ?8 OFFSET ?9";

const COUNT_SQL: &str = "SELECT (SELECT COUNT(*) FROM entries_fts \
       JOIN entries e ON e.id = entries_fts.rowid \
       WHERE entries_fts MATCH ?1 \
         AND (?2 = '' OR e.entry_date >= ?2) AND (?3 = '' OR e.entry_date <= ?3) \
         AND (?4 = '' OR e.kind = ?4)) \
     + (SELECT COUNT(*) FROM letters_fts \
       JOIN letters l ON l.id = letters_fts.rowid \
       WHERE letters_fts MATCH ?1 AND l.opened_at IS NOT NULL \
         AND (?2 = '' OR l.written_on >= ?2) AND (?3 = '' OR l.written_on <= ?3) \
         AND (?4 = '' OR ?4 = 'letter'))";

/// Turns what the user typed into an FTS5 expression that means exactly that.
fn to_fts_query(input: &str) -> Option<String> {
    let mut tokens: Vec<String> = input
        .split_whitespace()
        .filter(|token| token.chars().any(char::is_alphanumeric))
        .map(|token| format!("\"{}\"", token.replace('"', "\"\"")))
        .collect();

    let last = tokens.last_mut()?;
    last.push('*');
    Some(tokens.join(" "))
}

fn read_summary(row: &rusqlite::Row, snippet: Option<String>) -> rusqlite::Result<EntrySummaryDto> {
    Ok(EntrySummaryDto {
        id: row.get(0)?,
        title: row.get(1)?,
        preview: row.get(2)?,
        word_count: row.get(3)?,
        kind: row.get(4)?,
        entry_date: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        snippet,
    })
}

/// `kind` narrows to one surface; empty means every kind, which is what search
/// and resurfacing use so nothing a person wrote can become unreachable.
fn list_entries_impl(
    conn: &Connection,
    query: &str,
    from: &str,
    to: &str,
    kind: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<EntrySummaryDto>, String> {
    let Some(expression) = to_fts_query(query) else {
        let mut stmt = conn.prepare(BROWSE_SQL).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![from, to, kind, limit, offset], |row| {
                read_summary(row, None)
            })
            .map_err(|e| e.to_string())?;
        return rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string());
    };

    let mut stmt = conn.prepare(SEARCH_SQL).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(
            params![
                expression,
                HIGHLIGHT_OPEN,
                HIGHLIGHT_CLOSE,
                SNIPPET_TOKENS,
                from,
                to,
                kind,
                limit,
                offset
            ],
            |row| {
                let snippet: Option<String> = row.get(8)?;
                read_summary(row, snippet)
            },
        )
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

/// How many entries the search matches in total, so the results can say so
/// without the list having to be scrolled to its end.
fn count_entries_impl(
    conn: &Connection,
    query: &str,
    from: &str,
    to: &str,
    kind: &str,
) -> Result<i64, String> {
    let Some(expression) = to_fts_query(query) else {
        return conn
            .query_row(
                "SELECT COUNT(*) FROM entries \
                 WHERE (?1 = '' OR entry_date >= ?1) AND (?2 = '' OR entry_date <= ?2) \
                   AND (?3 = '' OR kind = ?3)",
                params![from, to, kind],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string());
    };

    conn.query_row(COUNT_SQL, params![expression, from, to, kind], |row| {
        row.get(0)
    })
    .map_err(|e| e.to_string())
}

/// Deleting a page moves it to the trash, where it waits thirty days.
fn delete_entry_impl(
    conn: &mut Connection,
    wattle_dir: &std::path::Path,
    id: i64,
) -> Result<(), String> {
    let is_blank: bool = conn
        .query_row(
            "SELECT title = '' AND content_text = ''                AND NOT EXISTS (SELECT 1 FROM attachments WHERE entry_id = ?1)              FROM entries WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .unwrap_or(true);

    if !is_blank {
        return crate::commands::trash::trash_entry(conn, id);
    }

    conn.execute("DELETE FROM entries WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    let entry_dir = wattle_dir.join("attachments").join(id.to_string());
    if entry_dir.exists() {
        std::fs::remove_dir_all(entry_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn create_entry(
    state: State<AppState>,
    entry_date: String,
    kind: Option<String>,
) -> Result<EntryDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    create_entry_impl(&conn, entry_date, kind.as_deref().unwrap_or("entry"))
}

#[tauri::command]
pub fn update_entry(
    state: State<AppState>,
    id: i64,
    title: String,
    content: String,
    entry_date: String,
) -> Result<EntryDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    update_entry_impl(&conn, id, title, content, entry_date)
}

#[tauri::command]
pub fn get_entry(state: State<AppState>, id: i64) -> Result<EntryDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    fetch_entry(&conn, id)
}

#[tauri::command]
pub fn list_entries(
    state: State<AppState>,
    query: String,
    from: Option<String>,
    to: Option<String>,
    kind: Option<String>,
    limit: i64,
    offset: i64,
) -> Result<Vec<EntrySummaryDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    list_entries_impl(
        &conn,
        &query,
        from.as_deref().unwrap_or_default(),
        to.as_deref().unwrap_or_default(),
        kind.as_deref().unwrap_or_default(),
        limit,
        offset,
    )
}

#[tauri::command]
pub fn count_entries(
    state: State<AppState>,
    query: String,
    from: Option<String>,
    to: Option<String>,
    kind: Option<String>,
) -> Result<i64, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    count_entries_impl(
        &conn,
        &query,
        from.as_deref().unwrap_or_default(),
        to.as_deref().unwrap_or_default(),
        kind.as_deref().unwrap_or_default(),
    )
}

#[tauri::command]
pub fn delete_entry(state: State<AppState>, id: i64) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    delete_entry_impl(&mut conn, &state.wattle_dir()?, id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_reaches_an_opened_letter_and_never_a_sealed_one() {
        let conn = crate::db::init_db_at_connection_for_test();

        create_entry_impl(&conn, "2026-08-15".to_string(), "entry").unwrap();
        update_entry_impl(
            &conn,
            1,
            "An entry".to_string(),
            r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"quince"}]}]}"#
                .to_string(),
            "2026-08-15".to_string(),
        )
        .unwrap();

        conn.execute(
            "INSERT INTO letters (id, status, written_on, unlock_on, sealed_at, word_count) \
             VALUES (1, 'sealed', '2026-08-10', '2031-03-14', '2026-08-10T09:00:00.000Z', 3)",
            [],
        )
        .unwrap();

        let found = |query: &str| -> Vec<(i64, String)> {
            list_entries_impl(&conn, query, "", "", "", 20, 0)
                .unwrap()
                .into_iter()
                .map(|row| (row.id, row.kind))
                .collect()
        };

        assert_eq!(found("quince"), vec![(1, "entry".to_string())]);
        assert_eq!(found("mulberry"), Vec::new());

        conn.execute(
            "UPDATE letters SET opened_at = '2031-03-14T08:00:00.000Z' WHERE id = 1",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO letters_fts (rowid, content_text) VALUES (1, 'mulberry and quince')",
            [],
        )
        .unwrap();

        let matches = found("mulberry");
        assert_eq!(matches, vec![(1, LETTER_KIND.to_string())]);
        assert_eq!(
            count_entries_impl(&conn, "quince", "", "", "").unwrap(),
            2,
            "an opened letter counts towards the total the results announce"
        );

        assert_eq!(found("mulberry").len(), 1);
        assert!(list_entries_impl(&conn, "mulberry", "", "", "spark", 20, 0)
            .unwrap()
            .is_empty());
        assert!(list_entries_impl(&conn, "quince", "", "", "entry", 20, 0)
            .unwrap()
            .iter()
            .all(|row| row.kind == "entry"));

        assert!(list_entries_impl(&conn, "", "", "", "", 20, 0)
            .unwrap()
            .iter()
            .all(|row| row.kind != LETTER_KIND));
    }

    #[test]
    fn create_get_update_list_delete_roundtrip() {
        let mut conn = crate::db::init_db_at_connection_for_test();

        let created = create_entry_impl(&conn, "2026-08-15".to_string(), "entry").unwrap();
        assert_eq!(created.entry_date, "2026-08-15");
        assert_eq!(created.title, "");
        assert_eq!(created.content, r#"{"type":"doc","content":[]}"#);

        let fetched = fetch_entry(&conn, created.id).unwrap();
        assert_eq!(fetched.id, created.id);

        let updated = update_entry_impl(
            &conn,
            created.id,
            "My title".to_string(),
            r#"{"type":"doc","content":[{"type":"paragraph"}]}"#.to_string(),
            "2026-08-16".to_string(),
        )
        .unwrap();
        assert_eq!(updated.title, "My title");
        assert_eq!(updated.entry_date, "2026-08-16");
        assert!(updated.updated_at.ends_with('Z'));

        let list = list_entries_impl(&conn, "", "", "", "", 20, 0).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, created.id);
        assert_eq!(list[0].title, "My title");
        assert_eq!(list[0].preview, "");
        assert_eq!(list[0].word_count, 0);

        let tmp_wattle_dir = std::env::temp_dir().join("wattle_test_delete_entry");
        delete_entry_impl(&mut conn, &tmp_wattle_dir, created.id).unwrap();
        let list_after_delete = list_entries_impl(&conn, "", "", "", "", 20, 0).unwrap();
        assert!(list_after_delete.is_empty());
        assert!(fetch_entry(&conn, created.id).is_err());
    }

    fn write_entry(conn: &Connection, title: &str, date: &str, text_nodes: &[&str]) -> i64 {
        let nodes = text_nodes
            .iter()
            .map(|text| format!(r#"{{"type":"text","text":{}}}"#, json_string(text)))
            .collect::<Vec<_>>()
            .join(",");
        let entry = create_entry_impl(conn, date.to_string(), "entry").unwrap();
        update_entry_impl(
            conn,
            entry.id,
            title.to_string(),
            format!(r#"{{"type":"doc","content":[{{"type":"paragraph","content":[{nodes}]}}]}}"#),
            date.to_string(),
        )
        .unwrap();
        entry.id
    }

    fn json_string(value: &str) -> String {
        serde_json::to_string(value).unwrap()
    }

    fn titles(entries: &[EntrySummaryDto]) -> Vec<&str> {
        entries.iter().map(|e| e.title.as_str()).collect()
    }

    #[test]
    fn list_entries_paginates_and_filters() {
        let conn = crate::db::init_db_at_connection_for_test();

        for index in 0..5 {
            write_entry(
                &conn,
                &format!("Entry {index}"),
                &format!("2026-08-{:02}", index + 1),
                &[&format!("body {index}")],
            );
        }

        let first_page = list_entries_impl(&conn, "", "", "", "", 2, 0).unwrap();
        assert_eq!(first_page.len(), 2);
        assert_eq!(first_page[0].title, "Entry 4");
        assert!(first_page[0].snippet.is_none(), "browsing has no snippet");

        let second_page = list_entries_impl(&conn, "", "", "", "", 2, 2).unwrap();
        assert_eq!(second_page.len(), 2);
        assert_eq!(second_page[0].title, "Entry 2");

        let last_page = list_entries_impl(&conn, "", "", "", "", 2, 4).unwrap();
        assert_eq!(last_page.len(), 1);

        assert_eq!(first_page[0].preview, "body 4");
        assert_eq!(first_page[0].word_count, 2);

        let by_title = list_entries_impl(&conn, "Entry 3", "", "", "", 20, 0).unwrap();
        assert_eq!(by_title.len(), 1);
        assert_eq!(by_title[0].title, "Entry 3");

        let by_body = list_entries_impl(&conn, "BODY 1", "", "", "", 20, 0).unwrap();
        assert_eq!(by_body.len(), 1);
        assert_eq!(by_body[0].title, "Entry 1");

        assert!(
            list_entries_impl(&conn, "nothing matches", "", "", "", 20, 0)
                .unwrap()
                .is_empty()
        );
    }

    fn write_spark(conn: &Connection, text: &str, date: &str) -> i64 {
        let spark = create_entry_impl(conn, date.to_string(), "spark").unwrap();
        update_entry_impl(
            conn,
            spark.id,
            String::new(),
            format!(
                r#"{{"type":"doc","content":[{{"type":"paragraph","content":[{{"type":"text","text":{}}}]}}]}}"#,
                json_string(text)
            ),
            date.to_string(),
        )
        .unwrap();
        spark.id
    }

    #[test]
    fn a_spark_is_an_entry_written_somewhere_else() {
        let conn = crate::db::init_db_at_connection_for_test();
        write_entry(&conn, "An entry", "2026-08-16", &["the long way"]);
        write_spark(&conn, "a fleeting thought", "2026-08-16");

        let found = list_entries_impl(&conn, "fleeting", "", "", "", 20, 0).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].kind, "spark");
        assert_eq!(found[0].preview, "a fleeting thought");

        let days = crate::commands::calendar::entry_dates_in_range_for_test(
            &conn,
            "2026-08-01",
            "2026-08-31",
        )
        .unwrap();
        assert_eq!(days.len(), 1);
        assert_eq!(days[0].count, 2);
        assert_eq!(days[0].sparks, 1);

        let stored: String = conn
            .query_row(
                "SELECT kind FROM entries WHERE preview = 'a fleeting thought'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored, "spark");
    }

    #[test]
    fn the_kind_filter_separates_the_two_surfaces() {
        let conn = crate::db::init_db_at_connection_for_test();
        write_entry(&conn, "An entry", "2026-08-16", &["written at length"]);
        write_spark(&conn, "a fleeting thought", "2026-08-16");
        write_spark(&conn, "another thought", "2026-08-16");

        let entries_only = list_entries_impl(&conn, "", "", "", "entry", 20, 0).unwrap();
        assert_eq!(titles(&entries_only), vec!["An entry"]);

        let sparks_only = list_entries_impl(&conn, "", "", "", "spark", 20, 0).unwrap();
        assert_eq!(sparks_only.len(), 2);
        assert!(sparks_only.iter().all(|s| s.kind == "spark"));

        assert_eq!(
            list_entries_impl(&conn, "", "", "", "", 20, 0)
                .unwrap()
                .len(),
            3
        );
        assert_eq!(count_entries_impl(&conn, "", "", "", "").unwrap(), 3);
        assert_eq!(count_entries_impl(&conn, "", "", "", "spark").unwrap(), 2);
        assert_eq!(count_entries_impl(&conn, "thought", "", "", "").unwrap(), 2);
    }

    #[test]
    fn several_sparks_may_share_one_day() {
        let conn = crate::db::init_db_at_connection_for_test();
        for text in ["first", "second", "third"] {
            write_spark(&conn, text, "2026-08-16");
        }

        let sparks =
            list_entries_impl(&conn, "", "2026-08-16", "2026-08-16", "spark", 20, 0).unwrap();
        assert_eq!(sparks.len(), 3);
        assert_eq!(
            sparks
                .iter()
                .map(|s| s.preview.as_str())
                .collect::<Vec<_>>(),
            vec!["third", "second", "first"]
        );
    }

    #[test]
    fn an_unknown_kind_is_refused() {
        let conn = crate::db::init_db_at_connection_for_test();
        for bad in ["", "note", "Spark", "entry ", "task"] {
            assert!(
                create_entry_impl(&conn, "2026-08-16".to_string(), bad).is_err(),
                "kind {bad:?} should have been refused"
            );
        }
        assert!(create_entry_impl(&conn, "2026-08-16".to_string(), "spark").is_ok());
        assert!(create_entry_impl(&conn, "2026-08-16".to_string(), "entry").is_ok());
    }

    #[test]
    fn an_entry_can_never_be_written_without_a_real_date() {
        let conn = crate::db::init_db_at_connection_for_test();

        for bad in [
            "",
            "   ",
            "2026-8-16",
            "16/08/2026",
            "2026-13-01",
            "2026-00-10",
            "2026-02-30",
            "2027-02-29",
            "2026-01-32",
            "not a date",
            "2026-08-16T00:00:00Z",
        ] {
            assert!(
                create_entry_impl(&conn, bad.to_string(), "entry").is_err(),
                "creating with {bad:?} should have been refused"
            );
        }

        for good in ["2026-08-16", "2028-02-29", "2026-01-01", "2026-12-31"] {
            assert!(
                create_entry_impl(&conn, good.to_string(), "entry").is_ok(),
                "creating with {good:?} should have been allowed"
            );
        }
    }

    #[test]
    fn an_entrys_date_cannot_be_blanked_by_a_later_save() {
        let conn = crate::db::init_db_at_connection_for_test();
        let entry = create_entry_impl(&conn, "2026-08-16".to_string(), "entry").unwrap();

        let result = update_entry_impl(
            &conn,
            entry.id,
            "Title".to_string(),
            r#"{"type":"doc","content":[]}"#.to_string(),
            String::new(),
        );

        assert!(
            result.is_err(),
            "an empty date must not overwrite a real one"
        );
        assert_eq!(
            fetch_entry(&conn, entry.id).unwrap().entry_date,
            "2026-08-16"
        );
    }

    #[test]
    fn changing_an_entrys_date_moves_it_in_the_journal() {
        let conn = crate::db::init_db_at_connection_for_test();
        write_entry(&conn, "January", "2026-01-10", &["winter"]);
        let backdated = write_entry(&conn, "Today", "2026-08-16", &["written now"]);
        write_entry(&conn, "March", "2026-03-10", &["spring"]);

        assert_eq!(
            titles(&list_entries_impl(&conn, "", "", "", "", 20, 0).unwrap()),
            vec!["Today", "March", "January"]
        );

        update_entry_impl(
            &conn,
            backdated,
            "Today".to_string(),
            r#"{"type":"doc","content":[{"type":"paragraph","content":[
                {"type":"text","text":"written now"}]}]}"#
                .to_string(),
            "2026-02-14".to_string(),
        )
        .unwrap();

        assert_eq!(
            titles(&list_entries_impl(&conn, "", "", "", "", 20, 0).unwrap()),
            vec!["March", "Today", "January"]
        );
        assert_eq!(
            fetch_entry(&conn, backdated).unwrap().entry_date,
            "2026-02-14"
        );

        assert_eq!(
            titles(&list_entries_impl(&conn, "", "2026-02-01", "2026-02-28", "", 20, 0).unwrap()),
            vec!["Today"]
        );
    }

    #[test]
    fn several_entries_may_share_one_date() {
        let conn = crate::db::init_db_at_connection_for_test();
        let first = write_entry(&conn, "Morning", "2026-08-16", &["early"]);
        let second = write_entry(&conn, "Evening", "2026-08-16", &["late"]);

        let listed = list_entries_impl(&conn, "", "", "", "", 20, 0).unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(titles(&listed), vec!["Evening", "Morning"]);
        assert_eq!(fetch_entry(&conn, first).unwrap().entry_date, "2026-08-16");
        assert_eq!(fetch_entry(&conn, second).unwrap().entry_date, "2026-08-16");

        let third = write_entry(&conn, "Note", "2026-01-01", &["moved"]);
        update_entry_impl(
            &conn,
            third,
            "Note".to_string(),
            r#"{"type":"doc","content":[{"type":"paragraph","content":[
                {"type":"text","text":"moved"}]}]}"#
                .to_string(),
            "2026-08-16".to_string(),
        )
        .unwrap();
        assert_eq!(
            count_entries_impl(&conn, "", "2026-08-16", "2026-08-16", "").unwrap(),
            3
        );
    }

    #[test]
    fn a_phrase_is_found_even_when_a_mark_splits_it() {
        let conn = crate::db::init_db_at_connection_for_test();
        write_entry(&conn, "Marked", "2026-08-15", &["a ", "bold", " word"]);

        let found = list_entries_impl(&conn, "bold word", "", "", "", 20, 0).unwrap();
        assert_eq!(titles(&found), vec!["Marked"]);
    }

    #[test]
    fn structural_json_keys_are_no_longer_matchable() {
        let conn = crate::db::init_db_at_connection_for_test();
        write_entry(&conn, "Ordinary", "2026-08-15", &["nothing special here"]);

        for structural in ["paragraph", "doc", "type", "content", "text", "attrs"] {
            let hits = list_entries_impl(&conn, structural, "", "", "", 20, 0).unwrap();
            assert!(
                hits.is_empty(),
                "'{structural}' should not match document structure, got {:?}",
                titles(&hits)
            );
        }
    }

    #[test]
    fn accents_are_ignored_in_both_directions() {
        let conn = crate::db::init_db_at_connection_for_test();
        write_entry(
            &conn,
            "Italiano",
            "2026-08-15",
            &["oggi è una giornata perché"],
        );

        for query in ["è", "e", "perche", "perché", "giornata"] {
            let hits = list_entries_impl(&conn, query, "", "", "", 20, 0).unwrap();
            assert_eq!(
                titles(&hits),
                vec!["Italiano"],
                "query {query:?} found nothing"
            );
        }
    }

    #[test]
    fn the_last_word_matches_as_a_prefix_while_typing() {
        let conn = crate::db::init_db_at_connection_for_test();
        write_entry(
            &conn,
            "Growing",
            "2026-08-15",
            &["the tomatoes are ripening"],
        );

        for partial in ["tom", "toma", "tomatoes"] {
            let hits = list_entries_impl(&conn, partial, "", "", "", 20, 0).unwrap();
            assert_eq!(
                titles(&hits),
                vec!["Growing"],
                "prefix {partial:?} found nothing"
            );
        }
        assert!(list_entries_impl(&conn, "matoes", "", "", "", 20, 0)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn fts_operators_are_searched_for_rather_than_obeyed() {
        let conn = crate::db::init_db_at_connection_for_test();
        write_entry(&conn, "Logic", "2026-08-15", &["a logical AND gate"]);
        write_entry(&conn, "Other", "2026-08-14", &["something unrelated"]);

        for query in [
            "AND",
            "logical AND",
            "NOT gate",
            "\"unbalanced",
            "gate OR",
            "NEAR(a b)",
            "a*b",
            "title:logic",
            "^logical",
            "((()))",
            "-gate",
        ] {
            let result = list_entries_impl(&conn, query, "", "", "", 20, 0);
            assert!(result.is_ok(), "query {query:?} errored: {result:?}");
        }

        let hits = list_entries_impl(&conn, "AND", "", "", "", 20, 0).unwrap();
        assert_eq!(titles(&hits), vec!["Logic"]);

        let punctuation = list_entries_impl(&conn, "*** ---", "", "", "", 20, 0).unwrap();
        assert_eq!(punctuation.len(), 2);
    }

    #[test]
    fn snippets_mark_the_matching_words() {
        let conn = crate::db::init_db_at_connection_for_test();
        write_entry(
            &conn,
            "Walk",
            "2026-08-15",
            &["the mist hung low over the valley this morning"],
        );

        let hits = list_entries_impl(&conn, "valley", "", "", "", 20, 0).unwrap();
        let snippet = hits[0].snippet.as_deref().unwrap();
        assert!(
            snippet.contains(&format!("{HIGHLIGHT_OPEN}valley{HIGHLIGHT_CLOSE}")),
            "expected the match to be marked, got {snippet:?}"
        );
    }

    #[test]
    fn a_title_match_still_snippets_the_writing() {
        let conn = crate::db::init_db_at_connection_for_test();
        write_entry(
            &conn,
            "Kingfisher",
            "2026-08-15",
            &["the mist hung low over the valley this morning"],
        );

        let hits = list_entries_impl(&conn, "kingfisher", "", "", "", 20, 0).unwrap();
        let snippet = hits[0].snippet.as_deref().unwrap();
        assert!(
            snippet.contains("the mist hung low"),
            "expected the body, not the title, got {snippet:?}"
        );
    }

    #[test]
    fn the_index_follows_inserts_updates_and_deletes() {
        let mut conn = crate::db::init_db_at_connection_for_test();
        let id = write_entry(&conn, "First", "2026-08-15", &["kingfisher"]);

        assert_eq!(
            titles(&list_entries_impl(&conn, "kingfisher", "", "", "", 20, 0).unwrap()),
            vec!["First"]
        );

        update_entry_impl(
            &conn,
            id,
            "First".to_string(),
            r#"{"type":"doc","content":[{"type":"paragraph","content":[
                {"type":"text","text":"heron"}]}]}"#
                .to_string(),
            "2026-08-15".to_string(),
        )
        .unwrap();
        assert!(list_entries_impl(&conn, "kingfisher", "", "", "", 20, 0)
            .unwrap()
            .is_empty());
        assert_eq!(
            titles(&list_entries_impl(&conn, "heron", "", "", "", 20, 0).unwrap()),
            vec!["First"]
        );

        delete_entry_impl(
            &mut conn,
            &std::env::temp_dir().join("wattle_fts_delete"),
            id,
        )
        .unwrap();
        assert!(list_entries_impl(&conn, "heron", "", "", "", 20, 0)
            .unwrap()
            .is_empty());

        let indexed: i64 = conn
            .query_row("SELECT COUNT(*) FROM entries_fts", [], |row| row.get(0))
            .unwrap();
        let stored: i64 = conn
            .query_row("SELECT COUNT(*) FROM entries", [], |row| row.get(0))
            .unwrap();
        assert_eq!(indexed, stored);
    }

    #[test]
    fn a_date_range_narrows_both_browsing_and_searching() {
        let conn = crate::db::init_db_at_connection_for_test();
        write_entry(&conn, "January", "2026-01-10", &["snowfall"]);
        write_entry(&conn, "June", "2026-06-10", &["snowfall in june somehow"]);
        write_entry(&conn, "December", "2026-12-10", &["snowfall again"]);

        let spring_to_autumn =
            list_entries_impl(&conn, "", "2026-03-01", "2026-09-01", "", 20, 0).unwrap();
        assert_eq!(titles(&spring_to_autumn), vec!["June"]);

        let searched =
            list_entries_impl(&conn, "snowfall", "2026-03-01", "2026-09-01", "", 20, 0).unwrap();
        assert_eq!(titles(&searched), vec!["June"]);

        assert_eq!(
            titles(&list_entries_impl(&conn, "snowfall", "2026-07-01", "", "", 20, 0).unwrap()),
            vec!["December"]
        );
        assert_eq!(
            titles(&list_entries_impl(&conn, "snowfall", "", "2026-03-01", "", 20, 0).unwrap()),
            vec!["January"]
        );
    }

    #[test]
    fn counts_report_the_whole_result_not_just_the_page() {
        let conn = crate::db::init_db_at_connection_for_test();
        for index in 0..5 {
            write_entry(
                &conn,
                &format!("Entry {index}"),
                &format!("2026-08-{:02}", index + 1),
                &["kingfisher"],
            );
        }

        assert_eq!(
            list_entries_impl(&conn, "kingfisher", "", "", "", 2, 0)
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            count_entries_impl(&conn, "kingfisher", "", "", "").unwrap(),
            5
        );
        assert_eq!(count_entries_impl(&conn, "", "", "", "").unwrap(), 5);
        assert_eq!(
            count_entries_impl(&conn, "kingfisher", "2026-08-03", "", "").unwrap(),
            3
        );
        assert_eq!(count_entries_impl(&conn, "nothing", "", "", "").unwrap(), 0);
    }

    #[test]
    fn saving_an_entry_derives_its_text_preview_and_word_count() {
        let conn = crate::db::init_db_at_connection_for_test();
        let created = create_entry_impl(&conn, "2026-08-15".to_string(), "entry").unwrap();

        update_entry_impl(
            &conn,
            created.id,
            "Title".to_string(),
            r#"{"type":"doc","content":[
                {"type":"paragraph","content":[
                    {"type":"text","text":"a "},
                    {"type":"text","marks":[{"type":"bold"}],"text":"bold"},
                    {"type":"text","text":" word"}]},
                {"type":"paragraph","content":[{"type":"text","text":"second block"}]}]}"#
                .to_string(),
            "2026-08-15".to_string(),
        )
        .unwrap();

        let (content_text, preview, word_count): (String, String, i64) = conn
            .query_row(
                "SELECT content_text, preview, word_count FROM entries WHERE id = ?1",
                params![created.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();

        assert_eq!(content_text, "a bold word\nsecond block");
        assert_eq!(preview, "a bold word second block");
        assert_eq!(word_count, 5);
    }

    #[test]
    fn saving_content_that_will_not_parse_still_succeeds() {
        let conn = crate::db::init_db_at_connection_for_test();
        let created = create_entry_impl(&conn, "2026-08-15".to_string(), "entry").unwrap();

        let updated = update_entry_impl(
            &conn,
            created.id,
            "Broken".to_string(),
            "not json".to_string(),
            "2026-08-15".to_string(),
        )
        .unwrap();

        assert_eq!(updated.content, "not json");
        assert_eq!(updated.preview, "");
        assert_eq!(updated.word_count, 0);
    }

    #[test]
    fn an_unknown_node_type_is_saved_and_still_indexed() {
        let conn = crate::db::init_db_at_connection_for_test();
        let created = create_entry_impl(&conn, "2026-08-15".to_string(), "entry").unwrap();

        let updated = update_entry_impl(
            &conn,
            created.id,
            String::new(),
            r#"{"type":"doc","content":[{"type":"nodeFromAFutureRelease","content":[
                {"type":"text","text":"still findable"}]}]}"#
                .to_string(),
            "2026-08-15".to_string(),
        )
        .unwrap();

        assert_eq!(updated.preview, "still findable");
        assert_eq!(updated.word_count, 2);
    }
}
