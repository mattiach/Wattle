mod commands;
mod content;
mod crypto;
mod db;
mod models;
mod ollama;
mod ollama_runtime;
mod paths;
mod state;

use std::sync::Mutex;

use tauri::Manager;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let wattle_dir = match paths::resolve_wattle_dir(app.handle()) {
                Ok(dir) => dir,
                Err(message) => {
                    paths::report_missing_journal(app.handle(), &message);
                    return Err(message.into());
                }
            };
            if let Err(message) = commands::backup::recover_interrupted_restore(&wattle_dir) {
                paths::report_missing_journal(app.handle(), &message);
                return Err(message.into());
            }
            app.asset_protocol_scope()
                .allow_directory(wattle_dir.join("attachments"), true)?;
            let db = db::init_db(&wattle_dir)?;
            let _ = commands::trash::purge_expired(&db, &wattle_dir);
            app.manage(AppState {
                db: Mutex::new(db),
                wattle_dir: std::sync::RwLock::new(wattle_dir),
                pull_cancelled: std::sync::atomic::AtomicBool::new(false),
                pulling_model: Mutex::new(None),
                install_child: std::sync::Arc::new(Mutex::new(None)),
                rewrite_cancelled: std::sync::atomic::AtomicBool::new(false),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::entries::create_entry,
            commands::entries::update_entry,
            commands::entries::get_entry,
            commands::entries::list_entries,
            commands::entries::count_entries,
            commands::entries::delete_entry,
            commands::trash::list_trash,
            commands::trash::restore_entry,
            commands::trash::purge_entry,
            commands::trash::empty_trash,
            commands::trash::trash_retention_days,
            commands::calendar::entry_dates_in_range,
            commands::calendar::adjacent_entries,
            commands::calendar::on_this_day,
            commands::calendar::spark_echo,
            commands::settings::load_settings,
            commands::settings::save_settings,
            commands::profile::load_profile,
            commands::profile::save_profile,
            commands::profile::reset_profile,
            commands::attachments::add_attachment,
            commands::attachments::list_attachments,
            commands::attachments::delete_attachment,
            commands::attachments::save_attachment_as,
            commands::attachments::reconcile_entry_attachments,
            commands::backup::create_backup,
            commands::backup::restore_backup,
            commands::ai::ai_status,
            commands::ai::ai_start_ollama,
            commands::ai::ai_install_ollama,
            commands::ai::ai_cancel_install,
            commands::ai::ai_rewrite,
            commands::ai::ai_cancel_rewrite,
            commands::ai::ai_writing_nudge,
            commands::ai::ai_letter_prompt,
            commands::ai::ai_pull_model,
            commands::ai::ai_cancel_pull,
            commands::ai::ai_delete_model,
            commands::memories::index_entry,
            commands::memories::memory_anchor,
            commands::memories::related_memories,
            commands::letters::create_letter,
            commands::letters::save_letter_draft,
            commands::letters::delete_letter,
            commands::letters::seal_letter,
            commands::letters::list_letters,
            commands::letters::letter_status,
            commands::letters::open_letter,
            commands::letters::add_letter_attachment,
            commands::letters::list_letter_attachments,
            commands::letters::delete_letter_attachment,
            commands::letters::save_letter_attachment_as,
            commands::letters::reconcile_letter_attachments,
            commands::export::entry_export_filename,
            commands::export::export_entry_html,
            commands::export::letter_export_filename,
            commands::export::export_letter_html,
            commands::export::export_journal_html,
            paths::get_wattle_dir,
            paths::move_journal_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
