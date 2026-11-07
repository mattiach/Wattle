//! HTML export.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use tauri::State;

use crate::commands::entries::is_calendar_date;
use crate::content::{escape_html, AttachmentLink};
use crate::models::{AttachmentDto, EntryDto};
use crate::state::AppState;

/// Long enough to recognise an entry by, short enough to survive a filesystem
/// with a path limit.
const SLUG_MAX_LENGTH: usize = 60;

/// An entry file in a journal export sits at `entries/YYYY/stem.ext`, two
/// directories below the root that holds `attachments/`.
const JOURNAL_LINK_PREFIX: &str = "../../";
const ENTRY_LINK_PREFIX: &str = "";

/// Literata, subsetted to Latin and Latin Extended, upright and italic.
const FONTS: [(&str, &[u8]); 4] = [
    (
        "literata-latin-wght-normal.woff2",
        include_bytes!("../../assets/fonts/literata-latin-wght-normal.woff2"),
    ),
    (
        "literata-latin-wght-italic.woff2",
        include_bytes!("../../assets/fonts/literata-latin-wght-italic.woff2"),
    ),
    (
        "literata-latin-ext-wght-normal.woff2",
        include_bytes!("../../assets/fonts/literata-latin-ext-wght-normal.woff2"),
    ),
    (
        "literata-latin-ext-wght-italic.woff2",
        include_bytes!("../../assets/fonts/literata-latin-ext-wght-italic.woff2"),
    ),
];

const FONT_LICENSE: &str = include_str!("../../assets/fonts/Literata-OFL.txt");

const STYLESHEET: &str = include_str!("../../assets/wattle-export.css");

const MONTH_NAMES: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

/// Folds a title into a filename slug: lowercase ASCII letters, digits and
/// hyphens, and nothing else.
fn to_slug(title: &str) -> String {
    let mut folded = String::new();
    for character in title.to_lowercase().chars() {
        if character.is_ascii_alphanumeric() {
            folded.push(character);
            continue;
        }
        folded.push_str(match character {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => "a",
            'ç' => "c",
            'è' | 'é' | 'ê' | 'ë' => "e",
            'ì' | 'í' | 'î' | 'ï' => "i",
            'ñ' => "n",
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' => "o",
            'ù' | 'ú' | 'û' | 'ü' => "u",
            'ý' | 'ÿ' => "y",
            'æ' => "ae",
            'œ' => "oe",
            'ß' => "ss",
            _ => "-",
        });
    }

    let collapsed = folded
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    collapsed
        .chars()
        .take(SLUG_MAX_LENGTH)
        .collect::<String>()
        .trim_end_matches('-')
        .to_string()
}

/// The filename an entry gets, without its extension.
fn entry_stem(entry_date: &str, title: &str) -> String {
    let date = to_slug(entry_date);
    let date = if date.is_empty() {
        "undated".to_string()
    } else {
        date
    };
    let slug = to_slug(title);
    if slug.is_empty() {
        date
    } else {
        format!("{date}-{slug}")
    }
}

/// A letter's filename: the day it was written, and the word.
fn letter_stem(letter: &crate::commands::letters::LetterDto) -> String {
    format!("{}-letter", to_slug(&letter.written_on))
}

/// The year an entry files under.
fn entry_year(entry_date: &str) -> &str {
    if is_calendar_date(entry_date) {
        &entry_date[0..4]
    } else {
        "undated"
    }
}

/// The month an entry falls in, as a name.
fn entry_month(entry_date: &str) -> &str {
    if !is_calendar_date(entry_date) {
        return "";
    }
    entry_date[5..7]
        .parse::<usize>()
        .ok()
        .and_then(|month| MONTH_NAMES.get(month - 1))
        .copied()
        .unwrap_or("")
}

/// Two untitled entries on one day would otherwise be the same file, and the
/// second would silently overwrite the first.
fn claim_unique(stem: String, taken: &mut HashSet<String>) -> String {
    if taken.insert(stem.clone()) {
        return stem;
    }
    let mut suffix = 2;
    loop {
        let candidate = format!("{stem}-{suffix}");
        if taken.insert(candidate.clone()) {
            return candidate;
        }
        suffix += 1;
    }
}

