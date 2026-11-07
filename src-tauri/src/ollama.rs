//! The curated model catalog, and the little HTTP that talks to a local Ollama.

use std::time::Duration;

use serde::Serialize;

/// Where a local Ollama listens unless the environment says otherwise.
const DEFAULT_HOST: &str = "http://127.0.0.1:11434";

/// Long enough for a daemon that is running, short enough that a daemon that is
/// not never feels like a hang.
const CONNECT_TIMEOUT: Duration = Duration::from_millis(1500);

/// A whole request for the small calls - version and tags.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

/// A model Wattle offers to manage.
pub struct CatalogModel {
    pub id: &'static str,
    pub display_name: &'static str,
    /// An i18n key, so the guidance is written in the reader's language.
    pub description_key: &'static str,
    pub download_bytes: u64,
    pub context_tokens: u32,
    /// Other tags that mean these same weights.
    pub aliases: &'static [&'static str],
    pub pull_command: &'static str,
}

const GIGABYTE: u64 = 1024 * 1024 * 1024;

/// Every catalogue row's context window, because every catalogue row has the
/// same one: 256K, as Ollama publishes it for all of Qwen 3.5's tags.
const CONTEXT_TOKENS: u32 = 262_144;

/// What Wattle offers to install, and why these five.
pub const CATALOG: &[CatalogModel] = &[
    CatalogModel {
        id: "qwen3.5:0.8b",
        display_name: "Qwen 3.5 0.8B",
        description_key: "aiDesc08b",
        download_bytes: GIGABYTE,
        context_tokens: CONTEXT_TOKENS,
        aliases: &[],
        pull_command: "ollama pull qwen3.5:0.8b",
    },
    CatalogModel {
        id: "qwen3.5:2b-q4_K_M",
        display_name: "Qwen 3.5 2B",
        description_key: "aiDesc2b",
        download_bytes: GIGABYTE * 19 / 10,
        context_tokens: CONTEXT_TOKENS,
        aliases: &[],
        pull_command: "ollama pull qwen3.5:2b-q4_K_M",
    },
    CatalogModel {
        id: "qwen3.5:4b",
        display_name: "Qwen 3.5 4B",
        description_key: "aiDesc4b",
        download_bytes: GIGABYTE * 34 / 10,
        context_tokens: CONTEXT_TOKENS,
        aliases: &[],
        pull_command: "ollama pull qwen3.5:4b",
    },
    CatalogModel {
        id: "qwen3.5:9b",
        display_name: "Qwen 3.5 9B",
        description_key: "aiDesc9b",
        download_bytes: GIGABYTE * 66 / 10,
        context_tokens: CONTEXT_TOKENS,
        aliases: &["qwen3.5:latest"],
        pull_command: "ollama pull qwen3.5:9b",
    },
    CatalogModel {
        id: "qwen3.5:27b",
        display_name: "Qwen 3.5 27B",
        description_key: "aiDesc27b",
        download_bytes: GIGABYTE * 17,
        context_tokens: CONTEXT_TOKENS,
        aliases: &[],
        pull_command: "ollama pull qwen3.5:27b",
    },
];

/// The row badged Recommended when this machine's memory could not be read.
const DEFAULT_RECOMMENDED: &str = "qwen3.5:4b";

/// The largest download Wattle will ever put its recommendation behind.
// ponytail: a size ceiling standing in for a speed measurement. If Wattle ever
// learns to read GPU memory, this is the constant that should give way to it.
const RECOMMENDED_CEILING: u64 = GIGABYTE * 7;

/// What the operating system and Wattle take before a model is loaded at all.
const SYSTEM_RESERVE: u64 = GIGABYTE * 5 / 2;

/// Whether this model still fits once the system has taken its share.
fn fits_with_headroom(download_bytes: u64, total_ram_bytes: u64) -> bool {
    let needed = download_bytes.saturating_mul(WORKING_SET.0) / WORKING_SET.1;
    needed <= total_ram_bytes.saturating_sub(SYSTEM_RESERVE)
}

/// The one row that carries the Recommended badge, for this machine.
pub fn recommended_id(total_ram_bytes: Option<u64>) -> &'static str {
    let Some(total) = total_ram_bytes else {
        return DEFAULT_RECOMMENDED;
    };
    CATALOG
        .iter()
        .filter(|model| {
            model.download_bytes <= RECOMMENDED_CEILING
                && fits_in(model.download_bytes, total_ram_bytes) == Some(true)
                && fits_with_headroom(model.download_bytes, total)
        })
        .max_by_key(|model| model.download_bytes)
        .or_else(|| CATALOG.iter().min_by_key(|model| model.download_bytes))
        .map_or(DEFAULT_RECOMMENDED, |model| model.id)
}

/// The model Wattle measures similarity with, if it is installed.
pub const EMBEDDING_MODEL: &str = "bge-m3";

/// How many numbers `EMBEDDING_MODEL` answers with.
pub const EMBEDDING_DIMENSIONS: usize = 1024;

/// The catalog row with this exact id, or nothing.
pub fn find_model(id: &str) -> Option<&'static CatalogModel> {
    CATALOG.iter().find(|model| model.id == id)
}

/// The tag to send for this catalogue row, out of what this machine holds.
pub fn installed_tag_for(id: &str, installed_tags: &[String]) -> Option<&'static str> {
    let model = find_model(id)?;
    if installed_tags.iter().any(|tag| tag == model.id) {
        return Some(model.id);
    }
    model
        .aliases
        .iter()
        .copied()
        .find(|alias| installed_tags.iter().any(|tag| tag == alias))
}

/// The tag a removal should name.
pub fn tag_to_delete<'a>(id: &'a str, installed_tags: &[String]) -> &'a str {
    installed_tag_for(id, installed_tags).unwrap_or(id)
}

/// Whether this tag is one the catalogue already accounts for.
fn is_catalog_tag(tag: &str) -> bool {
    CATALOG
        .iter()
        .any(|model| model.id == tag || model.aliases.contains(&tag))
}

/// The catalog row with this id, but only if it is a model that writes.
pub fn find_chat_model(id: &str) -> Option<&'static CatalogModel> {
    find_model(id)
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntryDto {
    pub id: String,
    pub display_name: String,
    pub description_key: String,
    pub download_bytes: u64,
    pub context_tokens: u32,
    pub pull_command: String,
    pub recommended: bool,
    /// As reported by this machine's Ollama, right now.
    pub installed: bool,
    /// Whether this machine has the memory to run it comfortably, or nothing
    /// when that cannot be judged - because assistance is off, or because the
    /// machine would not say.
    pub fits: Option<bool>,
}

/// What a model needs resident, against what it takes on disk.
const WORKING_SET: (u64, u64) = (12, 10);

/// How long Ollama holds a model in memory after answering, per tier.
const KEEP_ALIVE_SMALL: &str = "30s";
const KEEP_ALIVE_MEDIUM: &str = "2m";
const KEEP_ALIVE_LARGE: &str = "5m";

/// Where one tier ends and the next begins, in installed memory.
const SMALL_MACHINE: u64 = GIGABYTE * 10;
const MEDIUM_MACHINE: u64 = GIGABYTE * 20;

