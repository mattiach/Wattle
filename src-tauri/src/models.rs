use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntrySummaryDto {
    pub id: i64,
    pub title: String,
    /// Excerpt derived on write, so the list never parses a document to render
    /// a row - and the full content of a page of entries stays off the wire.
    pub preview: String,
    pub word_count: i64,
    /// "entry" or "spark" - the same content, written on a different surface.
    pub kind: String,
    pub entry_date: String,
    pub created_at: String,
    pub updated_at: String,
    /// Why this entry matched, with the matching runs marked.
    pub snippet: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryDto {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub preview: String,
    pub word_count: i64,
    pub kind: String,
    pub entry_date: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentDto {
    pub id: i64,
    pub entry_id: i64,
    pub filename: String,
    pub mime_type: String,
    pub size: i64,
    pub path: String,
    pub created_at: String,
}

/// A page waiting in the trash.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashedEntryDto {
    pub id: i64,
    pub title: String,
    pub preview: String,
    pub word_count: i64,
    pub kind: String,
    pub entry_date: String,
    pub deleted_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDto {
    pub language: String,
    pub theme: String,
    pub version: String,
    pub zoom_level: f64,
    /// Where the primary navigation is shown: "bottom", "header" or "both".
    pub navigation: String,
    /// Whether entries from previous years may resurface on the home screen.
    pub on_this_day: bool,
    /// Whether Wattle may talk to a local Ollama at all.
    pub ai_enabled: bool,
    /// The chosen model from the curated catalog, or empty for none yet.
    pub ai_model: String,
    /// Whether an older spark may come back on its own.
    pub spark_echo: bool,
    /// Whether an entry that already holds writing opens read-only.
    pub entry_lock: bool,
    /// How wide the reading and scanning columns are: "compact", "default" or
    /// "wide".
    pub layout_width: String,
    /// Which palette the interface wears: an accent, or a whole theme.
    pub palette: String,
    /// Whether this profile has been through onboarding.
    pub onboarded: bool,
    /// Where backups are written without asking.
    pub backup_dir: String,
    /// How large the writing is set on the editing surface: "small", "default",
    /// "large" or "largest".
    pub editor_scale: String,
    /// The ids of the guided tours already seen.
    pub tours_seen: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDto {
    pub name: String,
    pub created_at: String,
}