fn load_entries(conn: &Connection, only: Option<i64>) -> Result<Vec<EntryDto>, String> {
    let sql =
        "SELECT id, title, content, preview, word_count, kind, entry_date, created_at, updated_at \
               FROM entries WHERE (?1 = 0 OR id = ?1) ORDER BY entry_date ASC, id ASC";
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![only.unwrap_or(0)], |row| {
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
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn load_entry(conn: &Connection, id: i64) -> Result<EntryDto, String> {
    load_entries(conn, Some(id))?
        .pop()
        .ok_or_else(|| format!("no entry with id {id}"))
}

/// A document, or `Null` when the stored content will not parse - which the
/// renderers treat as "show it verbatim" rather than as an empty entry.
fn parse(entry: &EntryDto) -> serde_json::Value {
    serde_json::from_str(&entry.content).unwrap_or(serde_json::Value::Null)
}

/// Where an entry's attachments are reached from the file that references them:
/// a plain relative path to the copy made under `attachments/`.
fn attachment_links(attachments: &[AttachmentDto], prefix: &str) -> BTreeMap<i64, AttachmentLink> {
    attachments
        .iter()
        .filter(|attachment| crate::paths::is_well_formed_stored_path(&attachment.path))
        .map(|attachment| {
            (
                attachment.id,
                AttachmentLink {
                    href: format!("{prefix}{}", attachment.path),
                    label: attachment.filename.clone(),
                },
            )
        })
        .collect()
}

/// Copies an entry's attachments under `root`, keeping the
/// `attachments/<entryId>/<file>` shape they have in the journal - which is
/// what makes the relative links resolve without any rewriting.
fn copy_attachments(
    wattle_dir: &Path,
    root: &Path,
    attachments: &[AttachmentDto],
) -> Result<(), String> {
    for attachment in attachments {
        let Some(source) = crate::paths::trusted_stored_path(wattle_dir, &attachment.path)? else {
            continue;
        };
        if !source.try_exists().map_err(|e| e.to_string())? {
            continue;
        }
        let Some(destination) = crate::paths::trusted_stored_path(root, &attachment.path)? else {
            continue;
        };
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let destination = crate::paths::stored_path(root, &attachment.path)?;
        std::fs::copy(&source, &destination).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The stylesheet and the font every exported page links to, written beside the
/// pages that link to them.
fn write_html_assets(root: &Path) -> Result<(), String> {
    write_file(&root.join("style.css"), STYLESHEET)?;
    write_file(&root.join("fonts/Literata-OFL.txt"), FONT_LICENSE)?;
    for (name, bytes) in FONTS {
        write_bytes(&root.join("fonts").join(name), bytes)?;
    }
    Ok(())
}

fn write_file(path: &Path, contents: &str) -> Result<(), String> {
    write_bytes(path, contents.as_bytes())
}

fn write_bytes(path: &Path, contents: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, contents).map_err(|e| e.to_string())
}

/// A folder that does not exist yet, so exporting twice in one day never writes
/// one export over another.
fn free_directory(parent: &Path, name: &str) -> PathBuf {
    let mut candidate = parent.join(name);
    let mut suffix = 2;
    while candidate.exists() {
        candidate = parent.join(format!("{name}-{suffix}"));
        suffix += 1;
    }
    candidate
}

/// The folder one exported page gets to itself.
fn page_folder(destination_path: &Path) -> Result<(PathBuf, PathBuf), String> {
    let parent = match destination_path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    };
    let stem = destination_path.file_stem().map_or_else(
        || "export".to_string(),
        |stem| stem.to_string_lossy().into(),
    );
    let root = free_directory(parent, &stem);
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let page = root.join(format!("{stem}.html"));
    Ok((root, page))
}

fn html_body(
    document: &serde_json::Value,
    links: &BTreeMap<i64, AttachmentLink>,
    raw: &str,
) -> String {
    if document.is_null() {
        format!("<pre><code>{}</code></pre>", escape_html(raw))
    } else {
        crate::content::to_html(document, links)
    }
}

/// The shell every exported page shares.
fn html_page(title: &str, head: &str, body: &str) -> String {
    format!(
        "<!doctype html>\n\
         <html lang=\"en\">\n\
         <head>\n\
         <meta charset=\"utf-8\">\n\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
         <title>{}</title>\n\
         {head}\n\
         </head>\n\
         <body>\n{body}\n</body>\n\
         </html>\n",
        escape_html(title)
    )
}

/// The entry itself: its date, its title, its content.
fn html_article(entry: &EntryDto, links: &BTreeMap<i64, AttachmentLink>) -> String {
    let mut out = String::from("<article>\n");
    out.push_str(&format!(
        "<p class=\"meta\"><time datetime=\"{}\">{}</time>{}</p>\n",
        escape_html(&entry.entry_date),
        escape_html(&entry.entry_date),
        match entry.kind.as_str() {
            "spark" => "<span class=\"kind\">Spark</span>",
            crate::commands::entries::LETTER_KIND => "<span class=\"kind\">Letter</span>",
            _ => "",
        }
    ));
    if !entry.title.is_empty() {
        out.push_str(&format!("<h1>{}</h1>\n", escape_html(&entry.title)));
    }
    out.push_str(&html_body(&parse(entry), links, &entry.content));
    out.push_str("\n</article>\n");
    out
}

/// How an entry names itself in an index or a browser tab.
fn entry_label(entry: &EntryDto) -> &str {
    if entry.title.is_empty() {
        &entry.entry_date
    } else {
        &entry.title
    }
}

fn export_entry_impl(
    conn: &Connection,
    wattle_dir: &Path,
    id: i64,
    destination_path: &Path,
) -> Result<String, String> {
    let entry = load_entry(conn, id)?;
    let attachments = crate::commands::attachments::list_attachments_impl(conn, id)?;

    let (root, page) = page_folder(destination_path)?;
    copy_attachments(wattle_dir, &root, &attachments)?;
    let links = attachment_links(&attachments, ENTRY_LINK_PREFIX);

    write_html_assets(&root)?;
    let contents = html_page(
        entry_label(&entry),
        "<link href=\"style.css\" rel=\"stylesheet\">",
        &format!(
            "<main class=\"entry\">\n{}</main>\n",
            html_article(&entry, &links)
        ),
    );
    write_file(&page, &contents)?;
    Ok(page.to_string_lossy().to_string())
}

/// An entry with its place in the export decided.
struct Planned {
    entry: EntryDto,
    links: BTreeMap<i64, AttachmentLink>,
    stem: String,
    year: String,
}

impl Planned {
    fn relative_path(&self) -> String {
        format!("entries/{}/{}.html", self.year, self.stem)
    }
}

/// The link table for one opened letter, and the files copied in beside it.
fn letter_attachments(
    conn: &Connection,
    wattle_dir: &Path,
    root: &Path,
    letter_id: i64,
    prefix: &str,
) -> Result<BTreeMap<i64, AttachmentLink>, String> {
    let attachments = crate::commands::letters::opened_attachments(conn, letter_id)?;
    let mut links = BTreeMap::new();
    for attachment in attachments {
        let (Some(source), Some(destination)) = (
            crate::paths::trusted_stored_path(wattle_dir, &attachment.path)?,
            crate::paths::trusted_stored_path(root, &attachment.path)?,
        ) else {
            continue;
        };
        if source.try_exists().map_err(|e| e.to_string())? {
            if let Some(parent) = destination.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let destination = crate::paths::stored_path(root, &attachment.path)?;
            std::fs::copy(&source, &destination).map_err(|e| e.to_string())?;
        }
        links.insert(
            attachment.id,
            AttachmentLink {
                href: format!("{prefix}{}", attachment.path),
                label: attachment.filename.clone(),
            },
        );
    }
    Ok(links)
}

fn letter_document(letter: &crate::commands::letters::LetterDto) -> serde_json::Value {
    serde_json::from_str(&letter.content).unwrap_or(serde_json::Value::Null)
}

fn html_letter_article(
    letter: &crate::commands::letters::LetterDto,
    links: &BTreeMap<i64, AttachmentLink>,
) -> String {
    format!(
        "<article>\n<p class=\"meta\"><time datetime=\"{}\">{}</time>\
         <span class=\"kind\">Letter</span></p>\n{}\n\
         <p class=\"meta\">Sealed until {}. Opened {}.</p>\n</article>\n",
        escape_html(&letter.written_on),
        escape_html(&letter.written_on),
        html_body(&letter_document(letter), links, &letter.content),
        escape_html(&letter.unlock_on),
        escape_html(&letter.opened_at),
    )
}

fn html_index(planned: &[Planned]) -> String {
    let mut body = String::from("<main class=\"index\">\n<h1>Wattle journal</h1>\n");
    let mut current_year = "";
    let mut current_month = "";
    let mut list_open = false;

    for item in planned {
        let month = entry_month(&item.entry.entry_date);
        if item.year != current_year || month != current_month {
            if list_open {
                body.push_str("</ul>\n");
            }
            if item.year != current_year {
                body.push_str(&format!("<h2>{}</h2>\n", escape_html(&item.year)));
                current_year = &item.year;
                current_month = "";
            }
            if month != current_month {
                body.push_str(&format!("<h3>{}</h3>\n", escape_html(month)));
                current_month = month;
            }
            body.push_str("<ul class=\"entries\">\n");
            list_open = true;
        }

        body.push_str(&format!(
            "<li><a href=\"{}\">{}</a><time datetime=\"{}\">{}</time></li>\n",
            escape_html(&item.relative_path()),
            escape_html(entry_label(&item.entry)),
            escape_html(&item.entry.entry_date),
            escape_html(&item.entry.entry_date),
        ));
    }

    if list_open {
        body.push_str("</ul>\n");
    }

    body.push_str("</main>\n");
    html_page(
        "Wattle journal",
        "<link href=\"style.css\" rel=\"stylesheet\">",
        &body,
    )
}

/// One entry's page inside a journal export, with a way back to the index and
/// on to its neighbours in time - which is how the archive is read without any
/// software to navigate it.
fn html_journal_entry(planned: &[Planned], index: usize) -> String {
    let item = &planned[index];
    let mut body = String::from("<main class=\"entry\">\n");
    body.push_str("<nav class=\"back\"><a href=\"../../index.html\">Wattle journal</a></nav>\n");
    body.push_str(&html_article(&item.entry, &item.links));

    let link = |other: &Planned, label: &str, class: &str| {
        format!(
            "<a class=\"{class}\" href=\"../{}/{}.html\">{label}</a>",
            escape_html(&other.year),
            escape_html(&other.stem)
        )
    };
    let previous = index
        .checked_sub(1)
        .map(|i| link(&planned[i], "← Earlier", "previous"));
    let next = planned
        .get(index + 1)
        .map(|other| link(other, "Later →", "next"));
    if previous.is_some() || next.is_some() {
        body.push_str(&format!(
            "<nav class=\"pager\">{}{}</nav>\n",
            previous.unwrap_or_default(),
            next.unwrap_or_default()
        ));
    }

    body.push_str("</main>\n");
    html_page(
        entry_label(&item.entry),
        "<link href=\"../../style.css\" rel=\"stylesheet\">",
        &body,
    )
}

fn export_journal_impl(
    conn: &Connection,
    wattle_dir: &Path,
    destination_dir: &Path,
) -> Result<String, String> {
    let entries = load_entries(conn, None)?;
    if entries.is_empty() {
        return Err("there is nothing to export".to_string());
    }

    let today: String = conn
        .query_row("SELECT date('now','localtime')", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let root = free_directory(destination_dir, &format!("wattle-export-{today}"));
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;

    let mut taken = HashSet::new();
    let mut planned = Vec::with_capacity(entries.len());

    for entry in entries {
        let attachments = crate::commands::attachments::list_attachments_impl(conn, entry.id)?;
        copy_attachments(wattle_dir, &root, &attachments)?;

        planned.push(Planned {
            links: attachment_links(&attachments, JOURNAL_LINK_PREFIX),
            stem: claim_unique(entry_stem(&entry.entry_date, &entry.title), &mut taken),
            year: entry_year(&entry.entry_date).to_string(),
            entry,
        });
    }

    for (index, item) in planned.iter().enumerate() {
        write_file(
            &root.join(item.relative_path()),
            &html_journal_entry(&planned, index),
        )?;
    }

    write_file(&root.join("index.html"), &html_index(&planned))?;
    write_html_assets(&root)?;

    Ok(root.to_string_lossy().to_string())
}

/// What the save dialog should open with.
#[tauri::command]
pub fn entry_export_filename(state: State<AppState>, id: i64) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let entry = load_entry(&conn, id)?;
    Ok(entry_stem(&entry.entry_date, &entry.title))
}

#[tauri::command]
pub fn export_entry_html(
    state: State<AppState>,
    id: i64,
    destination_path: String,
) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    export_entry_impl(
        &conn,
        &state.wattle_dir()?,
        id,
        Path::new(&destination_path),
    )
}

/// One opened letter, on its own, in whichever reading the reader needs.
fn export_letter_impl(
    conn: &Connection,
    wattle_dir: &Path,
    id: i64,
    destination_path: &Path,
) -> Result<String, String> {
    let letter = crate::commands::letters::open_letter_for_export(conn, wattle_dir, id)?;
    let (root, page) = page_folder(destination_path)?;
    let links = letter_attachments(conn, wattle_dir, &root, id, ENTRY_LINK_PREFIX)?;
    write_html_assets(&root)?;
    let contents = html_page(
        &format!("Letter written {}", letter.written_on),
        "<link href=\"style.css\" rel=\"stylesheet\">",
        &format!(
            "<main class=\"entry\">\n{}</main>\n",
            html_letter_article(&letter, &links)
        ),
    );
    write_file(&page, &contents)?;
    Ok(page.to_string_lossy().to_string())
}

#[tauri::command]
pub fn letter_export_filename(state: State<AppState>, id: i64) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(letter_stem(
        &crate::commands::letters::open_letter_for_export(&conn, &state.wattle_dir()?, id)?,
    ))
}