/// The keep-alive a machine of this size gets.
pub fn keep_alive_for(total_ram_bytes: Option<u64>) -> &'static str {
    match total_ram_bytes {
        Some(bytes) if bytes >= MEDIUM_MACHINE => KEEP_ALIVE_LARGE,
        Some(bytes) if bytes >= SMALL_MACHINE => KEEP_ALIVE_MEDIUM,
        _ => KEEP_ALIVE_SMALL,
    }
}

/// The policy for this machine, read once.
fn keep_alive() -> &'static str {
    static POLICY: std::sync::OnceLock<&'static str> = std::sync::OnceLock::new();
    POLICY.get_or_init(|| keep_alive_for(total_memory()))
}

/// What the embedder is given, whatever the machine.
const EMBED_KEEP_ALIVE: &str = KEEP_ALIVE_SMALL;

/// Total physical memory, or nothing when it cannot be read.
pub fn total_memory() -> Option<u64> {
    let mut system = sysinfo::System::new();
    system.refresh_memory();
    let total = system.total_memory();
    (total > 0).then_some(total)
}

/// The share of a machine's memory a model may claim before Wattle stops
/// calling it a comfortable fit.
const USABLE_RAM: (u64, u64) = (7, 10);

/// Whether a download of this size will run comfortably in this much memory.
pub fn fits_in(download_bytes: u64, total_ram_bytes: Option<u64>) -> Option<bool> {
    let total = total_ram_bytes.filter(|bytes| *bytes > 0)?;
    let needed = download_bytes.saturating_mul(WORKING_SET.0) / WORKING_SET.1;
    let usable = total.saturating_mul(USABLE_RAM.0) / USABLE_RAM.1;
    Some(needed <= usable)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatusDto {
    /// Whether Ollama is absent, present but idle, or answering.
    pub state: crate::ollama_runtime::RuntimeState,
    pub version: Option<String>,
    pub catalog: Vec<CatalogEntryDto>,
    /// The model a download started earlier is still fetching, if any.
    pub pulling: Option<String>,
    /// Whether the Ollama installer is still running.
    pub installing: bool,
    /// Models on this machine that Wattle does not manage.
    pub unmanaged: Vec<String>,
}

impl AiStatusDto {
    /// The catalog with no daemon behind it - what the panel shows when AI is
    /// off, when Ollama is missing, or when it is installed but idle.
    pub fn without_daemon(
        state: crate::ollama_runtime::RuntimeState,
        total_ram_bytes: Option<u64>,
    ) -> Self {
        Self {
            state,
            version: None,
            catalog: join_catalog(&[], total_ram_bytes).0,
            pulling: None,
            installing: false,
            unmanaged: Vec::new(),
        }
    }
}

/// Joins the catalog against the tags this machine reports.
pub fn join_catalog(
    installed_tags: &[String],
    total_ram_bytes: Option<u64>,
) -> (Vec<CatalogEntryDto>, Vec<String>) {
    let recommended = recommended_id(total_ram_bytes);
    let catalog = CATALOG
        .iter()
        .map(|model| CatalogEntryDto {
            id: model.id.to_string(),
            display_name: model.display_name.to_string(),
            description_key: model.description_key.to_string(),
            download_bytes: model.download_bytes,
            context_tokens: model.context_tokens,
            pull_command: model.pull_command.to_string(),
            recommended: model.id == recommended,
            installed: installed_tag_for(model.id, installed_tags).is_some(),
            fits: fits_in(model.download_bytes, total_ram_bytes),
        })
        .collect();

    let mut unmanaged: Vec<String> = installed_tags
        .iter()
        .filter(|tag| !is_catalog_tag(tag))
        .cloned()
        .collect();
    unmanaged.sort();
    unmanaged.dedup();

    (catalog, unmanaged)
}

/// Honours `OLLAMA_HOST`, but only while it still points at this machine.
pub fn base_url() -> String {
    std::env::var("OLLAMA_HOST")
        .ok()
        .and_then(|value| normalise_host(&value))
        .unwrap_or_else(|| DEFAULT_HOST.to_string())
}

fn normalise_host(value: &str) -> Option<String> {
    let value = value.trim().trim_end_matches('/');
    if value.is_empty() {
        return None;
    }
    let with_scheme = if value.contains("://") {
        value.to_string()
    } else {
        format!("http://{value}")
    };

    let url = reqwest::Url::parse(&with_scheme).ok()?;
    let host = url.host_str()?;
    let is_loopback = host == "localhost"
        || host
            .trim_start_matches('[')
            .trim_end_matches(']')
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback());
    let is_plain = url.scheme() == "http"
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none();

    if is_loopback && is_plain {
        Some(url.as_str().trim_end_matches('/').to_string())
    } else {
        None
    }
}

fn client(timeout: Option<Duration>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none());
    if let Some(timeout) = timeout {
        builder = builder.timeout(timeout);
    }
    builder.build().map_err(|e| e.to_string())
}

/// The daemon's version, or nothing when there is no daemon to ask.
pub async fn version_at(base: &str) -> Option<String> {
    let response = client(Some(REQUEST_TIMEOUT))
        .ok()?
        .get(format!("{base}/api/version"))
        .send()
        .await
        .ok()?;
    let body = response.text().await.ok()?;
    serde_json::from_str::<serde_json::Value>(&body)
        .ok()?
        .get("version")?
        .as_str()
        .map(str::to_string)
}

pub async fn installed_tags_at(base: &str) -> Vec<String> {
    try_installed_tags_at(base).await.unwrap_or_default()
}

/// The installed tags, or `None` when no daemon is answering.
async fn try_installed_tags_at(base: &str) -> Option<Vec<String>> {
    let client = client(Some(REQUEST_TIMEOUT)).ok()?;
    let response = client.get(format!("{base}/api/tags")).send().await.ok()?;
    let body = response.text().await.ok()?;
    Some(parse_tags(&body))
}

/// The tag to hand `/api/generate` for the model this journal is set to.
pub async fn generation_tag_at(base: &str, id: &str) -> Option<String> {
    match try_installed_tags_at(base).await {
        Some(tags) => installed_tag_for(id, &tags).map(str::to_string),
        None => Some(id.to_string()),
    }
}

/// The model names in an `/api/tags` body.
pub fn parse_tags(body: &str) -> Vec<String> {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| value.get("models")?.as_array().cloned())
        .map(|models| {
            models
                .iter()
                .filter_map(|model| model.get("name")?.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// One line of a streamed pull.
#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PullProgress {
    pub status: String,
    pub completed: u64,
    pub total: u64,
    /// Ollama's own words when it fails - disk full, out of memory, a name it
    /// cannot find.
    pub error: Option<String>,
}

/// Reads one NDJSON line of a pull.
pub fn parse_pull_line(line: &str) -> Option<PullProgress> {
    let value = serde_json::from_str::<serde_json::Value>(line.trim()).ok()?;
    if !value.is_object() {
        return None;
    }
    Some(PullProgress {
        status: value
            .get("status")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_string(),
        completed: value
            .get("completed")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0),
        total: value
            .get("total")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0),
        error: value
            .get("error")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
    })
}

/// Starts a streamed pull.
pub async fn start_pull(base: &str, id: &str) -> Result<reqwest::Response, String> {
    client(None)?
        .post(format!("{base}/api/pull"))
        .json(&serde_json::json!({ "model": id, "stream": true }))
        .send()
        .await
        .map_err(|e| e.to_string())
}

