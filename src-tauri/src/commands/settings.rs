use rusqlite::{params, OptionalExtension};
use tauri::State;

use crate::models::SettingsDto;
use crate::state::AppState;

const SELECT: &str = "SELECT language, theme, version, zoom_level, navigation, on_this_day,      ai_enabled, ai_model, spark_echo, entry_lock, layout_width, palette, onboarded, backup_dir, editor_scale, tours_seen FROM settings WHERE id = 1";

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<SettingsDto> {
    Ok(SettingsDto {
        language: row.get(0)?,
        theme: row.get(1)?,
        version: row.get(2)?,
        zoom_level: row.get(3)?,
        navigation: row.get(4)?,
        on_this_day: row.get(5)?,
        ai_enabled: row.get(6)?,
        ai_model: row.get(7)?,
        spark_echo: row.get(8)?,
        entry_lock: row.get(9)?,
        layout_width: row.get(10)?,
        palette: row.get(11)?,
        onboarded: row.get(12)?,
        backup_dir: row.get(13)?,
        editor_scale: row.get(14)?,
        tours_seen: serde_json::from_str(&row.get::<_, String>(15)?).unwrap_or_default(),
    })
}

fn load_settings_impl(conn: &rusqlite::Connection) -> Result<SettingsDto, String> {
    let existing = conn
        .query_row(SELECT, [], map_row)
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some(settings) = existing {
        return Ok(settings);
    }

    conn.execute("INSERT INTO settings (id) VALUES (1)", [])
        .map_err(|e| e.to_string())?;
    conn.query_row(SELECT, [], map_row)
        .map_err(|e| e.to_string())
}

fn save_settings_impl(conn: &rusqlite::Connection, settings: SettingsDto) -> Result<(), String> {
    let tours_seen =
        serde_json::to_string(&settings.tours_seen).unwrap_or_else(|_| "[]".to_string());

    conn.execute(
        "INSERT INTO settings (id, language, theme, version, zoom_level, navigation, on_this_day, ai_enabled, ai_model, spark_echo, entry_lock, layout_width, palette, onboarded, backup_dir, editor_scale, tours_seen) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
         ON CONFLICT(id) DO UPDATE SET language = excluded.language, theme = excluded.theme, version = excluded.version, zoom_level = excluded.zoom_level, navigation = excluded.navigation, on_this_day = excluded.on_this_day, ai_enabled = excluded.ai_enabled, ai_model = excluded.ai_model, spark_echo = excluded.spark_echo, entry_lock = excluded.entry_lock, layout_width = excluded.layout_width, palette = excluded.palette, onboarded = excluded.onboarded, backup_dir = excluded.backup_dir, editor_scale = excluded.editor_scale, tours_seen = excluded.tours_seen",
        params![settings.language, settings.theme, settings.version, settings.zoom_level, settings.navigation, settings.on_this_day, settings.ai_enabled, settings.ai_model, settings.spark_echo, settings.entry_lock, settings.layout_width, settings.palette, settings.onboarded, settings.backup_dir, settings.editor_scale, tours_seen],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn load_settings(state: State<AppState>) -> Result<SettingsDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    load_settings_impl(&conn)
}

#[tauri::command]
pub fn save_settings(state: State<AppState>, settings: SettingsDto) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    save_settings_impl(&conn, settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_creates_default_row_then_persists_saved_values() {
        let conn = crate::db::init_db_at_connection_for_test();

        let defaults = load_settings_impl(&conn).unwrap();
        assert_eq!(defaults.language, "en");
        assert_eq!(defaults.theme, "light");
        assert_eq!(defaults.zoom_level, 1.0);
        assert_eq!(defaults.navigation, "both");
        assert!(defaults.on_this_day);
        assert!(!defaults.ai_enabled);
        assert_eq!(defaults.ai_model, "");
        assert!(defaults.spark_echo);
        assert!(defaults.entry_lock);
        assert_eq!(defaults.layout_width, "default");
        assert_eq!(defaults.palette, "wattle");
        assert!(!defaults.onboarded);
        assert_eq!(defaults.backup_dir, "");
        assert_eq!(defaults.editor_scale, "default");
        assert!(defaults.tours_seen.is_empty());

        save_settings_impl(
            &conn,
            SettingsDto {
                language: "it".to_string(),
                theme: "dark".to_string(),
                version: "1.0.0".to_string(),
                zoom_level: 1.25,
                navigation: "bottom".to_string(),
                on_this_day: false,
                ai_enabled: true,
                ai_model: "qwen3.5:4b".to_string(),
                spark_echo: false,
                entry_lock: false,
                layout_width: "wide".to_string(),
                palette: "moss".to_string(),
                onboarded: true,
                backup_dir: "D:/backups".to_string(),
                editor_scale: "large".to_string(),
                tours_seen: vec!["/app".to_string(), "/app/calendar".to_string()],
            },
        )
        .unwrap();

        let reloaded = load_settings_impl(&conn).unwrap();
        assert_eq!(reloaded.language, "it");
        assert_eq!(reloaded.theme, "dark");
        assert_eq!(reloaded.zoom_level, 1.25);
        assert_eq!(reloaded.navigation, "bottom");
        assert!(!reloaded.on_this_day);
        assert!(reloaded.ai_enabled);
        assert_eq!(reloaded.ai_model, "qwen3.5:4b");
        assert!(!reloaded.spark_echo);
        assert!(!reloaded.entry_lock);
        assert_eq!(reloaded.layout_width, "wide");
        assert_eq!(reloaded.palette, "moss");
        assert!(reloaded.onboarded);
        assert_eq!(reloaded.backup_dir, "D:/backups");
        assert_eq!(reloaded.editor_scale, "large");
        assert_eq!(reloaded.tours_seen, vec!["/app", "/app/calendar"]);
    }

    #[test]
    fn an_unreadable_tour_list_comes_back_empty_rather_than_failing() {
        let conn = crate::db::init_db_at_connection_for_test();
        conn.execute(
            "INSERT INTO settings (id, tours_seen) VALUES (1, 'not json')",
            [],
        )
        .unwrap();

        assert!(load_settings_impl(&conn).unwrap().tours_seen.is_empty());
    }

    #[test]
    fn a_journal_written_before_the_echo_existed_comes_back_with_it_on() {
        let conn = crate::db::init_db_at_connection_for_test();
        conn.execute("INSERT INTO settings (id, language) VALUES (1, 'it')", [])
            .unwrap();

        assert!(load_settings_impl(&conn).unwrap().spark_echo);
    }

    #[test]
    fn a_journal_written_before_the_lock_existed_comes_back_locked() {
        let conn = crate::db::init_db_at_connection_for_test();
        conn.execute("INSERT INTO settings (id, language) VALUES (1, 'it')", [])
            .unwrap();

        let settings = load_settings_impl(&conn).unwrap();
        assert!(settings.entry_lock);
        assert_eq!(settings.layout_width, "default");
        assert_eq!(settings.palette, "wattle");
        assert_eq!(settings.editor_scale, "default");
    }

    #[test]
    fn a_journal_written_before_ai_existed_comes_back_with_it_off() {
        let conn = crate::db::init_db_at_connection_for_test();
        conn.execute("INSERT INTO settings (id, language) VALUES (1, 'it')", [])
            .unwrap();

        let settings = load_settings_impl(&conn).unwrap();
        assert_eq!(settings.language, "it");
        assert!(!settings.ai_enabled);
        assert_eq!(settings.ai_model, "");
    }
}
