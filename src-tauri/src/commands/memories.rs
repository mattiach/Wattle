//! A memory worth revisiting.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::State;

use crate::ollama;
use crate::state::AppState;

/// The most text one entry contributes to its own vector.
const MAX_EMBED_CHARS: usize = 8_000;

/// How alike two entries have to be before one is worth showing beside the
/// other.
const SIMILARITY_FLOOR: f32 = 0.55;

/// How near in time an entry has to be before it stops being a memory.
const MEMORY_COOLDOWN_DAYS: i64 = 15;

/// How alike two entries have to be *by their words* before one is worth
/// showing beside the other.
const LEXICAL_FLOOR: f32 = 0.14;

/// The shortest word worth comparing on.
const MIN_TERM_CHARS: usize = 4;

/// How many salient words are taken from one entry.
const MAX_TERMS: usize = 32;

/// How many entries the full-text index is asked for before they are scored.
const LEXICAL_CANDIDATES: usize = 200;

/// At most this many, and often fewer.
const MAX_MEMORIES: usize = 3;

/// Why a search for a memory came back with nothing.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NothingFound {
    /// Everything indexed is inside `MEMORY_COOLDOWN_DAYS` of this entry.
    TooRecent,
    /// There were candidates, and none of them was alike enough.
    NotAlike,
    /// Everything that qualified has already been offered on this page.
    Exhausted,
}

/// What a search for a memory came back with.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelatedMemoriesDto {
    pub memories: Vec<RelatedMemoryDto>,
    /// Set only when `memories` is empty, and then always.
    pub nothing: Option<NothingFound>,
}

impl RelatedMemoriesDto {
    fn nothing(reason: NothingFound) -> Self {
        Self {
            memories: Vec::new(),
            nothing: Some(reason),
        }
    }
}

/// Something written far enough back, about the same thing.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RelatedMemoryDto {
    pub id: i64,
    pub title: String,
    pub preview: String,
    pub entry_date: String,
    pub kind: String,
    /// How alike, between 0 and 1.
    pub similarity: f32,
}

/// The text an entry is embedded by.
fn embeddable(title: &str, text: &str) -> String {
    let joined = if title.trim().is_empty() {
        text.trim().to_string()
    } else {
        format!("{}\n{}", title.trim(), text.trim())
    };
    joined.chars().take(MAX_EMBED_CHARS).collect()
}