/// A rewrite is a paragraph, not a conversation, so the context is pinned small
/// rather than left to the model's advertised 256K.
const REWRITE_CONTEXT_TOKENS: u32 = 4096;

/// Ollama defaults to 0.8, which is a setting for writing, not for correcting.
const REWRITE_TEMPERATURE: f32 = 0.2;

/// The sampling a writing nudge is given.
const NUDGE_TEMPERATURE: f32 = 0.7;

/// The most an answer may grow to before the generation is abandoned.
const MAX_ANSWER_BYTES: usize = 256 * 1024;

/// How long a generation may go **silent** before it is abandoned.
const IDLE_TIMEOUT: Duration = Duration::from_secs(45);

/// The shape a rewrite has to come back in.
fn rewrite_schema(field: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": { field: { "type": "string", "minLength": 1 } },
        "required": [field],
        "additionalProperties": false,
    })
}

/// What a generation produced, assembled from however many frames it arrived in.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Answer {
    pub response: String,
    /// Reasoning, when a model emitted it despite `think: false`.
    pub thinking: String,
    /// True once at least one frame has been read as an object.
    pub readable: bool,
}

/// Folds NDJSON frames into the answer being assembled.
pub fn absorb(text: &str, answer: &mut Answer) -> Result<(), String> {
    for line in text.lines() {
        let Ok(frame) = serde_json::from_str::<serde_json::Value>(line.trim()) else {
            continue;
        };
        let Some(frame) = frame.as_object() else {
            continue;
        };
        answer.readable = true;

        if let Some(error) = frame
            .get("error")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|error| !error.is_empty())
        {
            return Err(AiError::daemon(error));
        }
        for (key, into) in [
            ("response", &mut answer.response),
            ("thinking", &mut answer.thinking),
        ] {
            if let Some(fragment) = frame.get(key).and_then(serde_json::Value::as_str) {
                into.push_str(fragment);
            }
        }
    }
    Ok(())
}

/// One streamed generation, in a shape the model cannot deviate from.
#[allow(clippy::too_many_arguments)]
async fn stream_generate(
    base: &str,
    model: &str,
    prompt: &str,
    format: serde_json::Value,
    num_ctx: u32,
    temperature: f32,
    keep_alive: &str,
    idle: Duration,
) -> Result<Answer, String> {
    let mut response = client(None)?
        .post(format!("{base}/api/generate"))
        .json(&serde_json::json!({
            "model": model,
            "prompt": prompt,
            "stream": true,
            "think": false,
            "format": format,
            "keep_alive": keep_alive,
            "options": {
                "num_ctx": num_ctx,
                "temperature": temperature,
            },
        }))
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                AiError::TIMEOUT.to_string()
            } else {
                AiError::UNREACHABLE.to_string()
            }
        })?;

    let status = response.status();
    if !status.is_success() {
        if status.as_u16() == 404 {
            return Err(AiError::MODEL_GONE.to_string());
        }
        let body = response.text().await.unwrap_or_default();
        return Err(AiError::daemon(
            &error_from(&body).unwrap_or_else(|| status.as_u16().to_string()),
        ));
    }

    let mut answer = Answer::default();
    let mut pending: Vec<u8> = Vec::new();

    loop {
        let chunk = tokio::time::timeout(idle, response.chunk())
            .await
            .map_err(|_| AiError::TIMEOUT.to_string())?
            .map_err(|_| AiError::UNREACHABLE.to_string())?;
        let Some(chunk) = chunk else { break };

        pending.extend_from_slice(&chunk);
        while let Some(newline) = pending.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = pending.drain(..=newline).collect();
            absorb(&String::from_utf8_lossy(&line), &mut answer)?;
        }

        if answer.response.len() + answer.thinking.len() + pending.len() > MAX_ANSWER_BYTES {
            return Err(AiError::TOO_LONG.to_string());
        }
    }

    if !pending.is_empty() {
        absorb(&String::from_utf8_lossy(&pending), &mut answer)?;
    }
    Ok(answer)
}

/// Rewrites a passage, and returns the suggestion or the reason there is none.
pub async fn rewrite_at(
    base: &str,
    model: &str,
    prompt: &str,
    field: &str,
) -> Result<String, String> {
    let answer = stream_generate(
        base,
        model,
        prompt,
        rewrite_schema(field),
        REWRITE_CONTEXT_TOKENS,
        REWRITE_TEMPERATURE,
        keep_alive(),
        IDLE_TIMEOUT,
    )
    .await?;
    read_rewrite(&answer, field)
}

/// Writes one invitation to write, and returns it or the reason there is none.
pub async fn nudge_at(
    base: &str,
    model: &str,
    prompt: &str,
    field: &str,
) -> Result<String, String> {
    let answer = stream_generate(
        base,
        model,
        prompt,
        rewrite_schema(field),
        REWRITE_CONTEXT_TOKENS,
        NUDGE_TEMPERATURE,
        keep_alive(),
        IDLE_TIMEOUT,
    )
    .await?;
    read_rewrite(&answer, field)
}

/// The failure kinds the interface knows how to say in the reader's language.
pub struct AiError;

impl AiError {
    pub const DISABLED: &'static str = "ai:disabled";
    pub const NO_MODEL: &'static str = "ai:noModel";
    pub const MODEL_GONE: &'static str = "ai:modelGone";
    pub const BAD_SELECTION: &'static str = "ai:badSelection";
    pub const CANCELLED: &'static str = "ai:cancelled";
    pub const TIMEOUT: &'static str = "ai:timeout";
    pub const UNREACHABLE: &'static str = "ai:unreachable";
    pub const UNREADABLE: &'static str = "ai:unreadable";
    pub const EMPTY: &'static str = "ai:empty";
    pub const REASONED: &'static str = "ai:reasoned";
    pub const NO_PASSAGE: &'static str = "ai:noPassage";
    /// A model that would not stop. See `MAX_ANSWER_BYTES`.
    pub const TOO_LONG: &'static str = "ai:tooLong";
    /// Ollama said something specific. Kept, after the code, as detail.
    pub fn daemon(detail: &str) -> String {
        format!("ai:daemon {detail}")
    }
}

/// Ollama's own words about a failure, if the body carries any.
fn error_from(body: &str) -> Option<String> {
    let message = serde_json::from_str::<serde_json::Value>(body)
        .ok()?
        .get("error")?
        .as_str()?
        .trim()
        .to_string();
    (!message.is_empty()).then_some(message)
}

/// The rewritten passage out of an assembled answer, or an error explaining why
/// there is none.
pub fn read_rewrite(answer: &Answer, field: &str) -> Result<String, String> {
    read_answer(answer)?
        .get(field)
        .and_then(serde_json::Value::as_str)
        .map(|passage| passage.trim().to_string())
        .filter(|passage| !passage.is_empty())
        .ok_or_else(|| AiError::NO_PASSAGE.to_string())
}

/// The object the grammar forced, out of the frames that carried it.
fn read_answer(answer: &Answer) -> Result<serde_json::Value, String> {
    if !answer.readable {
        return Err(AiError::UNREADABLE.to_string());
    }

    let text = strip_reasoning(&answer.response).trim();

    if text.is_empty() {
        return Err(if answer.thinking.trim().is_empty() {
            AiError::EMPTY.to_string()
        } else {
            AiError::REASONED.to_string()
        });
    }

    serde_json::from_str::<serde_json::Value>(text).map_err(|_| AiError::NO_PASSAGE.to_string())
}

