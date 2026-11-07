//! The commands the AI panel calls.

use std::sync::atomic::Ordering;

use rusqlite::Connection;
use tauri::{AppHandle, Emitter, State};

use crate::ollama::{self, AiStatusDto, PullProgress};
use crate::ollama_runtime::{self, resolve_state, RuntimeState};
use crate::state::AppState;

/// The event a running download reports on.
const PULL_EVENT: &str = "ai://pull-progress";

/// The event the Ollama installer reports on.
const INSTALL_EVENT: &str = "ai://install-progress";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallProgress {
    /// Whatever the installer just said, verbatim.
    status: String,
    /// The last frame of a run, whether it succeeded, failed or was cancelled.
    done: bool,
}

fn ai_enabled(conn: &Connection) -> Result<bool, String> {
    conn.query_row("SELECT ai_enabled FROM settings WHERE id = 1", [], |row| {
        row.get(0)
    })
    .or_else(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => Ok(false),
        other => Err(other.to_string()),
    })
}

/// Reads what the machine actually has.
async fn status_impl(
    enabled: bool,
    installed: bool,
    total_ram: Option<u64>,
    base: &str,
) -> AiStatusDto {
    if !enabled {
        return AiStatusDto::without_daemon(RuntimeState::Disabled, None);
    }

    let Some(version) = ollama::version_at(base).await else {
        return AiStatusDto::without_daemon(resolve_state(true, installed, false), total_ram);
    };

    let (catalog, unmanaged) =
        ollama::join_catalog(&ollama::installed_tags_at(base).await, total_ram);
    AiStatusDto {
        state: RuntimeState::Running,
        version: Some(version),
        catalog,
        pulling: None,
        installing: false,
        unmanaged,
    }
}

/// Forgets the active model when it is the one that just went away.
fn clear_active_model_if(conn: &Connection, removed_id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE settings SET ai_model = '' WHERE id = 1 AND ai_model = ?1",
        rusqlite::params![removed_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// The check every command in this file starts with.
fn require_enabled(conn: &Connection) -> Result<(), String> {
    if ai_enabled(conn)? {
        Ok(())
    } else {
        Err(ollama::AiError::DISABLED.to_string())
    }
}

/// The tag to hand Ollama for a model that has already passed
/// `find_chat_model`.
pub(crate) async fn tag_to_generate_with(base: &str, model: &str) -> Result<String, String> {
    ollama::generation_tag_at(base, model)
        .await
        .ok_or_else(|| ollama::AiError::MODEL_GONE.to_string())
}

/// The two things every model command checks before it does anything: that AI
/// is on, and that the id is one Wattle ships.
fn check_request(state: &State<AppState>, id: &str) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    require_enabled(&conn)?;
    if ollama::find_model(id).is_none() {
        return Err(format!("unknown model: {id}"));
    }
    Ok(())
}

#[tauri::command]
pub async fn ai_status(state: State<'_, AppState>) -> Result<AiStatusDto, String> {
    let enabled = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        ai_enabled(&conn)?
    };
    let installed = enabled && ollama_runtime::is_installed();
    let total_ram = if enabled {
        ollama::total_memory()
    } else {
        None
    };
    let mut status = status_impl(enabled, installed, total_ram, &ollama::base_url()).await;

    status.pulling = state
        .pulling_model
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    status.installing = state
        .install_child
        .lock()
        .map_err(|e| e.to_string())?
        .is_some();

    if status.state == RuntimeState::Running {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        forget_uninstalled_model(&conn, &status)?;
    }
    Ok(status)
}