/// Entries that hold text and have no current vector for the current model.
fn stale_entries(
    conn: &Connection,
    only: Option<i64>,
) -> Result<Vec<(i64, String, String)>, String> {
    let mut statement = conn
        .prepare(
            "SELECT e.id, e.title, e.content_text FROM entries e              LEFT JOIN entry_embeddings v ON v.entry_id = e.id              WHERE e.content_text <> ''                AND (?3 IS NULL OR e.id = ?3)                AND (v.entry_id IS NULL                     OR v.model <> ?1                     OR v.dim <> ?2                     OR v.source_updated_at <> e.updated_at)              ORDER BY e.entry_date DESC, e.id DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(
            params![
                ollama::EMBEDDING_MODEL,
                ollama::EMBEDDING_DIMENSIONS as i64,
                only
            ],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn save_embedding(
    conn: &Connection,
    entry_id: i64,
    vector: &[f32],
    source_updated_at: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO entry_embeddings (entry_id, embedding, model, dim, source_updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5) \
         ON CONFLICT(entry_id) DO UPDATE SET \
           embedding = excluded.embedding, model = excluded.model, \
           dim = excluded.dim, source_updated_at = excluded.source_updated_at",
        params![
            entry_id,
            ollama::to_blob(vector),
            ollama::EMBEDDING_MODEL,
            vector.len() as i64,
            source_updated_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// The words an entry is compared on when there is no model to compare it with.
fn salient_terms(title: &str, text: &str) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    for word in format!("{title} {text}")
        .to_lowercase()
        .split(|character: char| !character.is_alphanumeric())
    {
        if word.chars().count() < MIN_TERM_CHARS {
            continue;
        }
        let word = word.to_string();
        if !seen.contains(&word) {
            seen.push(word);
        }
        if seen.len() == MAX_TERMS {
            break;
        }
    }
    seen
}

/// How alike two sets of salient words are, between 0 and 1.
fn overlap(left: &[String], right: &[String]) -> f32 {
    let smaller = left.len().min(right.len());
    if smaller == 0 {
        return 0.0;
    }
    let shared = left.iter().filter(|term| right.contains(term)).count();
    shared as f32 / smaller as f32
}

/// The FTS5 query that finds anything sharing a word with this entry.
fn match_query(terms: &[String]) -> Option<String> {
    if terms.is_empty() {
        return None;
    }
    Some(
        terms
            .iter()
            .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(" OR "),
    )
}

/// Scores candidates by their words, with no model involved at all.
fn lexical_scores(
    conn: &Connection,
    terms: &[String],
    eligible: &[i64],
) -> Result<Vec<(f32, i64)>, String> {
    let Some(query) = match_query(terms) else {
        return Ok(Vec::new());
    };

    let mut statement = conn
        .prepare(
            "SELECT f.rowid, e.title, e.content_text FROM entries_fts f \
             JOIN entries e ON e.id = f.rowid \
             WHERE entries_fts MATCH ?1 \
             ORDER BY bm25(entries_fts) \
             LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(params![query, LEXICAL_CANDIDATES as i64], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut scored = Vec::new();
    for (id, title, text) in rows {
        if !eligible.contains(&id) {
            continue;
        }
        let score = overlap(terms, &salient_terms(&title, &text));
        if score >= LEXICAL_FLOOR {
            scored.push((score, id));
        }
    }
    Ok(scored)
}

/// Whole days between two calendar dates, either way round.
fn days_apart(conn: &Connection, left: &str, right: &str) -> Result<i64, String> {
    conn.query_row(
        "SELECT abs(julianday(?1) - julianday(?2))",
        params![left, right],
        |row| row.get::<_, f64>(0),
    )
    .map(|days| days.round() as i64)
    .map_err(|e| e.to_string())
}

/// The entries worth comparing against, and their vectors.
#[allow(clippy::type_complexity)]
fn candidates(
    conn: &Connection,
    entry_id: i64,
    entry_date: &str,
    exclude: &[i64],
) -> Result<Vec<(i64, Vec<f32>)>, String> {
    let mut statement = conn
        .prepare(
            "SELECT e.id, e.entry_date, v.embedding FROM entry_embeddings v \
             JOIN entries e ON e.id = v.entry_id \
             WHERE v.model = ?1 AND v.dim = ?2 AND e.id <> ?3",
        )
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(
            params![
                ollama::EMBEDDING_MODEL,
                ollama::EMBEDDING_DIMENSIONS as i64,
                entry_id
            ],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Vec<u8>>(2)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut kept = Vec::new();
    for (id, date, blob) in rows {
        if exclude.contains(&id) {
            continue;
        }
        if days_apart(conn, entry_date, &date)? < MEMORY_COOLDOWN_DAYS {
            continue;
        }
        let Some(vector) = ollama::from_blob(&blob) else {
            continue;
        };
        kept.push((id, vector));
    }
    Ok(kept)
}

/// The entries far enough back to count as a memory at all.
fn eligible_entries(
    conn: &Connection,
    entry_id: i64,
    entry_date: &str,
    exclude: &[i64],
) -> Result<Vec<i64>, String> {
    let mut statement = conn
        .prepare(
            "SELECT id FROM entries              WHERE id <> ?1 AND content_text <> ''                AND abs(julianday(entry_date) - julianday(?2)) >= ?3",
        )
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(params![entry_id, entry_date, MEMORY_COOLDOWN_DAYS], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<i64>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .filter(|id| !exclude.contains(id))
        .collect())
}

/// The entry a memory would be looked for from, when one could be found at all.
#[tauri::command]
pub fn memory_anchor(state: State<AppState>) -> Result<Option<i64>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    anchor_impl(&conn)
}

fn anchor_impl(conn: &Connection) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT newest.id FROM \
           (SELECT id, entry_date FROM entries WHERE content_text <> '' \
            ORDER BY entry_date DESC, id DESC LIMIT 1) AS newest \
         JOIN \
           (SELECT MIN(entry_date) AS oldest FROM entries WHERE content_text <> '') AS span \
         WHERE julianday(newest.entry_date) - julianday(span.oldest) >= ?1",
        params![MEMORY_COOLDOWN_DAYS],
        |row| row.get::<_, i64>(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// Reads one entry for likeness, on its way out of the editor.
#[tauri::command]
pub async fn index_entry(state: State<'_, AppState>, entry_id: i64) -> Result<bool, String> {
    let pending = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let enabled: bool = conn
            .query_row("SELECT ai_enabled FROM settings WHERE id = 1", [], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or(false);
        if !enabled {
            return Ok(false);
        }
        stale_entries(&conn, Some(entry_id))?.into_iter().next()
    };
    let Some((_, title, text)) = pending else {
        return Ok(false);
    };

    let Ok(vector) = ollama::embed_at(
        &ollama::base_url(),
        ollama::EMBEDDING_MODEL,
        &embeddable(&title, &text),
    )
    .await
    else {
        return Ok(false);
    };

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let updated_at: Option<String> = conn
        .query_row(
            "SELECT updated_at FROM entries WHERE id = ?1",
            params![entry_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(updated_at) = updated_at else {
        return Ok(false);
    };
    save_embedding(&conn, entry_id, &vector, &updated_at)?;
    Ok(true)
}

/// One to three older entries about the same thing as this one.
#[tauri::command]
pub async fn related_memories(
    state: State<'_, AppState>,
    entry_id: i64,
    exclude: Option<Vec<i64>>,
) -> Result<RelatedMemoriesDto, String> {
    let already_seen = exclude.unwrap_or_default();

    let (enabled, title, text, entry_date, eligible, vectors) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let enabled: bool = conn
            .query_row("SELECT ai_enabled FROM settings WHERE id = 1", [], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or(false);

        let row: Option<(String, String, String)> = conn
            .query_row(
                "SELECT title, content_text, entry_date FROM entries WHERE id = ?1",
                params![entry_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let Some((title, text, entry_date)) = row else {
            return Err(format!("no entry with id {entry_id}"));
        };
        if text.trim().is_empty() {
            return Ok(RelatedMemoriesDto::nothing(NothingFound::NotAlike));
        }

        let eligible = eligible_entries(&conn, entry_id, &entry_date, &already_seen)?;
        if eligible.is_empty() {
            let reason = if already_seen.is_empty() {
                NothingFound::TooRecent
            } else {
                NothingFound::Exhausted
            };
            return Ok(RelatedMemoriesDto::nothing(reason));
        }

        let vectors = candidates(&conn, entry_id, &entry_date, &already_seen)?;
        (enabled, title, text, entry_date, eligible, vectors)
    };

    let scored = if enabled && !vectors.is_empty() {
        match embedded_scores(&state, entry_id, &title, &text, vectors).await {
            Ok(scored) => scored,
            Err(_) => {
                let conn = state.db.lock().map_err(|e| e.to_string())?;
                lexical_scores(&conn, &salient_terms(&title, &text), &eligible)?
            }
        }
    } else {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        lexical_scores(&conn, &salient_terms(&title, &text), &eligible)?
    };
    let _ = entry_date;

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let memories = describe(&conn, scored)?;
    if memories.is_empty() {
        return Ok(RelatedMemoriesDto::nothing(NothingFound::NotAlike));
    }
    Ok(RelatedMemoriesDto {
        memories,
        nothing: None,
    })
}

/// Scores by meaning: embeds the anchor and compares it against the index.
async fn embedded_scores(
    state: &State<'_, AppState>,
    entry_id: i64,
    title: &str,
    text: &str,
    vectors: Vec<(i64, Vec<f32>)>,
) -> Result<Vec<(f32, i64)>, String> {
    let vector = ollama::embed_at(
        &ollama::base_url(),
        ollama::EMBEDDING_MODEL,
        &embeddable(title, text),
    )
    .await?;

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let updated_at: Option<String> = conn
        .query_row(
            "SELECT updated_at FROM entries WHERE id = ?1",
            params![entry_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(updated_at) = updated_at {
        save_embedding(&conn, entry_id, &vector, &updated_at)?;
    }

    Ok(vectors
        .into_iter()
        .map(|(id, other)| (ollama::similarity(&vector, &other), id))
        .filter(|(score, _)| *score >= SIMILARITY_FLOOR)
        .collect())
}

/// The best few, as rows the interface can render.
fn describe(
    conn: &Connection,
    mut scored: Vec<(f32, i64)>,
) -> Result<Vec<RelatedMemoryDto>, String> {
    scored.sort_by(|left, right| {
        right
            .0
            .partial_cmp(&left.0)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    scored.truncate(MAX_MEMORIES);

    let mut memories = Vec::with_capacity(scored.len());
    for (similarity, id) in scored {
        let found = conn
            .query_row(
                "SELECT id, title, preview, entry_date, kind FROM entries WHERE id = ?1",
                params![id],
                |row| {
                    Ok(RelatedMemoryDto {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        preview: row.get(2)?,
                        entry_date: row.get(3)?,
                        kind: row.get(4)?,
                        similarity,
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some(found) = found {
            memories.push(found);
        }
    }
    Ok(memories)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_entry(conn: &Connection, date: &str, title: &str, text: &str) -> i64 {
        conn.execute(
            "INSERT INTO entries (title, content_text, preview, entry_date) \
             VALUES (?1, ?2, ?2, ?3)",
            params![title, text, date],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn reason_for(
        conn: &Connection,
        entry_id: i64,
        entry_date: &str,
        already_seen: &[i64],
    ) -> NothingFound {
        assert!(
            eligible_entries(conn, entry_id, entry_date, already_seen)
                .unwrap()
                .is_empty(),
            "this helper only explains an empty pool"
        );
        if already_seen.is_empty() {
            NothingFound::TooRecent
        } else {
            NothingFound::Exhausted
        }
    }

    #[test]
    fn salient_terms_keep_the_nouns_and_drop_the_glue() {
        let terms = salient_terms(
            "Una giornata",
            "Sono andato al mare con Elena, e il mare era calmo",
        );
        assert!(terms.contains(&"giornata".to_string()));
        assert!(terms.contains(&"andato".to_string()));
        assert!(terms.contains(&"elena".to_string()));
        for glue in ["sono", "con", "e", "il", "al"] {
            assert!(
                !terms.contains(&glue.to_string()) || glue.chars().count() >= MIN_TERM_CHARS,
                "{glue} should have been dropped"
            );
        }
        assert_eq!(terms.iter().filter(|term| *term == "mare").count(), 1);
        assert!(terms.len() <= MAX_TERMS);
    }

    #[test]
    fn overlap_asks_whether_the_shorter_one_is_about_the_longer_one() {
        let spark = vec!["mare".to_string(), "elena".to_string()];
        let entry: Vec<String> = ["mare", "elena", "treno", "pioggia", "cena", "libro"]
            .iter()
            .map(|term| (*term).to_string())
            .collect();
        assert!((overlap(&spark, &entry) - 1.0).abs() < f32::EPSILON);

        let unrelated = vec!["bicicletta".to_string(), "ufficio".to_string()];
        assert!(overlap(&unrelated, &entry) < LEXICAL_FLOOR);
        assert!(overlap(&[], &entry).abs() < f32::EPSILON);
    }

    #[test]
    fn the_match_query_cannot_be_read_as_fts_syntax() {
        let query = match_query(&["mare".to_string(), "NOT".to_string()]).unwrap();
        assert_eq!(query, "\"mare\" OR \"NOT\"");
        assert_eq!(
            match_query(&["say \"this\"".to_string()]).unwrap(),
            "\"say \"\"this\"\"\""
        );
        assert!(match_query(&[]).is_none());
    }

    #[test]
    fn words_alone_find_a_memory_with_no_vector_in_the_database() {
        let conn = crate::db::init_db_at_connection_for_test();
        let today = write_entry(
            &conn,
            "2026-08-20",
            "Il mare",
            "Sono tornato sulla spiaggia di Camogli con Elena",
        );
        let long_ago = write_entry(
            &conn,
            "2025-01-04",
            "Camogli",
            "La spiaggia di Camogli, il mare, Elena che rideva",
        );
        let unrelated = write_entry(
            &conn,
            "2025-01-05",
            "Fatture",
            "Ho passato la mattina a sistemare fatture e ricevute",
        );

        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM entry_embeddings", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );

        let eligible = eligible_entries(&conn, today, "2026-08-20", &[]).unwrap();
        assert!(eligible.contains(&long_ago));
        let terms = salient_terms(
            "Il mare",
            "Sono tornato sulla spiaggia di Camogli con Elena",
        );
        let scored = lexical_scores(&conn, &terms, &eligible).unwrap();

        let found: Vec<i64> = scored.iter().map(|(_, id)| *id).collect();
        assert!(found.contains(&long_ago), "got {scored:?}");
        assert!(
            !found.contains(&unrelated),
            "an unrelated day must not be manufactured into a memory: {scored:?}"
        );
    }

    #[test]
    fn words_never_reach_past_the_cooldown_either() {
        let conn = crate::db::init_db_at_connection_for_test();
        let today = write_entry(&conn, "2026-08-20", "Il mare", "la spiaggia di Camogli");
        let yesterday = write_entry(&conn, "2026-08-19", "Il mare", "la spiaggia di Camogli");

        let eligible = eligible_entries(&conn, today, "2026-08-20", &[]).unwrap();
        assert!(!eligible.contains(&yesterday));

        let terms = salient_terms("Il mare", "la spiaggia di Camogli");
        assert!(lexical_scores(&conn, &terms, &eligible).unwrap().is_empty());
    }

    fn vector(axis: usize) -> Vec<f32> {
        let mut values = vec![0.01_f32; ollama::EMBEDDING_DIMENSIONS];
        values[axis] = 1.0;
        ollama::normalise(values).unwrap()
    }

    fn index(conn: &Connection, entry_id: i64, axis: usize) {
        let updated_at: String = conn
            .query_row(
                "SELECT updated_at FROM entries WHERE id = ?1",
                params![entry_id],
                |row| row.get(0),
            )
            .unwrap();
        save_embedding(conn, entry_id, &vector(axis), &updated_at).unwrap();
    }

    #[test]
    fn an_entry_is_embedded_by_its_title_and_its_opening() {
        assert_eq!(embeddable("A title", "the body"), "A title\nthe body");
        assert_eq!(embeddable("  ", "the body"), "the body");
        let long = embeddable("", &"è".repeat(MAX_EMBED_CHARS + 500));
        assert_eq!(long.chars().count(), MAX_EMBED_CHARS);
    }

    #[test]
    fn everything_unread_out_of_date_or_from_another_model_needs_reading_again() {
        let conn = crate::db::init_db_at_connection_for_test();
        let fresh = write_entry(&conn, "2026-01-01", "", "something");
        let edited = write_entry(&conn, "2026-02-01", "", "something else");
        let foreign = write_entry(&conn, "2026-03-01", "", "a third thing");
        write_entry(&conn, "2026-04-01", "", "");

        index(&conn, fresh, 0);
        index(&conn, edited, 1);
        index(&conn, foreign, 2);
        conn.execute(
            "UPDATE entries SET updated_at = '2030-01-01T00:00:00.000Z' WHERE id = ?1",
            params![edited],
        )
        .unwrap();
        conn.execute(
            "UPDATE entry_embeddings SET model = 'something-else' WHERE entry_id = ?1",
            params![foreign],
        )
        .unwrap();

        let pending: Vec<i64> = stale_entries(&conn, None)
            .unwrap()
            .into_iter()
            .map(|e| e.0)
            .collect();
        assert!(pending.contains(&edited), "a rewritten entry is read again");
        assert!(
            pending.contains(&foreign),
            "another model's vector is unusable"
        );
        assert!(!pending.contains(&fresh), "a current vector is left alone");
        assert_eq!(pending.len(), 2, "a blank entry is never indexed");
    }

    #[test]
    fn a_journal_too_young_to_hold_a_memory_offers_nothing_to_press() {
        let conn = crate::db::init_db_at_connection_for_test();
        assert_eq!(anchor_impl(&conn).unwrap(), None, "an empty journal");

        write_entry(&conn, "2026-08-01", "primo", "una cosa");
        let newest = write_entry(&conn, "2026-08-14", "ultimo", "un'altra");
        assert_eq!(
            anchor_impl(&conn).unwrap(),
            None,
            "thirteen days is not far enough for anything to be a memory"
        );

        let today = write_entry(&conn, "2026-08-16", "oggi", "un'altra ancora");
        assert_eq!(anchor_impl(&conn).unwrap(), Some(today));
        assert_ne!(anchor_impl(&conn).unwrap(), Some(newest));

        let conn = crate::db::init_db_at_connection_for_test();
        write_entry(&conn, "2026-01-01", "vuoto", "");
        write_entry(&conn, "2026-08-16", "oggi", "una cosa");
        assert_eq!(anchor_impl(&conn).unwrap(), None);
    }

    #[test]
    fn nothing_found_says_which_kind_of_nothing() {
        let conn = crate::db::init_db_at_connection_for_test();
        let today = write_entry(&conn, "2026-08-20", "oggi", "una cosa");

        assert_eq!(
            reason_for(&conn, today, "2026-08-20", &[]),
            NothingFound::TooRecent
        );

        let recent = write_entry(&conn, "2026-08-12", "poco fa", "un'altra");
        index(&conn, recent, 0);
        assert_eq!(
            reason_for(&conn, today, "2026-08-20", &[]),
            NothingFound::TooRecent
        );

        let old = write_entry(&conn, "2025-01-01", "molto tempo fa", "un'altra");
        index(&conn, old, 0);
        assert!(!candidates(&conn, today, "2026-08-20", &[])
            .unwrap()
            .is_empty());
        assert_eq!(
            reason_for(&conn, today, "2026-08-20", &[old]),
            NothingFound::Exhausted
        );
    }

    #[test]
    fn something_written_recently_is_not_a_memory_however_alike_it_is() {
        let conn = crate::db::init_db_at_connection_for_test();
        let reading = write_entry(&conn, "2026-06-01", "", "about the sea");
        let yesterday = write_entry(&conn, "2026-05-31", "", "also about the sea");
        let long_ago = write_entry(&conn, "2025-06-01", "", "the sea again");

        for id in [reading, yesterday, long_ago] {
            index(&conn, id, 0);
        }

        let found = candidates(&conn, reading, "2026-06-01", &[]).unwrap();
        let ids: Vec<i64> = found.iter().map(|(id, _)| *id).collect();

        assert_eq!(ids, vec![long_ago]);
        assert!(!ids.contains(&reading), "an entry is never its own memory");
        assert!(!ids.contains(&yesterday));
    }

    #[test]
    fn what_has_already_been_shown_is_not_offered_a_second_time() {
        let conn = crate::db::init_db_at_connection_for_test();
        let reading = write_entry(&conn, "2026-06-01", "", "about the sea");
        let first = write_entry(&conn, "2024-01-01", "", "the sea");
        let second = write_entry(&conn, "2024-02-01", "", "the sea once more");
        for id in [reading, first, second] {
            index(&conn, id, 0);
        }

        let all = candidates(&conn, reading, "2026-06-01", &[]).unwrap();
        assert_eq!(all.len(), 2);

        let after = candidates(&conn, reading, "2026-06-01", &[first]).unwrap();
        assert_eq!(
            after.iter().map(|(id, _)| *id).collect::<Vec<_>>(),
            vec![second]
        );
    }

    #[test]
    fn a_vector_from_another_model_is_never_a_candidate() {
        let conn = crate::db::init_db_at_connection_for_test();
        let reading = write_entry(&conn, "2026-06-01", "", "about the sea");
        let other = write_entry(&conn, "2024-01-01", "", "the sea");
        index(&conn, reading, 0);
        index(&conn, other, 0);
        conn.execute(
            "UPDATE entry_embeddings SET model = 'something-else' WHERE entry_id = ?1",
            params![other],
        )
        .unwrap();

        assert!(candidates(&conn, reading, "2026-06-01", &[])
            .unwrap()
            .is_empty());
    }

    #[test]
    fn similarity_separates_the_alike_from_the_merely_present() {
        let same = ollama::similarity(&vector(0), &vector(0));
        let different = ollama::similarity(&vector(0), &vector(500));

        assert!(same > 0.99, "the same direction is the same thing: {same}");
        assert!(
            different < SIMILARITY_FLOOR,
            "two unrelated entries must fall below the floor, got {different}"
        );
        assert_eq!(ollama::similarity(&vector(0), &[0.5, 0.5]), 0.0);
        assert_eq!(ollama::similarity(&[], &[]), 0.0);
    }

    #[test]
    fn deleting_an_entry_takes_its_vector_with_it() {
        let conn = crate::db::init_db_at_connection_for_test();
        let entry = write_entry(&conn, "2026-01-01", "", "something");
        index(&conn, entry, 0);

        conn.execute("DELETE FROM entries WHERE id = ?1", params![entry])
            .unwrap();

        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM entry_embeddings", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn a_vector_stored_and_read_back_is_the_same_vector() {
        let original = vector(7);
        let round_trip = ollama::from_blob(&ollama::to_blob(&original)).unwrap();
        assert_eq!(round_trip, original);

        assert!(ollama::from_blob(&[]).is_none());
        assert!(ollama::from_blob(&[1, 2, 3]).is_none());
    }

    #[test]
    fn similarity_work_never_writes_to_the_journal() {
        let source = std::fs::read_to_string("src/commands/memories.rs").unwrap();
        let code = source.split("#[cfg(test)]").next().unwrap();
        for forbidden in [
            "INSERT INTO entries",
            "UPDATE entries",
            "DELETE FROM entries",
            "INTO attachments",
            "INTO entries_fts",
        ] {
            assert!(!code.contains(forbidden), "memories must not {forbidden}");
        }
    }
}