/// Drops a `<think>…</think>` block a model wrote inline.
fn strip_reasoning(text: &str) -> &str {
    match text.rsplit_once("</think>") {
        Some((_, after)) => after,
        None => text,
    }
}

/// How long one embedding may take.
const EMBED_TIMEOUT: Duration = Duration::from_secs(90);

/// Turns one passage into the vector Wattle compares with.
pub async fn embed_at(base: &str, model: &str, text: &str) -> Result<Vec<f32>, String> {
    let response = client(Some(EMBED_TIMEOUT))?
        .post(format!("{base}/api/embed"))
        .json(&serde_json::json!({
            "model": model,
            "input": text,
            "keep_alive": EMBED_KEEP_ALIVE,
        }))
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                AiError::TIMEOUT.to_string()
            } else {
                AiError::UNREACHABLE.to_string()
            }
        })?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|_| AiError::UNREACHABLE.to_string())?;
    if !status.is_success() {
        if status.as_u16() == 404 {
            return Err(AiError::MODEL_GONE.to_string());
        }
        return Err(AiError::daemon(
            &error_from(&body).unwrap_or_else(|| status.as_u16().to_string()),
        ));
    }
    parse_embedding(&body)
}

/// The first vector out of an `/api/embed` body, normalised.
pub fn parse_embedding(body: &str) -> Result<Vec<f32>, String> {
    if let Some(error) = error_from(body) {
        return Err(AiError::daemon(&error));
    }
    let Ok(envelope) = serde_json::from_str::<serde_json::Value>(body) else {
        return Err(AiError::UNREADABLE.to_string());
    };

    let values = envelope
        .get("embeddings")
        .and_then(serde_json::Value::as_array)
        .and_then(|rows| rows.first())
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| AiError::EMPTY.to_string())?;

    if values.len() != EMBEDDING_DIMENSIONS {
        return Err(AiError::daemon(&format!(
            "the embedding model answered with {} numbers, not {EMBEDDING_DIMENSIONS}",
            values.len()
        )));
    }

    let vector: Vec<f32> = values
        .iter()
        .filter_map(serde_json::Value::as_f64)
        .map(|value| value as f32)
        .collect();
    if vector.len() != EMBEDDING_DIMENSIONS {
        return Err(AiError::UNREADABLE.to_string());
    }

    normalise(vector).ok_or_else(|| AiError::EMPTY.to_string())
}

/// A vector scaled to unit length, or nothing when it has no length to scale.
pub fn normalise(mut vector: Vec<f32>) -> Option<Vec<f32>> {
    let length = vector
        .iter()
        .map(|value| f64::from(*value) * f64::from(*value))
        .sum::<f64>()
        .sqrt();
    if !length.is_finite() || length <= f64::EPSILON {
        return None;
    }
    for value in &mut vector {
        *value = (f64::from(*value) / length) as f32;
    }
    Some(vector)
}

/// Similarity between two already-normalised vectors.
pub fn similarity(left: &[f32], right: &[f32]) -> f32 {
    if left.len() != right.len() || left.is_empty() {
        return 0.0;
    }
    left.iter()
        .zip(right)
        .map(|(a, b)| a * b)
        .sum::<f32>()
        .clamp(-1.0, 1.0)
}

/// A vector as it is stored: little-endian `f32`, and nothing else.
pub fn to_blob(vector: &[f32]) -> Vec<u8> {
    vector
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect()
}