/// Clears `ai_model` when the model it names is no longer installed.
fn forget_uninstalled_model(conn: &Connection, status: &AiStatusDto) -> Result<(), String> {
    let still_there: Vec<&str> = status
        .catalog
        .iter()
        .filter(|row| row.installed)
        .map(|row| row.id.as_str())
        .collect();
    conn.execute(
        "UPDATE settings SET ai_model = '' \
         WHERE id = 1 AND ai_model <> '' AND ai_model NOT IN (SELECT value FROM json_each(?1))",
        rusqlite::params![serde_json::to_string(&still_there).map_err(|e| e.to_string())?],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Starts an Ollama that is installed but idle, and waits for it to answer.
#[tauri::command]
pub async fn ai_start_ollama(state: State<'_, AppState>) -> Result<bool, String> {
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        require_enabled(&conn)?;
    }

    let base = ollama::base_url();
    if ollama::version_at(&base).await.is_some() {
        return Ok(true);
    }

    let Some(executable) = ollama_runtime::find_executable() else {
        return Err("Ollama is not installed".to_string());
    };
    ollama_runtime::start_server(&executable)?;
    Ok(ollama_runtime::wait_until_answering(&base).await)
}

/// Installs Ollama with its own official script.
#[tauri::command]
pub async fn ai_install_ollama(app: AppHandle, state: State<'_, AppState>) -> Result<bool, String> {
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        require_enabled(&conn)?;
    }
    if ollama_runtime::is_installed() {
        return Ok(true);
    }

    let (child, stdout) = ollama_runtime::spawn_installer()?;
    {
        let mut running = state.install_child.lock().map_err(|e| e.to_string())?;
        *running = Some(child);
    }

    let handle = state.install_child.clone();
    let emitter = app.clone();
    let finished = tauri::async_runtime::spawn_blocking(move || {
        use std::io::{BufRead, BufReader};

        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            let status = line.trim().to_string();
            if !status.is_empty() {
                let _ = emitter.emit(
                    INSTALL_EVENT,
                    InstallProgress {
                        status,
                        done: false,
                    },
                );
            }
        }

        let taken = handle.lock().ok().and_then(|mut slot| slot.take());
        match taken {
            Some(mut child) => child.wait().map(|status| status.success()).unwrap_or(false),
            None => false,
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    let _ = app.emit(
        INSTALL_EVENT,
        InstallProgress {
            status: String::new(),
            done: true,
        },
    );

    if !finished {
        return Ok(false);
    }

    Ok(ollama_runtime::is_installed())
}

/// The things Wattle will ask a model to do, and what it asks.
const ACTIONS: [(&str, &str); 4] = [
    (
        "fixGrammar",
        "Correct the spelling, grammar and punctuation of the passage below. \
         Keep its meaning and the author's voice unchanged.",
    ),
    (
        "makeShorter",
        "Rewrite the passage below more concisely. Keep every fact and its full \
         meaning; remove only words, never substance.",
    ),
    (
        "improveClarity",
        "Rewrite the passage below to read more clearly. Keep its meaning and \
         its facts unchanged; do not add anything that is not already there.",
    ),
    (
        "suggestTitle",
        "Write a short title, at most six words, for the journal entry below. \
         Name what is already there; add nothing that is not in the text, and \
         do not end it with a full stop.",
    ),
];

/// The languages Wattle's interface is written in, and their English names -
/// which is how a model is told what to answer in.
pub(super) const LANGUAGES: [(&str, &str); 16] = [
    ("cs", "Czech"),
    ("de", "German"),
    ("el", "Greek"),
    ("en", "English"),
    ("es", "Spanish"),
    ("fi", "Finnish"),
    ("fr", "French"),
    ("hu", "Hungarian"),
    ("it", "Italian"),
    ("nl", "Dutch"),
    ("pl", "Polish"),
    ("pt", "Portuguese"),
    ("ru", "Russian"),
    ("sv", "Swedish"),
    ("tr", "Turkish"),
    ("uk", "Ukrainian"),
];

/// The language a suggestion comes back in.
pub(super) fn language_name(code: &str) -> &'static str {
    LANGUAGES
        .iter()
        .find(|(key, _)| *key == code)
        .map_or("English", |(_, name)| *name)
}

/// The single field a rewrite is allowed to come back in.
fn rewrite_field(language: &str) -> String {
    format!(
        "rewritten_in_{}",
        language_name(language).to_ascii_lowercase()
    )
}

/// A selection long enough to be a paragraph and no longer.
const MAX_REWRITE_CHARS: usize = 4000;

/// The whole prompt, or nothing when the action or the text will not do.
fn build_prompt(action: &str, language: &str, text: &str) -> Option<String> {
    let (_, instruction) = ACTIONS.iter().find(|(key, _)| *key == action)?;
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_REWRITE_CHARS {
        return None;
    }
    let name = language_name(language);
    let field = rewrite_field(language);

    Some(format!(
        "Task: {instruction}\n\
         Output language: {name}. Write the result in {name} regardless of the \
         language the passage is written in.\n\
         Put only the rewritten passage in the \"{field}\" field. Do not \
         describe or justify your changes.\n\n\
         Passage:\n{trimmed}"
    ))
}

/// The longest a theme may be.
const MAX_NUDGE_THEME_CHARS: usize = 200;

/// The single field a nudge is allowed to come back in.
fn nudge_field(language: &str) -> String {
    format!(
        "invitation_in_{}",
        language_name(language).to_ascii_lowercase()
    )
}

/// The whole prompt, or nothing when the theme will not do.
fn build_nudge_prompt(theme: &str, language: &str) -> Option<String> {
    let trimmed = theme.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_NUDGE_THEME_CHARS {
        return None;
    }
    let name = language_name(language);
    let field = nudge_field(language);

    Some(format!(
        "Task: Write one short invitation, addressed to the person who keeps \
         this journal, asking them to write about {trimmed}.\n\
         Rules: One complete, grammatical sentence, correctly punctuated \
         and finished - at most twenty words. Warm and plain - never \
         coaching, never therapeutic. Ask; never assume they did or felt \
         anything. Do not greet them and do not sign off.\n\
         Output language: {name}. Write it in {name}, phrased as a native \
         speaker of {name} would say it. The subject above is written in \
         English only to tell you what to ask about: express it naturally \
         in {name} rather than translating it word for word, and leave no \
         English in the answer.\n\
         Put only the invitation in the \"{field}\" field. Do not explain it."
    ))
}

/// Writes an invitation to write, on a theme the home screen picked.
#[tauri::command]
pub async fn ai_writing_nudge(
    state: State<'_, AppState>,
    theme: String,
    language: String,
) -> Result<String, String> {
    let model = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        require_enabled(&conn)?;
        conn.query_row("SELECT ai_model FROM settings WHERE id = 1", [], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|e| e.to_string())?
    };
    if ollama::find_chat_model(&model).is_none() {
        return Err(ollama::AiError::NO_MODEL.to_string());
    }
    let Some(prompt) = build_nudge_prompt(&theme, &language) else {
        return Err(ollama::AiError::BAD_SELECTION.to_string());
    };

    let base = ollama::base_url();
    let model = tag_to_generate_with(&base, &model).await?;
    let field = nudge_field(&language);
    ollama::nudge_at(&base, &model, &prompt, &field).await
}