#[tauri::command]
pub fn export_letter_html(
    state: State<AppState>,
    id: i64,
    destination_path: String,
) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    export_letter_impl(
        &conn,
        &state.wattle_dir()?,
        id,
        Path::new(&destination_path),
    )
}

#[tauri::command]
pub fn export_journal_html(
    state: State<AppState>,
    destination_dir: String,
) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    export_journal_impl(&conn, &state.wattle_dir()?, Path::new(&destination_dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paragraph(text: &str) -> String {
        format!(
            r#"{{"type":"doc","content":[{{"type":"paragraph","content":[
                {{"type":"text","text":{}}}]}}]}}"#,
            serde_json::to_string(text).unwrap()
        )
    }

    fn write_entry(conn: &Connection, title: &str, entry_date: &str, content: &str) -> i64 {
        conn.execute(
            "INSERT INTO entries (title, content, entry_date) VALUES (?1, ?2, ?3)",
            params![title, content, entry_date],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn scratch(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(name);
        std::fs::remove_dir_all(&path).ok();
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn read(root: &Path, relative: &str) -> String {
        std::fs::read_to_string(root.join(relative))
            .unwrap_or_else(|_| panic!("missing {relative}"))
    }

    fn tree(root: &Path) -> Vec<String> {
        let mut found = Vec::new();
        for entry in walkdir::WalkDir::new(root) {
            let entry = entry.unwrap();
            if entry.file_type().is_file() {
                found.push(
                    entry
                        .path()
                        .strip_prefix(root)
                        .unwrap()
                        .to_string_lossy()
                        .replace('\\', "/"),
                );
            }
        }
        found.sort();
        found
    }

    #[test]
    fn a_journal_export_carries_no_letters_at_all() {
        let mut conn = crate::db::init_db_at_connection_for_test();
        let wattle_dir = scratch("wattle_export_letters_source");
        let destination = scratch("wattle_export_letters_out");
        write_entry(
            &conn,
            "An entry",
            "2026-08-15",
            &paragraph("the ordinary day"),
        );

        const LETTER_TEXT: &str = "quince and mulberry";
        let opened = crate::commands::letters::draft_for_test(&conn, &paragraph(LETTER_TEXT));
        crate::commands::letters::seal_for_test(
            &mut conn,
            &wattle_dir,
            opened,
            "2020-01-01",
            "2019-06-01",
        );
        crate::commands::letters::open_letter_for_export(&conn, &wattle_dir, opened).unwrap();

        let still_sealed = crate::commands::letters::draft_for_test(&conn, &paragraph("not yet"));
        crate::commands::letters::seal_for_test(
            &mut conn,
            &wattle_dir,
            still_sealed,
            "2126-01-01",
            "2125-12-01",
        );

        let root = PathBuf::from(export_journal_impl(&conn, &wattle_dir, &destination).unwrap());

        let files = tree(&root);
        assert!(
            !files.iter().any(|name| name.starts_with("letters/")),
            "no letter has a file: {files:?}"
        );

        for name in files.iter().filter(|name| name.ends_with(".html")) {
            let contents = read(&root, name);
            assert!(!contents.contains(LETTER_TEXT), "{name} carries a letter");
            assert!(!contents.contains("not yet"), "{name} carries a letter");
        }

        let index = read(&root, "index.html");
        assert!(!index.contains("Letters"));
        assert!(!index.contains("sealed"));
        assert!(!index.contains("2126-01-01"));

        std::fs::remove_dir_all(&wattle_dir).ok();
        std::fs::remove_dir_all(&destination).ok();
    }

    #[test]
    fn a_journal_export_leaves_the_trash_behind() {
        let mut conn = crate::db::init_db_at_connection_for_test();
        let wattle_dir = scratch("wattle_export_trash_source");
        let destination = scratch("wattle_export_trash_out");

        write_entry(&conn, "Kept", "2026-08-15", &paragraph("the ordinary day"));
        let thrown = write_entry(
            &conn,
            "Thrown away",
            "2026-08-16",
            &paragraph("regretted words"),
        );
        crate::commands::trash::trash_entry(&mut conn, thrown).unwrap();

        let root = PathBuf::from(export_journal_impl(&conn, &wattle_dir, &destination).unwrap());

        let files = tree(&root);
        assert_eq!(
            files.iter().filter(|name| name.ends_with(".html")).count(),
            2,
            "the index and the one surviving entry: {files:?}"
        );
        for name in files.iter().filter(|name| name.ends_with(".html")) {
            let contents = read(&root, name);
            assert!(!contents.contains("regretted words"), "{name}");
            assert!(!contents.contains("Thrown away"), "{name}");
        }

        std::fs::remove_dir_all(&wattle_dir).ok();
        std::fs::remove_dir_all(&destination).ok();
    }

    fn write_entry_with_image(conn: &Connection, wattle_dir: &Path, title: &str) -> i64 {
        let id = write_entry(
            conn,
            title,
            "2026-08-16",
            r#"{"type":"doc","content":[
                {"type":"paragraph","content":[{"type":"text","text":"look"}]},
                {"type":"imageAttachment","attrs":{"attachmentId":1,"path":"attachments/1/1.png"}}]}"#,
        );
        std::fs::create_dir_all(wattle_dir.join("attachments/1")).unwrap();
        std::fs::write(wattle_dir.join("attachments/1/1.png"), b"png-bytes").unwrap();
        conn.execute(
            "INSERT INTO attachments (id, entry_id, filename, mime_type, size, path) \
             VALUES (1, ?1, 'holiday.png', 'image/png', 9, 'attachments/1/1.png')",
            params![id],
        )
        .unwrap();
        id
    }

    fn follow(from_file: &Path, relative: &str) -> std::path::PathBuf {
        from_file.parent().unwrap().join(relative)
    }

    #[test]
    fn a_slug_is_ascii_and_folds_accents() {
        assert_eq!(to_slug("A Walk in the Rain"), "a-walk-in-the-rain");
        assert_eq!(to_slug("Perché è così"), "perche-e-cosi");
        assert_eq!(to_slug("  spaced   out  "), "spaced-out");
        assert_eq!(to_slug("Grüße aus Köln"), "grusse-aus-koln");
        assert_eq!(to_slug("日記"), "");
        assert_eq!(to_slug("!!!"), "");
        let long = to_slug(&"word ".repeat(40));
        assert!(long.len() <= SLUG_MAX_LENGTH);
        assert!(!long.ends_with('-'));
    }

    #[test]
    fn a_filename_cannot_be_illegal_or_reserved_on_windows() {
        for (title, expected) in [
            ("CON", "2026-08-16-con"),
            ("nul", "2026-08-16-nul"),
            ("COM1", "2026-08-16-com1"),
            ("a<b>c:d\"e/f\\g|h?i*j", "2026-08-16-a-b-c-d-e-f-g-h-i-j"),
            ("trailing dots...", "2026-08-16-trailing-dots"),
            (
                "with\u{7}control\u{1}chars",
                "2026-08-16-with-control-chars",
            ),
            ("", "2026-08-16"),
            ("日記", "2026-08-16"),
        ] {
            let stem = entry_stem("2026-08-16", title);
            assert_eq!(stem, expected, "title {title:?}");
            assert!(
                stem.chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'),
                "stem {stem:?} left a character outside the safe alphabet"
            );
        }

        assert_eq!(entry_stem("../../etc", "x"), "etc-x");
        assert_eq!(entry_stem("", ""), "undated");
        assert_eq!(entry_year("not a date"), "undated");
        assert_eq!(entry_month("2026-08-16"), "August");
        assert_eq!(entry_month("nonsense"), "");
    }

    #[test]
    fn one_entry_is_saved_where_and_under_the_name_the_user_chose() {
        let conn = crate::db::init_db_at_connection_for_test();
        let destination = scratch("wattle_test_export_one_entry");
        let wattle_dir = scratch("wattle_test_export_one_entry_src");

        let id = write_entry(
            &conn,
            "A Walk in the Rain",
            "2026-08-16",
            &paragraph("mine"),
        );
        write_entry(&conn, "Not this", "2026-08-17", &paragraph("theirs"));

        assert_eq!(
            entry_stem("2026-08-16", "A Walk in the Rain"),
            "2026-08-16-a-walk-in-the-rain"
        );
        let written =
            export_entry_impl(&conn, &wattle_dir, id, &destination.join("my notes.html")).unwrap();
        let html_path = destination.join("my notes/my notes.html");
        assert_eq!(PathBuf::from(&written), html_path);

        assert_eq!(
            tree(&destination),
            vec![
                "my notes/fonts/Literata-OFL.txt",
                "my notes/fonts/literata-latin-ext-wght-italic.woff2",
                "my notes/fonts/literata-latin-ext-wght-normal.woff2",
                "my notes/fonts/literata-latin-wght-italic.woff2",
                "my notes/fonts/literata-latin-wght-normal.woff2",
                "my notes/my notes.html",
                "my notes/style.css",
            ]
        );

        let again =
            export_entry_impl(&conn, &wattle_dir, id, &destination.join("my notes.html")).unwrap();
        assert_eq!(
            PathBuf::from(&again),
            destination.join("my notes-2/my notes.html")
        );

        let html = std::fs::read_to_string(&html_path).unwrap();
        assert!(html.contains("<h1>A Walk in the Rain</h1>"));
        assert!(html.contains("mine"));
        assert!(!html.contains("theirs"));
        assert!(html.contains("<link href=\"style.css\" rel=\"stylesheet\">"));
        assert!(follow(&html_path, "style.css").exists());
        assert!(follow(&html_path, "fonts/literata-latin-wght-normal.woff2").exists());
        assert!(follow(&html_path, "fonts/Literata-OFL.txt").exists());
        for external in ["data:", "file:///", "<script", "src=\"http", "url(http"] {
            assert!(!html.contains(external), "page refers to {external:?}");
        }

        std::fs::remove_dir_all(&destination).ok();
        std::fs::remove_dir_all(&wattle_dir).ok();
    }

    #[test]
    fn a_single_entry_export_copies_its_images_and_the_relative_paths_resolve() {
        let conn = crate::db::init_db_at_connection_for_test();
        let destination = scratch("wattle_test_export_entry_images");
        let wattle_dir = scratch("wattle_test_export_entry_images_src");

        let id = write_entry_with_image(&conn, &wattle_dir, "With a photo");

        let path = PathBuf::from(
            export_entry_impl(&conn, &wattle_dir, id, &destination.join("photo.html")).unwrap(),
        );
        assert_eq!(path, destination.join("photo/photo.html"));
        let contents = std::fs::read_to_string(&path).unwrap();

        assert!(
            contents.contains("src=\"attachments/1/1.png\""),
            "{contents}"
        );
        assert!(!contents.contains("data:image"));
        assert!(!contents.contains("file:///"));
        assert!(!contents.contains("../../attachments"));

        assert_eq!(
            std::fs::read(follow(&path, "attachments/1/1.png")).unwrap(),
            b"png-bytes"
        );

        assert!(wattle_dir.join("attachments/1/1.png").exists());

        std::fs::remove_dir_all(&destination).ok();
        std::fs::remove_dir_all(&wattle_dir).ok();
    }

    #[test]
    fn entries_sharing_a_date_get_distinct_filenames_by_ascending_id() {
        let conn = crate::db::init_db_at_connection_for_test();
        let destination = scratch("wattle_test_export_duplicates");
        let wattle_dir = scratch("wattle_test_export_duplicates_src");

        write_entry(&conn, "", "2026-08-16", &paragraph("first"));
        write_entry(&conn, "", "2026-08-16", &paragraph("second"));
        write_entry(&conn, "", "2026-08-16", &paragraph("third"));

        let root = PathBuf::from(export_journal_impl(&conn, &wattle_dir, &destination).unwrap());

        assert!(read(&root, "entries/2026/2026-08-16.html").contains("first"));
        assert!(read(&root, "entries/2026/2026-08-16-2.html").contains("second"));
        assert!(read(&root, "entries/2026/2026-08-16-3.html").contains("third"));

        std::fs::remove_dir_all(&destination).ok();
        std::fs::remove_dir_all(&wattle_dir).ok();
    }

    #[test]
    fn a_journal_export_names_its_files_after_titles_and_labels_a_spark() {
        let conn = crate::db::init_db_at_connection_for_test();
        let destination = scratch("wattle_test_export_journal");
        let wattle_dir = scratch("wattle_test_export_journal_src");

        let with_image = write_entry(
            &conn,
            "Un giorno: \"speciale\"",
            "2026-08-16",
            r#"{"type":"doc","content":[
                {"type":"paragraph","content":[{"type":"text","text":"see this"}]},
                {"type":"imageAttachment","attrs":{"attachmentId":1,"path":"attachments/1/1.png"}}]}"#,
        );
        write_entry(&conn, "Older", "2025-01-02", &paragraph("last year"));
        conn.execute(
            "INSERT INTO entries (title, content, entry_date, kind) VALUES ('', ?1, '2026-08-16', 'spark')",
            params![paragraph("a fleeting thought")],
        )
        .unwrap();

        std::fs::create_dir_all(wattle_dir.join("attachments/1")).unwrap();
        std::fs::write(wattle_dir.join("attachments/1/1.png"), b"png-bytes").unwrap();
        conn.execute(
            "INSERT INTO attachments (id, entry_id, filename, mime_type, size, path) \
             VALUES (1, ?1, 'holiday.png', 'image/png', 9, 'attachments/1/1.png')",
            params![with_image],
        )
        .unwrap();

        let root = PathBuf::from(export_journal_impl(&conn, &wattle_dir, &destination).unwrap());

        let exported = read(&root, "entries/2026/2026-08-16-un-giorno-speciale.html");
        assert!(exported.contains("<h1>Un giorno: &quot;speciale&quot;</h1>"));

        assert!(exported.contains("src=\"../../attachments/1/1.png\""));
        let from_entry = root.join("entries/2026").join("../../attachments/1/1.png");
        assert_eq!(std::fs::read(from_entry).unwrap(), b"png-bytes");

        let spark = read(&root, "entries/2026/2026-08-16.html");
        assert!(spark.contains("<span class=\"kind\">Spark</span>"));
        assert!(spark.contains("a fleeting thought"));

        let index = read(&root, "index.html");
        assert!(index.contains("<h2>2025</h2>"));
        assert!(index.contains("<h2>2026</h2>"));
        assert!(index.find("<h2>2025</h2>") < index.find("<h2>2026</h2>"));
        assert!(index.contains("href=\"entries/2025/2025-01-02-older.html\""));
        assert!(index.contains("href=\"entries/2026/2026-08-16-un-giorno-speciale.html\""));

        std::fs::remove_dir_all(&destination).ok();
        std::fs::remove_dir_all(&wattle_dir).ok();
    }

    #[test]
    fn the_html_archive_is_self_contained_and_navigable() {
        let conn = crate::db::init_db_at_connection_for_test();
        let destination = scratch("wattle_test_export_html");
        let wattle_dir = scratch("wattle_test_export_html_src");

        write_entry(&conn, "First", "2025-11-02", &paragraph("oldest"));
        write_entry_with_image(&conn, &wattle_dir, "Second");
        write_entry(&conn, "Third", "2026-08-17", &paragraph("newest"));

        let root = PathBuf::from(export_journal_impl(&conn, &wattle_dir, &destination).unwrap());

        let page_path = root.join("entries/2026/2026-08-16-second.html");
        let page = read(&root, "entries/2026/2026-08-16-second.html");
        assert!(page.contains("src=\"../../attachments/1/1.png\""));
        assert_eq!(
            std::fs::read(follow(&page_path, "../../attachments/1/1.png")).unwrap(),
            b"png-bytes"
        );
        assert!(!page.contains("data:image"));

        let index = read(&root, "index.html");
        assert!(index.contains("<h2>2025</h2>"));
        assert!(index.contains("<h3>November</h3>"));
        assert!(index.contains("<h2>2026</h2>"));
        assert!(index.contains("<h3>August</h3>"));
        assert!(index.find("<h2>2025</h2>") < index.find("<h2>2026</h2>"));
        assert!(index.contains("href=\"entries/2025/2025-11-02-first.html\""));

        let middle = read(&root, "entries/2026/2026-08-16-second.html");
        assert!(middle.contains("href=\"../2025/2025-11-02-first.html\""));
        assert!(middle.contains("href=\"../2026/2026-08-17-third.html\""));
        assert!(middle.contains("href=\"../../index.html\""));

        let oldest = read(&root, "entries/2025/2025-11-02-first.html");
        assert!(!oldest.contains("class=\"previous\""));
        assert!(oldest.contains("class=\"next\""));
        let newest = read(&root, "entries/2026/2026-08-17-third.html");
        assert!(newest.contains("class=\"previous\""));
        assert!(!newest.contains("class=\"next\""));

        let css = read(&root, "style.css");
        assert!(css.contains("fonts/literata-latin-wght-normal.woff2"));
        assert!(root.join("fonts/literata-latin-wght-normal.woff2").exists());
        assert!(root.join("fonts/literata-latin-wght-italic.woff2").exists());
        assert!(read(&root, "fonts/Literata-OFL.txt").contains("SIL Open Font License"));

        for page in [
            "index.html",
            "entries/2026/2026-08-16-second.html",
            "style.css",
        ] {
            let text = read(&root, page);
            for external in ["http://", "https://", "//fonts.", "<script"] {
                assert!(
                    !text.contains(external),
                    "{page} refers to {external:?}, which needs a network"
                );
            }
        }

        std::fs::remove_dir_all(&destination).ok();
        std::fs::remove_dir_all(&wattle_dir).ok();
    }

    #[test]
    fn exporting_a_journal_twice_in_a_day_never_writes_over_the_first() {
        let conn = crate::db::init_db_at_connection_for_test();
        let destination = scratch("wattle_test_export_twice");
        let wattle_dir = scratch("wattle_test_export_twice_src");
        write_entry(&conn, "Only", "2026-08-16", &paragraph("body"));

        let first = PathBuf::from(export_journal_impl(&conn, &wattle_dir, &destination).unwrap());
        let second = PathBuf::from(export_journal_impl(&conn, &wattle_dir, &destination).unwrap());
        assert_ne!(first, second);
        assert!(first.exists() && second.exists());

        std::fs::remove_dir_all(&destination).ok();
        std::fs::remove_dir_all(&wattle_dir).ok();
    }

    #[test]
    fn content_wattle_cannot_read_still_leaves_with_the_export() {
        let conn = crate::db::init_db_at_connection_for_test();
        let destination = scratch("wattle_test_export_unreadable");
        let wattle_dir = scratch("wattle_test_export_unreadable_src");

        let id = write_entry(&conn, "Broken", "2026-08-16", "not json <at> all");

        let html = PathBuf::from(
            export_entry_impl(&conn, &wattle_dir, id, &destination.join("broken.html")).unwrap(),
        );
        assert!(std::fs::read_to_string(&html)
            .unwrap()
            .contains("not json &lt;at&gt; all"));

        std::fs::remove_dir_all(&destination).ok();
        std::fs::remove_dir_all(&wattle_dir).ok();
    }

    #[test]
    fn an_empty_journal_says_so_rather_than_writing_an_empty_folder() {
        let conn = crate::db::init_db_at_connection_for_test();
        let destination = scratch("wattle_test_export_empty");
        let wattle_dir = scratch("wattle_test_export_empty_src");

        assert!(export_journal_impl(&conn, &wattle_dir, &destination).is_err());
        assert_eq!(std::fs::read_dir(&destination).unwrap().count(), 0);
        assert!(
            export_entry_impl(&conn, &wattle_dir, 404, &destination.join("nope.html")).is_err()
        );
        assert!(!destination.join("nope").exists());

        std::fs::remove_dir_all(&destination).ok();
        std::fs::remove_dir_all(&wattle_dir).ok();
    }

    #[test]
    fn an_export_never_copies_a_file_from_outside_the_journal() {
        let conn = crate::db::init_db_at_connection_for_test();
        let wattle_dir = scratch("wattle_export_hostile_source");
        let destination = scratch("wattle_export_hostile_destination");
        let victim_dir = scratch("wattle_export_hostile_victim");
        let victim = victim_dir.join("victim.txt");
        std::fs::write(&victim, b"not wattle's").unwrap();

        let entry = write_entry(&conn, "Hostile", "2026-08-16", &paragraph("plain"));
        for stored in [
            victim.to_string_lossy().to_string(),
            "attachments/../../wattle_export_hostile_victim/victim.txt".to_string(),
        ] {
            conn.execute(
                "INSERT INTO attachments (entry_id, filename, mime_type, size, path) \
                 VALUES (?1, 'victim.txt', 'text/plain', 12, ?2)",
                params![entry, stored],
            )
            .unwrap();
        }

        let root = PathBuf::from(export_journal_impl(&conn, &wattle_dir, &destination).unwrap());

        assert!(
            !tree(&root).iter().any(|path| path.ends_with("victim.txt")),
            "the victim must not be copied into the export"
        );
        assert_eq!(std::fs::read(&victim).unwrap(), b"not wattle's");

        std::fs::remove_dir_all(&destination).ok();
        std::fs::remove_dir_all(&wattle_dir).ok();
        std::fs::remove_dir_all(&victim_dir).ok();
    }

    #[test]
    fn an_exported_page_never_links_to_a_path_outside_the_journal() {
        let conn = crate::db::init_db_at_connection_for_test();
        let wattle_dir = scratch("wattle_export_hostile_links_source");
        let destination = scratch("wattle_export_hostile_links_destination");
        let entry = write_entry(
            &conn,
            "Links",
            "2026-08-16",
            r#"{"type":"doc","content":[
                {"type":"imageAttachment","attrs":{"attachmentId":1}},
                {"type":"fileAttachment","attrs":{"attachmentId":2}},
                {"type":"videoAttachment","attrs":{"attachmentId":3}},
                {"type":"imageAttachment","attrs":{"attachmentId":4}}]}"#,
        );
        for (id, stored) in [
            (1, "C:\\Windows\\win.ini"),
            (2, "attachments/../../outside/secret.txt"),
            (3, "attachments/1/clip.mp4:hidden"),
            (4, "attachments/1/4.png"),
        ] {
            conn.execute(
                "INSERT INTO attachments (id, entry_id, filename, mime_type, size, path) \
                 VALUES (?1, ?2, 'file', 'image/png', 3, ?3)",
                params![id, entry, stored],
            )
            .unwrap();
        }
        std::fs::create_dir_all(wattle_dir.join("attachments/1")).unwrap();
        std::fs::write(wattle_dir.join("attachments/1/4.png"), b"png").unwrap();

        let page = PathBuf::from(
            export_entry_impl(&conn, &wattle_dir, entry, &destination.join("links.html")).unwrap(),
        );
        let root = PathBuf::from(export_journal_impl(&conn, &wattle_dir, &destination).unwrap());

        for html in [
            std::fs::read_to_string(&page).unwrap(),
            read(&root, "entries/2026/2026-08-16-links.html"),
        ] {
            for hostile in ["win.ini", "secret.txt", ":hidden", "C:\\"] {
                assert!(!html.contains(hostile), "{hostile} leaked into {html}");
            }
            assert!(html.contains("attachments/1/4.png"));
        }

        std::fs::remove_dir_all(&destination).ok();
        std::fs::remove_dir_all(&wattle_dir).ok();
    }

    #[cfg(windows)]
    #[test]
    fn an_unreadable_attachment_fails_the_export_rather_than_vanishing() {
        let conn = crate::db::init_db_at_connection_for_test();
        let wattle_dir = scratch("wattle_export_unreadable_source");
        let destination = scratch("wattle_export_unreadable_destination");
        let entry = write_entry(&conn, "Unreadable", "2026-08-16", &paragraph("plain"));
        conn.execute(
            "INSERT INTO attachments (entry_id, filename, mime_type, size, path) \
             VALUES (?1, '1.png', 'image/png', 3, 'attachments/1/1.png')",
            params![entry],
        )
        .unwrap();
        std::fs::create_dir_all(wattle_dir.join("attachments/1")).unwrap();
        std::fs::write(wattle_dir.join("attachments/1/1.png"), b"png").unwrap();

        {
            let _denied = crate::paths::test_support::Denied::on(&wattle_dir.join("attachments/1"));
            assert!(export_journal_impl(&conn, &wattle_dir, &destination).is_err());
        }
        export_journal_impl(&conn, &wattle_dir, &destination).unwrap();

        std::fs::remove_dir_all(&destination).ok();
        std::fs::remove_dir_all(&wattle_dir).ok();
    }
}