/// The vector back out of a `BLOB`, or nothing when the bytes are not one.
pub fn from_blob(blob: &[u8]) -> Option<Vec<f32>> {
    if blob.is_empty() || !blob.len().is_multiple_of(4) {
        return None;
    }
    Some(
        blob.chunks_exact(4)
            .map(|bytes| f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
            .collect(),
    )
}

pub async fn delete_model_at(base: &str, id: &str) -> Result<(), String> {
    let response = client(Some(REQUEST_TIMEOUT))?
        .delete(format!("{base}/api/delete"))
        .json(&serde_json::json!({ "model": id }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(response
            .text()
            .await
            .unwrap_or_else(|_| "the model could not be removed".to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tags(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| (*name).to_string()).collect()
    }

    fn entry<'a>(catalog: &'a [CatalogEntryDto], id: &str) -> &'a CatalogEntryDto {
        catalog.iter().find(|row| row.id == id).unwrap()
    }

    #[test]
    fn the_catalog_is_five_writers_and_nothing_else() {
        assert_eq!(CATALOG.len(), 5);

        assert!(find_model(EMBEDDING_MODEL).is_none());
        assert!(find_chat_model(EMBEDDING_MODEL).is_none());
        assert!(find_chat_model("qwen3.5:4b").is_some());

        assert_eq!(recommended_id(None), DEFAULT_RECOMMENDED);

        assert!(find_model("qwen3.5:latest").is_none());
        assert!(!CATALOG.iter().any(|model| model.id == "qwen3.5:latest"));
    }

    #[test]
    fn every_hardware_tier_has_a_model_it_can_hold() {
        const GB: u64 = GIGABYTE;

        for (ram, tier) in [
            (4 * GB, "a very modest laptop"),
            (8 * GB, "an entry-level machine"),
            (16 * GB, "a mainstream machine"),
            (32 * GB, "a high-end machine"),
        ] {
            let reachable = CATALOG
                .iter()
                .filter(|model| fits_in(model.download_bytes, Some(ram)) == Some(true))
                .count();
            assert!(reachable > 0, "nothing in the catalogue suits {tier}");
        }

        let workstation = CATALOG.last().unwrap();
        assert_eq!(
            fits_in(workstation.download_bytes, Some(16 * GB)),
            Some(false)
        );
        assert_eq!(
            fits_in(workstation.download_bytes, Some(64 * GB)),
            Some(true)
        );

        assert!(
            CATALOG
                .windows(2)
                .all(|pair| pair[0].download_bytes < pair[1].download_bytes),
            "the catalogue is not in ascending order of download size"
        );
    }

    #[test]
    fn every_row_describes_the_tag_it_names() {
        for model in CATALOG {
            assert_eq!(
                model.pull_command,
                format!("ollama pull {}", model.id),
                "the printed command does not fetch what the row installs"
            );
            assert_eq!(model.context_tokens, CONTEXT_TOKENS);
            assert!(
                !(model.id.contains("coding") || model.id.contains("cloud")),
                "{} is not a model for writing a diary",
                model.id
            );
            assert!(model.id.starts_with("qwen3.5:"));
        }
    }

    #[test]
    fn the_recommendation_is_the_largest_model_that_fits() {
        const GB: u64 = GIGABYTE;

        assert_eq!(recommended_id(Some(4 * GB)), "qwen3.5:0.8b");
        assert_eq!(recommended_id(Some(8 * GB)), "qwen3.5:4b");
        assert_eq!(recommended_id(Some(16 * GB)), "qwen3.5:9b");
        assert_eq!(recommended_id(Some(32 * GB)), "qwen3.5:9b");
        assert_eq!(fits_in(GIGABYTE * 17, Some(32 * GB)), Some(true));
        assert_eq!(recommended_id(Some(64 * GB)), "qwen3.5:9b");
        assert_eq!(recommended_id(Some(128 * GB)), "qwen3.5:9b");
        assert_eq!(recommended_id(Some(256 * GB)), "qwen3.5:9b");
        assert_eq!(recommended_id(Some(GB / 2)), "qwen3.5:0.8b");
        assert_eq!(recommended_id(None), DEFAULT_RECOMMENDED);
        assert_eq!(DEFAULT_RECOMMENDED, "qwen3.5:4b");

        for ram in [
            None,
            Some(2 * GB),
            Some(8 * GB),
            Some(16 * GB),
            Some(64 * GB),
        ] {
            let (catalog, _) = join_catalog(&[], ram);
            let badged: Vec<&str> = catalog
                .iter()
                .filter(|row| row.recommended)
                .map(|row| row.id.as_str())
                .collect();
            assert_eq!(badged.len(), 1, "exactly one row carries the badge");
            let row = catalog.iter().find(|row| row.recommended).unwrap();
            assert_ne!(
                row.fits,
                Some(false),
                "recommended a model that will not fit"
            );
        }
    }

    #[test]
    fn latest_reports_the_9b_row_as_installed() {
        let held = tags(&["qwen3.5:latest"]);
        let (catalog, unmanaged) = join_catalog(&held, None);
        assert!(entry(&catalog, "qwen3.5:9b").installed);
        assert!(unmanaged.is_empty());

        assert_eq!(
            installed_tag_for("qwen3.5:9b", &held),
            Some("qwen3.5:latest")
        );

        let held = tags(&["qwen3.5:9b"]);
        let (catalog, _) = join_catalog(&held, None);
        assert!(entry(&catalog, "qwen3.5:9b").installed);
        assert_eq!(installed_tag_for("qwen3.5:9b", &held), Some("qwen3.5:9b"));
    }

    #[test]
    fn an_installed_row_always_has_a_tag_ollama_can_resolve() {
        let machines = [
            tags(&[]),
            tags(&["qwen3.5:latest"]),
            tags(&["qwen3.5:9b"]),
            tags(&["qwen3.5:latest", "qwen3.5:9b"]),
            tags(&["qwen3.5:4b", "qwen3.5:2b-q4_K_M"]),
            tags(&["qwen3.5:latest", "llama3.2:1b", EMBEDDING_MODEL]),
        ];

        for held in machines {
            let (catalog, _) = join_catalog(&held, None);
            for row in &catalog {
                let sendable = installed_tag_for(&row.id, &held);
                assert_eq!(
                    row.installed,
                    sendable.is_some(),
                    "{} says installed={} with sendable={sendable:?}",
                    row.id,
                    row.installed
                );
                if let Some(tag) = sendable {
                    assert!(
                        held.iter().any(|name| name == tag),
                        "{} would generate with {tag}, which this machine does not hold",
                        row.id
                    );
                }
            }
        }
    }

    #[test]
    fn a_removal_names_the_tag_this_machine_holds() {
        let only_alias = tags(&["qwen3.5:latest"]);
        assert_eq!(tag_to_delete("qwen3.5:9b", &only_alias), "qwen3.5:latest");

        let both = tags(&["qwen3.5:9b", "qwen3.5:latest"]);
        assert_eq!(tag_to_delete("qwen3.5:9b", &both), "qwen3.5:9b");

        let outsider = tags(&["llama3.2:1b"]);
        assert_eq!(tag_to_delete("llama3.2:1b", &outsider), "llama3.2:1b");

        for (id, held) in [("qwen3.5:9b", &only_alias), ("llama3.2:1b", &outsider)] {
            let target = tag_to_delete(id, held);
            assert!(held.iter().any(|tag| tag == target));
        }
    }

    #[test]
    fn the_canonical_tag_wins_over_an_alias() {
        let both = tags(&["qwen3.5:latest", "qwen3.5:9b"]);
        assert_eq!(installed_tag_for("qwen3.5:9b", &both), Some("qwen3.5:9b"));
    }

    #[test]
    fn a_model_that_is_not_here_resolves_to_nothing() {
        let none = tags(&["qwen3.5:4b"]);
        assert_eq!(installed_tag_for("qwen3.5:9b", &none), None);
        let (catalog, _) = join_catalog(&none, None);
        assert!(!entry(&catalog, "qwen3.5:9b").installed);

        assert_eq!(
            installed_tag_for("llama3.2:1b", &tags(&["llama3.2:1b"])),
            None
        );
    }

    #[test]
    fn a_tag_that_only_looks_familiar_is_not_a_match() {
        let lookalikes = tags(&[
            "qwen3.5",
            "qwen3.5:9",
            "qwen3.5:9b-mlx",
            "qwen3.5:latest-ish",
            "latest",
            "notqwen3.5:9b",
        ]);
        assert_eq!(installed_tag_for("qwen3.5:9b", &lookalikes), None);

        let (catalog, unmanaged) = join_catalog(&lookalikes, None);
        assert!(!entry(&catalog, "qwen3.5:9b").installed);
        assert_eq!(unmanaged.len(), lookalikes.len());

        let held = tags(&["qwen3.5:latest"]);
        let tag = installed_tag_for("qwen3.5:9b", &held).unwrap();
        let row = find_model("qwen3.5:9b").unwrap();
        assert!(tag == row.id || row.aliases.contains(&tag));
    }

    #[test]
    fn models_outside_the_catalog_are_listed_but_not_managed() {
        let (catalog, unmanaged) = join_catalog(
            &tags(&["qwen3.5:4b", "llama3:8b", "something-someone-built:latest"]),
            None,
        );

        assert!(entry(&catalog, "qwen3.5:4b").installed);
        assert!(!entry(&catalog, "qwen3.5:9b").installed);
        assert_eq!(
            unmanaged,
            vec!["llama3:8b", "something-someone-built:latest"]
        );
        assert!(find_model("llama3:8b").is_none());
    }

    #[test]
    fn an_empty_machine_reports_the_whole_catalog_uninstalled() {
        let (catalog, unmanaged) = join_catalog(&[], None);
        assert_eq!(catalog.len(), 5);
        assert!(catalog.iter().all(|row| !row.installed));
        assert!(unmanaged.is_empty());
    }

    #[test]
    fn a_model_is_judged_against_this_machines_memory_and_nothing_else() {
        const GB: u64 = GIGABYTE;

        assert_eq!(fits_in(GB * 34 / 10, Some(GB * 8)), Some(true));
        assert_eq!(fits_in(GB * 66 / 10, Some(GB * 8)), Some(false));
        assert_eq!(fits_in(GB * 66 / 10, Some(GB * 32)), Some(true));
        assert_eq!(fits_in(GB * 24, Some(GB * 32)), Some(false));

        assert_eq!(fits_in(GB, None), None);
        assert_eq!(fits_in(GB, Some(0)), None);

        assert_eq!(fits_in(u64::MAX, Some(GB * 8)), Some(false));
        assert_eq!(fits_in(GB, Some(u64::MAX)), Some(true));
    }

    #[test]
    fn the_catalog_reports_a_fit_per_row_or_none_at_all() {
        let (judged, _) = join_catalog(&[], Some(GIGABYTE * 8));
        assert_eq!(entry(&judged, "qwen3.5:0.8b").fits, Some(true));
        assert_eq!(entry(&judged, "qwen3.5:4b").fits, Some(true));
        assert_eq!(entry(&judged, "qwen3.5:27b").fits, Some(false));

        let (unjudged, _) = join_catalog(&[], None);
        assert!(unjudged.iter().all(|row| row.fits.is_none()));

        let (installed, _) = join_catalog(&tags(&["qwen3.5:27b"]), Some(GIGABYTE * 8));
        let row = entry(&installed, "qwen3.5:27b");
        assert!(row.installed);
        assert_eq!(row.fits, Some(false));
    }

    #[test]
    fn tags_that_will_not_parse_are_read_as_no_models() {
        assert_eq!(
            parse_tags(r#"{"models":[{"name":"qwen3.5:4b"},{"name":"llama3:8b"}]}"#),
            vec!["qwen3.5:4b", "llama3:8b"]
        );
        assert!(parse_tags(r#"{"models":[]}"#).is_empty());
        for malformed in [
            "",
            "not json",
            "null",
            "[]",
            "42",
            r#"{"models":null}"#,
            r#"{"models":"nope"}"#,
            r#"{"models":[{"no_name":1},null,7]}"#,
            r#"{"something":"else"}"#,
        ] {
            assert!(
                parse_tags(malformed).is_empty(),
                "{malformed:?} should have read as no models"
            );
        }
    }

    #[test]
    fn a_pull_line_reports_progress_and_passes_ollamas_own_errors_through() {
        assert_eq!(
            parse_pull_line(r#"{"status":"pulling","completed":50,"total":100}"#),
            Some(PullProgress {
                status: "pulling".to_string(),
                completed: 50,
                total: 100,
                error: None,
            })
        );
        assert_eq!(
            parse_pull_line(r#"{"status":"success"}"#).unwrap().status,
            "success"
        );
        assert_eq!(
            parse_pull_line(r#"{"error":"no space left on device"}"#)
                .unwrap()
                .error
                .unwrap(),
            "no space left on device"
        );
        for skipped in ["", "   ", "not json", "null", "[]", "7"] {
            assert!(parse_pull_line(skipped).is_none(), "{skipped:?}");
        }
    }

    #[test]
    fn only_a_loopback_ollama_host_is_honoured() {
        for (value, expected) in [
            ("http://127.0.0.1:11434", Some("http://127.0.0.1:11434")),
            ("127.0.0.1:11434", Some("http://127.0.0.1:11434")),
            ("localhost:11434", Some("http://localhost:11434")),
            ("http://localhost:11434/", Some("http://localhost:11434")),
            ("[::1]:11434", Some("http://[::1]:11434")),
            ("http://192.168.1.50:11434", None),
            ("example.com", None),
            ("https://evil.example.com:11434", None),
            ("", None),
            ("   ", None),
        ] {
            assert_eq!(
                normalise_host(value).as_deref(),
                expected,
                "OLLAMA_HOST {value:?}"
            );
        }
    }

    #[test]
    fn an_ollama_host_is_judged_by_where_it_really_connects() {
        for (value, expected) in [
            ("http://localhost:11434", Some("http://localhost:11434")),
            ("LOCALHOST:11434", Some("http://localhost:11434")),
            ("http://127.0.0.1:11434", Some("http://127.0.0.1:11434")),
            ("127.1.2.3:8080", Some("http://127.1.2.3:8080")),
            ("http://[::1]:11434", Some("http://[::1]:11434")),
            ("[0:0:0:0:0:0:0:1]:11434", Some("http://[::1]:11434")),
            ("localhost", Some("http://localhost")),
            ("http://localhost:11434@attacker.example", None),
            ("localhost:11434@attacker.example", None),
            ("http://user@localhost:11434", None),
            ("http://user:secret@127.0.0.1:11434", None),
            ("http://attacker.example:11434", None),
            ("http://localhost.attacker.example:11434", None),
            ("http://8.8.8.8:11434", None),
            ("http://[2001:db8::1]:11434", None),
            ("http://0.0.0.0:11434", None),
            ("https://localhost:11434", None),
            ("ftp://localhost:11434", None),
            ("file:///etc/passwd", None),
            ("http://localhost:11434?x=1", None),
            ("http://localhost:11434#@attacker.example", None),
            ("http://localhost:99999", None),
            ("http://", None),
            ("http://[::1:11434", None),
        ] {
            assert_eq!(
                normalise_host(value).as_deref(),
                expected,
                "OLLAMA_HOST {value:?}"
            );
        }
    }

    #[test]
    fn a_local_endpoint_cannot_redirect_a_request_elsewhere() {
        use std::io::{Read, Write};

        let target = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        target.set_nonblocking(true).unwrap();
        let target_port = target.local_addr().unwrap().port();

        let redirector = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", redirector.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut stream, _) = redirector.accept().unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request);
            let response = format!(
                "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:{target_port}/api/version\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            stream.write_all(response.as_bytes()).unwrap();
        });

        let status = tauri::async_runtime::block_on(async {
            client(Some(REQUEST_TIMEOUT))
                .unwrap()
                .get(format!("{base}/api/version"))
                .send()
                .await
                .map(|response| response.status())
        })
        .unwrap();
        server.join().unwrap();

        assert_eq!(status, reqwest::StatusCode::FOUND);
        assert_eq!(
            target.accept().map(|_| ()).unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock,
            "the redirect was followed"
        );
    }

    #[test]
    fn a_rewrite_that_cannot_reach_ollama_fails_loudly() {
        let started = std::time::Instant::now();
        let result = tauri::async_runtime::block_on(async {
            rewrite_at("http://127.0.0.1:1", "qwen3.5:4b", "anything", "rewritten").await
        });
        assert!(result.is_err(), "got {result:?}");
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "failing took {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn the_rewrite_schema_leaves_no_room_for_commentary() {
        let field = "rewritten_in_klingon";
        let schema = rewrite_schema(field);

        assert_eq!(schema["type"], "object");
        assert_eq!(schema["required"], serde_json::json!([field]));
        assert_eq!(schema["additionalProperties"], serde_json::json!(false));
        assert_eq!(
            schema["properties"].as_object().map(serde_json::Map::len),
            Some(1)
        );

        let property = &schema["properties"][field];
        assert_eq!(property["type"], "string");
        assert_eq!(property["minLength"], serde_json::json!(1));

        assert_eq!(
            rewrite_schema("anything_at_all")["required"],
            serde_json::json!(["anything_at_all"])
        );

        assert!(REWRITE_TEMPERATURE < 0.5);
    }

    #[test]
    fn a_nudge_is_sampled_more_freely_than_a_rewrite() {
        assert!(NUDGE_TEMPERATURE > REWRITE_TEMPERATURE);
        assert!(NUDGE_TEMPERATURE <= 1.0);
    }

    #[test]
    fn a_failed_status_carries_ollamas_explanation() {
        assert_eq!(
            error_from(r#"{"error":"model 'qwen3.5:4b' not found"}"#).unwrap(),
            "model 'qwen3.5:4b' not found"
        );
        for silent in ["", "not json", "{}", r#"{"error":""}"#, r#"{"error":null}"#] {
            assert!(error_from(silent).is_none(), "{silent:?}");
        }
    }

    #[test]
    fn a_streamed_answer_is_assembled_out_of_its_frames() {
        let mut answer = Answer::default();
        absorb(
            "{\"response\":\"Ieri \",\"done\":false}\n\
             {\"response\":\"ho camminato \",\"done\":false}\n\
             {\"response\":\"perché è tardi.\",\"done\":true,\"done_reason\":\"stop\"}\n",
            &mut answer,
        )
        .unwrap();

        assert_eq!(answer.response, "Ieri ho camminato perché è tardi.");
        assert!(answer.thinking.is_empty());
        assert!(answer.readable);
    }

    #[test]
    fn unreadable_frames_are_skipped_and_an_unreadable_stream_is_named() {
        let mut answer = Answer::default();
        absorb(
            "not json\n[]\n42\n\"a string\"\n{\"response\":\"kept\"}\n   \n",
            &mut answer,
        )
        .unwrap();
        assert_eq!(answer.response, "kept");
        assert!(answer.readable);

        let mut nothing = Answer::default();
        absorb("not json\nnull\n[]\n", &mut nothing).unwrap();
        assert!(!nothing.readable);
        assert_eq!(
            read_rewrite(&nothing, "rewritten_in_english").unwrap_err(),
            AiError::UNREADABLE
        );

        let mut silent = Answer::default();
        absorb("{\"response\":\"\",\"done\":true}\n", &mut silent).unwrap();
        assert_eq!(
            read_rewrite(&silent, "rewritten_in_english").unwrap_err(),
            AiError::EMPTY
        );

        let mut reasoned = Answer::default();
        absorb(
            "{\"thinking\":\"Let me consider\"}\n{\"response\":\"\",\"done\":true}\n",
            &mut reasoned,
        )
        .unwrap();
        assert_eq!(
            read_rewrite(&reasoned, "rewritten_in_english").unwrap_err(),
            AiError::REASONED
        );
    }

    #[test]
    fn an_error_frame_ends_the_stream_with_ollamas_own_words() {
        let mut answer = Answer::default();
        let failure = absorb(
            "{\"response\":\"half an ans\",\"done\":false}\n\
             {\"error\":\"model requires more system memory\"}\n",
            &mut answer,
        )
        .unwrap_err();

        assert_eq!(failure, "ai:daemon model requires more system memory");

        let mut fine = Answer::default();
        assert!(absorb("{\"error\":\"\",\"response\":\"ok\"}\n", &mut fine).is_ok());
        assert_eq!(fine.response, "ok");
    }

    fn fake_daemon(script: Vec<(Duration, Option<&'static [u8]>)>) -> String {
        use std::io::{Read, Write};

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        std::thread::spawn(move || {
            let Ok((mut socket, _)) = listener.accept() else {
                return;
            };
            let mut buffer = [0_u8; 8192];
            let _ = socket.read(&mut buffer);
            let _ = socket.write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nConnection: close\r\n\r\n",
            );
            let _ = socket.flush();

            for (wait, line) in script {
                std::thread::sleep(wait);
                let Some(line) = line else {
                    std::thread::sleep(Duration::from_secs(5));
                    return;
                };
                if socket.write_all(line).is_err() {
                    return;
                }
                let _ = socket.flush();
            }
        });

        format!("http://127.0.0.1:{port}")
    }

    #[test]
    fn the_tag_sent_is_one_the_daemon_reported() {
        let daemon =
            |body: &'static [u8]| fake_daemon(vec![(Duration::from_millis(0), Some(body))]);

        let base = daemon(b"{\"models\":[{\"name\":\"qwen3.5:latest\"}]}");
        let tag = tauri::async_runtime::block_on(generation_tag_at(&base, "qwen3.5:9b"));
        assert_eq!(tag.as_deref(), Some("qwen3.5:latest"));

        let base = daemon(b"{\"models\":[{\"name\":\"qwen3.5:4b\"}]}");
        let tag = tauri::async_runtime::block_on(generation_tag_at(&base, "qwen3.5:9b"));
        assert_eq!(tag, None);
    }

    #[test]
    fn a_silent_daemon_does_not_turn_into_a_missing_model() {
        let started = std::time::Instant::now();
        let tag =
            tauri::async_runtime::block_on(generation_tag_at("http://127.0.0.1:1", "qwen3.5:9b"));
        assert_eq!(tag.as_deref(), Some("qwen3.5:9b"));
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "asking an absent daemon took {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn a_small_machine_is_advised_rather_than_restricted() {
        const FOUR_GB: u64 = GIGABYTE * 4;

        let (catalog, _) = join_catalog(&[], Some(FOUR_GB));
        assert_eq!(
            catalog.len(),
            CATALOG.len(),
            "a machine's memory must not take rows out of the catalogue"
        );

        let two_b = entry(&catalog, "qwen3.5:2b-q4_K_M");
        assert!(!two_b.recommended, "the 0.8B is the badge at this tier");
        assert_eq!(two_b.fits, Some(true));
        assert!(find_model("qwen3.5:2b-q4_K_M").is_some());

        let biggest = entry(&catalog, "qwen3.5:27b");
        assert_eq!(biggest.fits, Some(false));
        assert!(find_model(&biggest.id).is_some());

        assert!(find_model("qwen3.5:2b").is_none());
        assert!(!CATALOG.iter().any(|model| model.id == "qwen3.5:2b"));
    }

    #[test]
    fn a_small_machine_holds_a_model_for_less_time() {
        const GB: u64 = GIGABYTE;

        assert_eq!(keep_alive_for(Some(4 * GB)), KEEP_ALIVE_SMALL);
        assert_eq!(keep_alive_for(Some(8 * GB)), KEEP_ALIVE_SMALL);
        assert_eq!(keep_alive_for(Some(16 * GB)), KEEP_ALIVE_MEDIUM);
        assert_eq!(keep_alive_for(Some(32 * GB)), KEEP_ALIVE_LARGE);
        assert_eq!(keep_alive_for(Some(64 * GB)), KEEP_ALIVE_LARGE);
        assert_eq!(keep_alive_for(Some(128 * GB)), KEEP_ALIVE_LARGE);

        assert_eq!(keep_alive_for(Some(GB * 77 / 10)), KEEP_ALIVE_SMALL);
        assert_eq!(keep_alive_for(Some(GB * 158 / 10)), KEEP_ALIVE_MEDIUM);
        assert_eq!(keep_alive_for(Some(GB * 311 / 10)), KEEP_ALIVE_LARGE);

        assert_eq!(keep_alive_for(None), KEEP_ALIVE_SMALL);

        assert_eq!(EMBED_KEEP_ALIVE, KEEP_ALIVE_SMALL);
    }

    #[test]
    fn every_generation_says_how_long_to_stay_resident() {
        let reply = b"{\"response\":\"\",\"done\":true}\n";
        let policies = [KEEP_ALIVE_SMALL, KEEP_ALIVE_MEDIUM, KEEP_ALIVE_LARGE];

        let (base, sent) = recording_daemon(reply);
        let _ = tauri::async_runtime::block_on(stream_generate(
            &base,
            "qwen3.5:4b",
            "anything",
            rewrite_schema("rewritten_in_english"),
            REWRITE_CONTEXT_TOKENS,
            REWRITE_TEMPERATURE,
            "17s",
            Duration::from_millis(400),
        ));
        let body = sent_body(&sent);
        assert_eq!(body["keep_alive"], "17s");
        assert_eq!(body["think"], serde_json::json!(false));
        assert_eq!(body["options"]["num_ctx"], REWRITE_CONTEXT_TOKENS);

        for entry in ["rewrite", "nudge"] {
            let (base, sent) = recording_daemon(reply);
            let _ = tauri::async_runtime::block_on(async {
                match entry {
                    "rewrite" => rewrite_at(&base, "qwen3.5:4b", "p", "rewritten_in_english")
                        .await
                        .map(|_| ()),
                    _ => nudge_at(&base, "qwen3.5:4b", "p", "nudge_in_english")
                        .await
                        .map(|_| ()),
                }
            });
            let sent = sent_body(&sent);
            let carried = sent["keep_alive"]
                .as_str()
                .unwrap_or_else(|| panic!("{entry} sent no keep_alive at all"));
            assert!(
                policies.contains(&carried),
                "{entry} sent {carried}, which is not one of Wattle's policies"
            );
        }

        let (base, sent) = recording_daemon(b"{\"embeddings\":[[0.0]]}");
        let _ = tauri::async_runtime::block_on(embed_at(&base, EMBEDDING_MODEL, "text"));
        assert_eq!(sent_body(&sent)["keep_alive"], EMBED_KEEP_ALIVE);
    }

    fn recording_daemon(reply: &'static [u8]) -> (String, std::sync::mpsc::Receiver<String>) {
        use std::io::{Read, Write};

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let (sender, receiver) = std::sync::mpsc::channel();

        std::thread::spawn(move || {
            let Ok((mut socket, _)) = listener.accept() else {
                return;
            };
            let mut request = Vec::new();
            let mut chunk = [0_u8; 4096];
            while !request_is_whole(&request) {
                match socket.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => request.extend_from_slice(&chunk[..read]),
                }
            }
            let _ = sender.send(String::from_utf8_lossy(&request).into_owned());
            let _ = socket.write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nConnection: close\r\n\r\n",
            );
            let _ = socket.write_all(reply);
            let _ = socket.flush();
        });

        (format!("http://127.0.0.1:{port}"), receiver)
    }

    fn request_is_whole(bytes: &[u8]) -> bool {
        let Some(head_end) = bytes.windows(4).position(|four| four == b"\r\n\r\n") else {
            return false;
        };
        let head = String::from_utf8_lossy(&bytes[..head_end]);
        let declared = head
            .lines()
            .filter_map(|line| line.split_once(':'))
            .find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
            .and_then(|(_, value)| value.trim().parse::<usize>().ok())
            .unwrap_or(0);
        bytes.len() - (head_end + 4) >= declared
    }

    fn sent_body(receiver: &std::sync::mpsc::Receiver<String>) -> serde_json::Value {
        let request = receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("the daemon was never asked anything");
        let (_, body) = request
            .split_once("\r\n\r\n")
            .expect("a request with no body");
        serde_json::from_str(body).expect("the body was not JSON")
    }

    #[test]
    fn no_request_ever_asks_for_the_catalogue_context() {
        let reply = b"{\"response\":\"\",\"done\":true}\n";

        let (base, sent) = recording_daemon(reply);
        let _ = tauri::async_runtime::block_on(rewrite_at(
            &base,
            "qwen3.5:4b",
            "shorten this",
            "rewritten_in_english",
        ));
        let body = sent_body(&sent);
        assert_eq!(body["options"]["num_ctx"], REWRITE_CONTEXT_TOKENS);
        assert_eq!(body["think"], serde_json::json!(false));
        assert_eq!(body["model"], "qwen3.5:4b");

        let (base, sent) = recording_daemon(reply);
        let _ = tauri::async_runtime::block_on(nudge_at(
            &base,
            "qwen3.5:4b",
            "invite something",
            "nudge_in_english",
        ));
        assert_eq!(
            sent_body(&sent)["options"]["num_ctx"],
            REWRITE_CONTEXT_TOKENS
        );

        let advertised = u64::from(find_model("qwen3.5:4b").unwrap().context_tokens);
        assert_eq!(advertised, 262_144);
        assert!(u64::from(REWRITE_CONTEXT_TOKENS) < advertised / 32);
    }

    #[test]
    fn a_daemon_that_goes_silent_is_abandoned_on_the_gap() {
        let base = fake_daemon(vec![
            (
                Duration::from_millis(20),
                Some(b"{\"response\":\"a start\",\"done\":false}\n"),
            ),
            (Duration::from_millis(0), None),
        ]);

        let started = std::time::Instant::now();
        let result = tauri::async_runtime::block_on(async {
            stream_generate(
                &base,
                "qwen3.5:4b",
                "anything",
                rewrite_schema("rewritten_in_english"),
                REWRITE_CONTEXT_TOKENS,
                REWRITE_TEMPERATURE,
                KEEP_ALIVE_SMALL,
                Duration::from_millis(300),
            )
            .await
        });

        assert_eq!(result.unwrap_err(), AiError::TIMEOUT);
        assert!(
            started.elapsed() < Duration::from_secs(3),
            "a silent daemon took {:?} to fail",
            started.elapsed()
        );
    }

    #[test]
    fn a_slow_but_living_stream_is_never_cut_off() {
        let step = Duration::from_millis(120);
        let base = fake_daemon(vec![
            (step, Some(b"{\"response\":\"one \",\"done\":false}\n")),
            (step, Some(b"{\"response\":\"two \",\"done\":false}\n")),
            (step, Some(b"{\"response\":\"three\",\"done\":false}\n")),
            (step, Some(b"{\"response\":\"\",\"done\":true}\n")),
        ]);

        let started = std::time::Instant::now();
        let answer = tauri::async_runtime::block_on(async {
            stream_generate(
                &base,
                "qwen3.5:4b",
                "anything",
                rewrite_schema("rewritten_in_english"),
                REWRITE_CONTEXT_TOKENS,
                REWRITE_TEMPERATURE,
                KEEP_ALIVE_SMALL,
                Duration::from_millis(400),
            )
            .await
        })
        .unwrap();

        assert_eq!(answer.response, "one two three");
        assert!(
            started.elapsed() >= step * 4,
            "the stream finished too quickly to have been slow: {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn a_frame_arriving_in_pieces_is_read_whole() {
        let base = fake_daemon(vec![
            (
                Duration::from_millis(10),
                Some(b"{\"response\":\"perch\xc3"),
            ),
            (
                Duration::from_millis(40),
                Some(b"\xa9 tardi\",\"done\":true}\n"),
            ),
        ]);

        let answer = tauri::async_runtime::block_on(async {
            stream_generate(
                &base,
                "qwen3.5:4b",
                "anything",
                rewrite_schema("rewritten_in_english"),
                REWRITE_CONTEXT_TOKENS,
                REWRITE_TEMPERATURE,
                KEEP_ALIVE_SMALL,
                Duration::from_millis(500),
            )
            .await
        })
        .unwrap();

        assert_eq!(answer.response, "perché tardi");
    }

    #[test]
    fn a_daemon_that_is_not_there_answers_that_it_is_not_there() {
        let started = std::time::Instant::now();
        let version =
            tauri::async_runtime::block_on(async { version_at("http://127.0.0.1:1").await });
        assert!(version.is_none());
        assert!(tauri::async_runtime::block_on(async {
            installed_tags_at("http://127.0.0.1:1").await
        })
        .is_empty());
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "probing a closed port took {:?}",
            started.elapsed()
        );
    }
}