/// The single field a letter's question is allowed to come back in.
fn letter_prompt_field(language: &str) -> String {
    format!(
        "question_in_{}",
        language_name(language).to_ascii_lowercase()
    )
}

/// The whole prompt for a letter's writing direction, or nothing.
fn build_letter_prompt(theme: &str, language: &str) -> Option<String> {
    let trimmed = theme.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_NUDGE_THEME_CHARS {
        return None;
    }
    let name = language_name(language);
    let field = letter_prompt_field(language);

    Some(format!(
        "Task: Write one short question, addressed to the person who keeps this \
         journal, to help them write a letter to themselves that they will read \
         years from now. The question is about {trimmed}.\n\
         Rules: One complete, grammatical sentence, correctly punctuated and \
         finished - at most twenty-five words. Plain and unhurried - \
         never coaching, never therapeutic, never sentimental. Ask; never assume \
         anything about their life, and never predict what their future will \
         hold. Do not greet them and do not sign off. Do not write any part of \
         the letter itself.\n\
         Output language: {name}. Write it in {name}, phrased as a native \
         speaker of {name} would say it. The subject above is written in \
         English only to tell you what to ask about: express it naturally \
         in {name} rather than translating it word for word, and leave no \
         English in the answer.\n\
         Put only the question in the \"{field}\" field. Do not explain it."
    ))
}

/// Asks for one question to start a letter from.
#[tauri::command]
pub async fn ai_letter_prompt(
    state: State<'_, AppState>,
    theme: String,
    language: String,
) -> Result<String, String> {
    let model = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        require_enabled(&conn)?;
        conn.query_row("SELECT ai_model FROM settings WHERE id = 1", [], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|e| e.to_string())?
    };
    if ollama::find_chat_model(&model).is_none() {
        return Err(ollama::AiError::NO_MODEL.to_string());
    }
    let Some(prompt) = build_letter_prompt(&theme, &language) else {
        return Err(ollama::AiError::BAD_SELECTION.to_string());
    };

    let base = ollama::base_url();
    let model = tag_to_generate_with(&base, &model).await?;
    let field = letter_prompt_field(&language);
    ollama::nudge_at(&base, &model, &prompt, &field).await
}

/// Rewrites a passage the writer selected, and returns the suggestion.
#[tauri::command]
pub async fn ai_rewrite(
    state: State<'_, AppState>,
    action: String,
    text: String,
    language: String,
) -> Result<String, String> {
    let model = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        require_enabled(&conn)?;
        conn.query_row("SELECT ai_model FROM settings WHERE id = 1", [], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|e| e.to_string())?
    };
    if ollama::find_chat_model(&model).is_none() {
        return Err(ollama::AiError::NO_MODEL.to_string());
    }
    let Some(prompt) = build_prompt(&action, &language, &text) else {
        return Err(ollama::AiError::BAD_SELECTION.to_string());
    };

    state.rewrite_cancelled.store(false, Ordering::SeqCst);
    let base = ollama::base_url();
    let model = tag_to_generate_with(&base, &model).await?;
    let field = rewrite_field(&language);

    tokio::select! {
        result = ollama::rewrite_at(&base, &model, &prompt, &field) => result,
        () = wait_for_cancel(&state.rewrite_cancelled) => {
            Err(ollama::AiError::CANCELLED.to_string())
        }
    }
}

/// Resolves once the flag is raised.
async fn wait_for_cancel(flag: &std::sync::atomic::AtomicBool) {
    while !flag.load(Ordering::SeqCst) {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}

#[tauri::command]
pub fn ai_cancel_rewrite(state: State<AppState>) {
    state.rewrite_cancelled.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn ai_cancel_install(state: State<AppState>) -> Result<(), String> {
    let mut running = state.install_child.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = running.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

/// Downloads a catalog model, reporting progress as it goes.
#[tauri::command]
pub async fn ai_pull_model(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    check_request(&state, &id)?;
    state.pull_cancelled.store(false, Ordering::SeqCst);
    {
        let mut pulling = state.pulling_model.lock().map_err(|e| e.to_string())?;
        *pulling = Some(id.clone());
    }

    let outcome = stream_pull(&app, &state, &id).await;

    if let Ok(mut pulling) = state.pulling_model.lock() {
        *pulling = None;
    }
    let _ = app.emit(
        PULL_EVENT,
        &PullProgress {
            status: "done".to_string(),
            ..PullProgress::default()
        },
    );
    outcome
}

/// The download itself, so `ai_pull_model` has one exit to clean up after.
async fn stream_pull(app: &AppHandle, state: &State<'_, AppState>, id: &str) -> Result<(), String> {
    let mut response = ollama::start_pull(&ollama::base_url(), id).await?;
    if !response.status().is_success() {
        return Err(response
            .text()
            .await
            .unwrap_or_else(|_| "the download could not be started".to_string()));
    }

    let mut pending = String::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if state.pull_cancelled.load(Ordering::SeqCst) {
            drop(response);
            return Ok(());
        }

        pending.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(newline) = pending.find('\n') {
            let line: String = pending.drain(..=newline).collect();
            let Some(progress) = ollama::parse_pull_line(&line) else {
                continue;
            };
            if let Some(error) = progress.error {
                return Err(error);
            }
            let _ = app.emit(PULL_EVENT, &progress);
        }
    }

    Ok(())
}

#[tauri::command]
pub fn ai_cancel_pull(state: State<AppState>) {
    state.pull_cancelled.store(true, Ordering::SeqCst);
}

/// Removes a model from Ollama's storage.
#[tauri::command]
pub async fn ai_delete_model(state: State<'_, AppState>, id: String) -> Result<(), String> {
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        require_enabled(&conn)?;
    }
    let base = ollama::base_url();
    let installed = ollama::installed_tags_at(&base).await;
    if ollama::find_model(&id).is_none() && !installed.contains(&id) {
        return Err(format!("unknown model: {id}"));
    }
    let target = ollama::tag_to_delete(&id, &installed);
    ollama::delete_model_at(&base, target).await?;

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    clear_active_model_if(&conn, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    const UNREACHABLE: &str = "http://127.0.0.1:1";

    const EIGHT_GB: u64 = 8 * 1024 * 1024 * 1024;

    #[test]
    fn a_disabled_wattle_answers_without_reaching_for_the_network() {
        let started = Instant::now();
        let status =
            tauri::async_runtime::block_on(status_impl(false, true, Some(EIGHT_GB), UNREACHABLE));

        assert_eq!(status.state, RuntimeState::Disabled);
        assert!(status.version.is_none());
        assert!(status.unmanaged.is_empty());
        assert_eq!(status.catalog.len(), 5);
        assert!(status.catalog.iter().all(|row| !row.installed));
        assert!(status.catalog.iter().all(|row| row.fits.is_none()));
        assert!(
            started.elapsed() < Duration::from_millis(250),
            "a disabled status took {:?}, which is long enough to have asked",
            started.elapsed()
        );
    }

    #[test]
    fn missing_and_idle_are_told_apart() {
        let started = Instant::now();

        let missing =
            tauri::async_runtime::block_on(status_impl(true, false, Some(EIGHT_GB), UNREACHABLE));
        assert_eq!(missing.state, RuntimeState::NotInstalled);
        assert!(missing.version.is_none());

        let idle =
            tauri::async_runtime::block_on(status_impl(true, true, Some(EIGHT_GB), UNREACHABLE));
        assert_eq!(idle.state, RuntimeState::Installed);
        assert!(idle.version.is_none());

        for status in [&missing, &idle] {
            assert_eq!(status.catalog.len(), 5);
            assert!(status.catalog.iter().any(|row| row.recommended));
            assert!(status.catalog.iter().all(|row| !row.installed));
            assert!(status.catalog.iter().all(|row| row.fits.is_some()));
        }
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "an unreachable daemon took {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn this_machines_memory_can_actually_be_read() {
        let total = ollama::total_memory().expect("a machine running tests has memory");
        assert!(
            total > 256 * 1024 * 1024,
            "total memory came back as {total} bytes, which is not a machine"
        );
        assert!(total > u64::from(u32::MAX) / 4);
    }

    #[test]
    fn a_running_ollama_with_no_models_is_an_ordinary_answer() {
        let (catalog, unmanaged) = ollama::join_catalog(&[], None);
        assert!(catalog.iter().all(|row| !row.installed));
        assert!(unmanaged.is_empty());
        assert_eq!(resolve_state(true, true, true), RuntimeState::Running);

        let (catalog, _) = ollama::join_catalog(&["qwen3.5:4b".to_string()], None);
        assert_eq!(catalog.iter().filter(|row| row.installed).count(), 1);
        assert_eq!(resolve_state(true, true, true), RuntimeState::Running);
    }

    #[test]
    fn a_model_wattle_does_not_ship_is_refused_before_any_request() {
        for rejected in [
            "llama3:8b",
            "qwen3.5:latest",
            "",
            "qwen3.5:4b ",
            "../../etc/passwd",
            "qwen3.5:4b; rm -rf /",
        ] {
            assert!(
                ollama::find_model(rejected).is_none(),
                "{rejected:?} must not be installable"
            );
        }
        assert!(ollama::find_model("qwen3.5:4b").is_some());
    }

    #[test]
    fn ai_is_off_until_someone_turns_it_on() {
        let conn = crate::db::init_db_at_connection_for_test();
        assert!(!ai_enabled(&conn).unwrap());

        conn.execute("INSERT INTO settings (id) VALUES (1)", [])
            .unwrap();
        assert!(!ai_enabled(&conn).unwrap());

        conn.execute("UPDATE settings SET ai_enabled = 1 WHERE id = 1", [])
            .unwrap();
        assert!(ai_enabled(&conn).unwrap());
    }

    #[test]
    fn removing_the_active_model_forgets_it_and_leaves_any_other_alone() {
        let conn = crate::db::init_db_at_connection_for_test();
        conn.execute(
            "INSERT INTO settings (id, ai_enabled, ai_model) VALUES (1, 1, 'qwen3.5:4b')",
            [],
        )
        .unwrap();

        clear_active_model_if(&conn, "qwen3.5:9b").unwrap();
        assert_eq!(active_model(&conn), "qwen3.5:4b");

        clear_active_model_if(&conn, "qwen3.5:4b").unwrap();
        assert_eq!(active_model(&conn), "");
    }

    fn active_model(conn: &Connection) -> String {
        conn.query_row("SELECT ai_model FROM settings WHERE id = 1", [], |row| {
            row.get(0)
        })
        .unwrap()
    }

    #[test]
    fn only_the_approved_actions_produce_a_prompt() {
        assert_eq!(ACTIONS.len(), 4);
        let keys: Vec<&str> = ACTIONS.iter().map(|(key, _)| *key).collect();
        assert_eq!(
            keys,
            vec![
                "fixGrammar",
                "makeShorter",
                "improveClarity",
                "suggestTitle"
            ]
        );

        for key in keys {
            let prompt = build_prompt(key, "en", "Ieri ho camminato a lungo.").unwrap();
            assert!(prompt.contains("Ieri ho camminato a lungo."));
            assert!(prompt.contains("Do not describe or justify your changes."));
        }

        for rejected in ["expand", "changeTone", "translate", "", "FIXGRAMMAR"] {
            assert!(
                build_prompt(rejected, "en", "some text").is_none(),
                "{rejected:?} must not be askable"
            );
        }
    }

    #[test]
    fn every_action_asks_for_the_interface_language() {
        for (code, name) in LANGUAGES {
            for (action, _) in ACTIONS {
                let prompt = build_prompt(action, code, "Yesterday I walked.").unwrap();
                assert!(
                    prompt.contains(&format!("Output language: {name}.")),
                    "{action} in {code} did not state the output language"
                );
                assert!(prompt.contains(&format!(
                    "Write the result in {name} regardless of the language"
                )));
                assert!(prompt.contains(&format!(
                    "Put only the rewritten passage in the \"rewritten_in_{}\" field.",
                    name.to_ascii_lowercase()
                )));
            }
        }

        let italian_passage_english_ui =
            build_prompt("makeShorter", "en", "Ieri ho camminato a lungo.").unwrap();
        assert!(italian_passage_english_ui.contains("Output language: English."));
        assert!(!italian_passage_english_ui.contains("Italian"));
    }

    #[test]
    fn every_language_the_interface_offers_is_named_for_the_model() {
        for (code, expected) in [
            ("cs", "Czech"),
            ("de", "German"),
            ("el", "Greek"),
            ("en", "English"),
            ("es", "Spanish"),
            ("fi", "Finnish"),
            ("fr", "French"),
            ("hu", "Hungarian"),
            ("it", "Italian"),
            ("nl", "Dutch"),
            ("pl", "Polish"),
            ("pt", "Portuguese"),
            ("ru", "Russian"),
            ("sv", "Swedish"),
            ("tr", "Turkish"),
            ("uk", "Ukrainian"),
        ] {
            assert_eq!(language_name(code), expected, "locale {code:?}");
            let prompt = build_prompt("fixGrammar", code, "Yesterday I walked.").unwrap();
            assert!(
                prompt.contains(&format!("Output language: {expected}.")),
                "{code} was not asked for by name"
            );
        }
    }

    #[test]
    fn an_unsupported_language_falls_back_to_english_rather_than_failing() {
        for unknown in ["", "de-DE", "IT", "klingon", "it-IT", "zz"] {
            assert_eq!(language_name(unknown), "English", "locale {unknown:?}");
        }
        let prompt = build_prompt("fixGrammar", "zz", "Hier j'ai marché.").unwrap();
        assert!(prompt.contains("Output language: English."));
    }

    #[test]
    fn a_selection_that_cannot_be_rewritten_is_refused_before_any_request() {
        assert!(build_prompt("fixGrammar", "it", "").is_none());
        assert!(build_prompt("fixGrammar", "it", "   \n\t ").is_none());

        let too_long = "a".repeat(MAX_REWRITE_CHARS + 1);
        assert!(build_prompt("fixGrammar", "it", &too_long).is_none());
        assert!(build_prompt("fixGrammar", "it", &"a".repeat(MAX_REWRITE_CHARS)).is_some());
        assert!(build_prompt("fixGrammar", "it", &"è".repeat(MAX_REWRITE_CHARS)).is_some());
    }

    fn read(body: &str, field: &str) -> Result<String, String> {
        let mut answer = ollama::Answer::default();
        ollama::absorb(body, &mut answer)?;
        ollama::read_rewrite(&answer, field)
    }

    #[test]
    fn a_models_answer_is_read_or_its_error_is_passed_on() {
        let field = rewrite_field("it");
        assert_eq!(field, "rewritten_in_italian");
        assert_eq!(rewrite_field("en"), "rewritten_in_english");

        let shaped = |text: &str| {
            serde_json::json!({
                "response": serde_json::json!({ &field: text }).to_string()
            })
            .to_string()
        };

        assert_eq!(
            read(&shaped("  Ieri ho camminato.  "), &field).unwrap(),
            "Ieri ho camminato."
        );

        assert_eq!(
            read(r#"{"error":"model requires more system memory"}"#, &field).unwrap_err(),
            "ai:daemon model requires more system memory"
        );

        for empty in [
            "",
            "not json",
            "null",
            r#"{"response":""}"#,
            r#"{"response":"   "}"#,
            r#"{"response":null}"#,
            r#"{"something":"else"}"#,
        ] {
            assert!(read(empty, &field).is_err(), "{empty:?}");
        }

        assert!(read(&shaped(""), &field).is_err());
        assert!(read(&shaped("   "), &field).is_err());
        assert!(read(&shaped("Yesterday I walked."), "rewritten_in_english").is_err());
        assert!(read(
            r#"{"response":"Ieri ho camminato. (Nota: ho corretto due errori.)"}"#,
            &field
        )
        .is_err());

        let reasoned = read(
            r#"{"response":"","thinking":"Let me consider the sentence...","done_reason":"length"}"#,
            &field,
        )
        .unwrap_err();
        assert_eq!(reasoned, "ai:reasoned");
    }

    #[test]
    fn a_passage_that_legitimately_contains_a_note_survives_intact() {
        let field = rewrite_field("it");
        let passage =
            "Ieri ho riletto il contratto (Nota: la clausola 4 va rivista). Poi sono uscito.";
        let body = serde_json::json!({
            "response": serde_json::json!({ &field: passage }).to_string()
        })
        .to_string();

        assert_eq!(read(&body, &field).unwrap(), passage);
    }

    #[test]
    #[ignore = "needs a running Ollama with qwen3.5:4b installed"]
    fn live_rewrite_returns_text_for_every_action_and_language() {
        const ITALIAN: &str =
            "Ieri ho camminato a lungo e ho visto un tramonto bellisimo, ero molto stanco ma felice.";
        const ENGLISH: &str =
            "Yesterday i walked for a long time and saw a beatiful sunset, i was very tired but happy.";

        let base = ollama::base_url();
        for (action, _) in ACTIONS {
            for (ui, passage, label) in [
                ("it", ITALIAN, "it-text"),
                ("en", ENGLISH, "en-text"),
                ("en", ITALIAN, "it-text"),
                ("it", ENGLISH, "en-text"),
            ] {
                let prompt = build_prompt(action, ui, passage).unwrap();
                let answer = tauri::async_runtime::block_on(async {
                    ollama::rewrite_at(&base, "qwen3.5:4b", &prompt, &rewrite_field(ui)).await
                })
                .unwrap_or_else(|error| panic!("{action}/{ui}/{label} failed: {error}"));

                assert!(
                    !answer.trim().is_empty(),
                    "{action}/{ui}/{label} returned nothing"
                );
                println!(
                    "ui={ui} {action:15} {label:8} -> {}",
                    answer.replace('\n', " ")
                );
            }
        }
    }

    #[test]
    fn a_model_that_left_the_machine_stops_being_the_active_one() {
        let conn = crate::db::init_db_at_connection_for_test();
        conn.execute(
            "INSERT INTO settings (id, ai_enabled, ai_model) VALUES (1, 1, 'qwen3.5:4b')",
            [],
        )
        .unwrap();

        let present = AiStatusDto {
            state: RuntimeState::Running,
            version: Some("0.1.0".to_string()),
            catalog: ollama::join_catalog(&["qwen3.5:4b".to_string()], None).0,
            pulling: None,
            installing: false,
            unmanaged: Vec::new(),
        };
        forget_uninstalled_model(&conn, &present).unwrap();
        assert_eq!(active_model(&conn), "qwen3.5:4b");

        let gone = AiStatusDto {
            state: RuntimeState::Running,
            version: Some("0.1.0".to_string()),
            catalog: ollama::join_catalog(&["qwen3.5:9b".to_string()], None).0,
            pulling: None,
            installing: false,
            unmanaged: Vec::new(),
        };
        forget_uninstalled_model(&conn, &gone).unwrap();
        assert_eq!(active_model(&conn), "");

        forget_uninstalled_model(&conn, &gone).unwrap();
        assert_eq!(active_model(&conn), "");
    }

    #[test]
    fn every_command_refuses_while_assistance_is_off() {
        let conn = crate::db::init_db_at_connection_for_test();
        conn.execute("INSERT INTO settings (id) VALUES (1)", [])
            .unwrap();

        assert!(require_enabled(&conn).is_err());

        conn.execute("UPDATE settings SET ai_enabled = 1 WHERE id = 1", [])
            .unwrap();
        assert!(require_enabled(&conn).is_ok());
    }

    #[test]
    fn a_stopped_ollama_is_not_reported_as_a_missing_model() {
        let resolved =
            tauri::async_runtime::block_on(tag_to_generate_with(UNREACHABLE, "qwen3.5:9b"));
        assert_eq!(resolved.as_deref(), Ok("qwen3.5:9b"));
    }

    #[test]
    fn ollama_work_never_touches_journal_data() {
        for file in [
            "src/commands/ai.rs",
            "src/ollama_runtime.rs",
            "src/ollama.rs",
        ] {
            let source = std::fs::read_to_string(file).unwrap();
            for table in ["entries", "attachments", "entries_fts"] {
                assert!(
                    !source.contains(&format!("FROM {table}"))
                        && !source.contains(&format!("INTO {table}"))
                        && !source.contains(&format!("UPDATE {table}")),
                    "{file} must not reach into {table}"
                );
            }
        }
    }

    #[test]
    fn the_nudge_field_is_named_after_the_output_language() {
        assert_eq!(nudge_field("it"), "invitation_in_italian");
        assert_eq!(nudge_field("en"), "invitation_in_english");
        assert_eq!(nudge_field("sv"), "invitation_in_swedish");
        assert_eq!(nudge_field("uk"), "invitation_in_ukrainian");
        assert_eq!(nudge_field("zz"), "invitation_in_english");
    }

    #[test]
    fn every_composed_prompt_demands_a_finished_sentence_in_the_readers_language() {
        for (code, name) in LANGUAGES {
            for prompt in [
                build_nudge_prompt("a place they passed through recently", code).unwrap(),
                build_letter_prompt("a place they passed through recently", code).unwrap(),
            ] {
                assert!(
                    prompt.contains("One complete, grammatical sentence"),
                    "{code} was not asked for a whole sentence"
                );
                assert!(
                    prompt.contains(&format!(
                        "phrased as a native speaker of {name} would say it"
                    )),
                    "{code} was not asked to sound native"
                );
                assert!(
                    prompt.contains("rather than translating it word for word"),
                    "{code} was not told the subject is English on purpose"
                );
                assert!(
                    prompt.contains("leave no English in the answer"),
                    "{code} may leave English in the answer"
                );
                assert!(
                    !prompt.contains("         "),
                    "{code} carries the source indentation into the prompt"
                );
            }
        }
    }

    #[test]
    fn a_nudge_prompt_names_the_language_the_field_and_the_theme() {
        let prompt = build_nudge_prompt("a small kindness they were shown", "it").unwrap();
        assert!(prompt.contains("a small kindness they were shown"));
        assert!(prompt.contains("Italian"));
        assert!(prompt.contains("\"invitation_in_italian\""));
        assert!(prompt.contains("invitation"));
    }

    #[test]
    fn a_letter_prompt_asks_for_a_question_across_years_and_never_for_the_letter() {
        let prompt =
            build_letter_prompt("what today was actually like, hour by hour", "it").unwrap();
        assert!(prompt.contains("what today was actually like, hour by hour"));
        assert!(prompt.contains("Italian"));
        assert!(prompt.contains("\"question_in_italian\""));
        assert!(prompt.contains("years from now"));
        assert!(prompt.contains("Do not write any part of the letter itself."));
    }

    #[test]
    fn a_letters_question_and_a_days_invitation_are_not_the_same_request() {
        assert_ne!(letter_prompt_field("en"), nudge_field("en"));
        assert_eq!(letter_prompt_field("en"), "question_in_english");
        assert_eq!(letter_prompt_field("it"), "question_in_italian");
        assert_eq!(letter_prompt_field("sv"), "question_in_swedish");
        assert_eq!(letter_prompt_field("zz"), "question_in_english");
        assert_ne!(
            build_letter_prompt("a hard season", "en"),
            build_nudge_prompt("a hard season", "en")
        );
    }

    #[test]
    fn a_letter_theme_that_is_empty_or_a_whole_prompt_is_refused() {
        assert!(build_letter_prompt("", "en").is_none());
        assert!(build_letter_prompt("   ", "en").is_none());
        assert!(build_letter_prompt(&"x".repeat(MAX_NUDGE_THEME_CHARS + 1), "en").is_none());
    }

    #[test]
    fn a_theme_that_is_empty_or_a_whole_prompt_is_refused() {
        assert!(build_nudge_prompt("", "en").is_none());
        assert!(build_nudge_prompt("   ", "en").is_none());
        assert!(build_nudge_prompt(&"x".repeat(MAX_NUDGE_THEME_CHARS + 1), "en").is_none());
        assert!(build_nudge_prompt(&"x".repeat(MAX_NUDGE_THEME_CHARS), "en").is_some());
    }
}
