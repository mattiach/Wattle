//! Walks a Tiptap document.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

/// Matches the excerpt length the entry list has always shown.
pub const PREVIEW_MAX_LENGTH: usize = 240;

/// Guards against a pathologically nested document exhausting the stack.
const MAX_DEPTH: usize = 128;

/// Everything the entries table stores about an entry's content besides the
/// document itself.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Derived {
    pub text: String,
    pub preview: String,
    pub word_count: i64,
}

/// Derives the stored columns from an entry's raw `content` JSON.
pub fn derive(content_json: &str) -> Derived {
    let Ok(document) = serde_json::from_str::<Value>(content_json) else {
        return Derived::default();
    };
    let text = to_plain_text(&document);
    Derived {
        preview: to_preview(&text),
        word_count: word_count(&text),
        text,
    }
}

/// Flattens a document to plain text: inline text is concatenated as written,
/// blocks are separated by a newline.
pub fn to_plain_text(document: &Value) -> String {
    let mut out = String::new();
    walk_text(document, &mut out, 0);
    out.trim_end().to_string()
}

fn walk_text(node: &Value, out: &mut String, depth: usize) {
    if depth > MAX_DEPTH {
        return;
    }

    if let Some(text) = node.get("text").and_then(Value::as_str) {
        out.push_str(text);
        return;
    }

    let node_type = node.get("type").and_then(Value::as_str).unwrap_or_default();

    if node_type == "hardBreak" {
        out.push('\n');
        return;
    }

    if let Some(children) = node.get("content").and_then(Value::as_array) {
        for child in children {
            walk_text(child, out, depth + 1);
        }
    }

    if node_type != "doc" && !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
}

/// The list excerpt: the opening of the plain text on a single line.
pub fn to_preview(text: &str) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed
        .chars()
        .take(PREVIEW_MAX_LENGTH)
        .collect::<String>()
        .trim_end()
        .to_string()
}

pub fn word_count(text: &str) -> i64 {
    text.split_whitespace().count() as i64
}

/// Every attachment id the document still references.
#[allow(dead_code)]
pub fn collect_attachment_ids(document: &Value) -> BTreeSet<i64> {
    let mut ids = BTreeSet::new();
    walk_attachments(document, &mut ids, 0);
    ids
}

fn walk_attachments(node: &Value, ids: &mut BTreeSet<i64>, depth: usize) {
    if depth > MAX_DEPTH {
        return;
    }

    if let Some(id) = node
        .get("attrs")
        .and_then(|attrs| attrs.get("attachmentId"))
        .and_then(Value::as_i64)
    {
        ids.insert(id);
    }

    if let Some(children) = node.get("content").and_then(Value::as_array) {
        for child in children {
            walk_attachments(child, ids, depth + 1);
        }
    }
}

/// The children of a node, or nothing at all - a node without content and a
/// node whose content is the wrong shape are the same thing to the walk.
fn children(node: &Value) -> &[Value] {
    node.get("content")
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}

/// Where an attachment is reached from the file that references it, and what to
/// call it there.
pub struct AttachmentLink {
    pub href: String,
    pub label: String,
}

/// The link for an attachment node: what the export decided, or - when the
/// attachment row has gone but the document still references it - the path the
/// document itself carries, so the reference is at least visible.
fn resolve_attachment(
    node: &Value,
    links: &BTreeMap<i64, AttachmentLink>,
) -> Option<(String, String)> {
    if let Some(link) = attr(node, "attachmentId")
        .and_then(Value::as_i64)
        .and_then(|id| links.get(&id))
    {
        return Some((link.label.clone(), link.href.clone()));
    }
    let path = attr(node, "path").and_then(Value::as_str)?;
    Some((
        path.rsplit('/').next().unwrap_or(path).to_string(),
        path.to_string(),
    ))
}

fn attr<'a>(node: &'a Value, name: &str) -> Option<&'a Value> {
    node.get("attrs")?.get(name)
}

/// The text of a code block, verbatim: no marks apply inside one.
fn raw_text(nodes: &[Value]) -> String {
    let mut out = String::new();
    for node in nodes {
        if let Some(text) = node.get("text").and_then(Value::as_str) {
            out.push_str(text);
        } else if node.get("type").and_then(Value::as_str) == Some("hardBreak") {
            out.push('\n');
        }
    }
    out
}

/// Turns text into markup-safe text.
pub fn escape_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(character),
        }
    }
    out
}

/// A link that cannot execute anything when the archive is opened from disk.
fn safe_href(href: &str) -> Option<&str> {
    let href = href.trim();
    let lowered = href.to_ascii_lowercase();
    if ["http://", "https://", "mailto:"]
        .iter()
        .any(|scheme| lowered.starts_with(scheme))
    {
        return Some(href);
    }
    let has_scheme = lowered.split_once(':').is_some_and(|(scheme, _)| {
        !scheme.is_empty()
            && scheme
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
    });
    if has_scheme {
        None
    } else {
        Some(href)
    }
}

/// Renders a document as HTML, off the same walk everything else uses.
pub fn to_html(document: &Value, links: &BTreeMap<i64, AttachmentLink>) -> String {
    let html = Html { links };
    html.blocks(children(document), 0)
}

struct Html<'a> {
    links: &'a BTreeMap<i64, AttachmentLink>,
}

impl Html<'_> {
    fn blocks(&self, nodes: &[Value], depth: usize) -> String {
        nodes
            .iter()
            .map(|node| self.block(node, depth))
            .filter(|rendered| !rendered.is_empty())
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn block(&self, node: &Value, depth: usize) -> String {
        if depth > MAX_DEPTH {
            return String::new();
        }
        if node.get("text").is_some() {
            return format!("<p>{}</p>", self.inline(std::slice::from_ref(node), depth));
        }

        let node_type = node.get("type").and_then(Value::as_str).unwrap_or_default();
        let kids = children(node);

        match node_type {
            "paragraph" => format!("<p{}>{}</p>", align(node), self.inline(kids, depth)),
            "heading" => {
                let level = attr(node, "level")
                    .and_then(Value::as_u64)
                    .unwrap_or(1)
                    .clamp(1, 6);
                format!(
                    "<h{level}{}>{}</h{level}>",
                    align(node),
                    self.inline(kids, depth)
                )
            }
            "codeBlock" => {
                let language = attr(node, "language").and_then(Value::as_str).unwrap_or("");
                let class = if language.is_empty() {
                    String::new()
                } else {
                    format!(" class=\"language-{}\"", escape_html(language))
                };
                format!(
                    "<pre><code{class}>{}</code></pre>",
                    escape_html(&raw_text(kids))
                )
            }
            "blockquote" => wrap_block(
                "<blockquote>",
                &self.blocks(kids, depth + 1),
                "</blockquote>",
            ),
            "horizontalRule" => "<hr>".to_string(),
            "bulletList" => wrap_block("<ul>", &self.items(kids, depth), "</ul>"),
            "orderedList" => {
                let start = attr(node, "start").and_then(Value::as_u64).unwrap_or(1);
                let open = if start == 1 {
                    "<ol>".to_string()
                } else {
                    format!("<ol start=\"{start}\">")
                };
                wrap_block(&open, &self.items(kids, depth), "</ol>")
            }
            "taskList" => wrap_block("<ul class=\"tasks\">", &self.items(kids, depth), "</ul>"),
            "imageAttachment" => self
                .attachment(node)
                .map(|(alt, src)| {
                    format!(
                        "<p class=\"figure\"{}><img alt=\"{alt}\" src=\"{src}\"{}></p>",
                        align(node),
                        width_style(node)
                    )
                })
                .unwrap_or_default(),
            "videoAttachment" => self
                .attachment(node)
                .map(|(_, src)| {
                    format!(
                        "<p class=\"figure\"{}><video controls src=\"{src}\"{}></video></p>",
                        align(node),
                        width_style(node)
                    )
                })
                .unwrap_or_default(),
            "fileAttachment" => self
                .attachment(node)
                .map(|(label, href)| {
                    format!("<p class=\"file\"><a href=\"{href}\">{label}</a></p>")
                })
                .unwrap_or_default(),
            _ => self.blocks(kids, depth + 1),
        }
    }

    fn items(&self, items: &[Value], depth: usize) -> String {
        items
            .iter()
            .map(|item| {
                let is_task =
                    item.get("type").and_then(Value::as_str) == Some("taskItem");
                let checked = attr(item, "checked")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);

                let body = children(item)
                    .iter()
                    .map(|child| {
                        if child.get("type").and_then(Value::as_str) == Some("paragraph") {
                            self.inline(children(child), depth + 1)
                        } else {
                            self.block(child, depth + 1)
                        }
                    })
                    .filter(|rendered| !rendered.is_empty())
                    .collect::<Vec<_>>()
                    .join("\n");

                if is_task {
                    let state = if checked { " checked" } else { "" };
                    let class = if checked { "task done" } else { "task" };
                    format!(
                        "<li class=\"{class}\"><input disabled type=\"checkbox\"{state}> {body}</li>"
                    )
                } else {
                    format!("<li>{body}</li>")
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn inline(&self, nodes: &[Value], depth: usize) -> String {
        let mut out = String::new();
        self.walk_inline(nodes, &mut out, depth);
        out
    }

    fn walk_inline(&self, nodes: &[Value], out: &mut String, depth: usize) {
        if depth > MAX_DEPTH {
            return;
        }
        for node in nodes {
            if let Some(text) = node.get("text").and_then(Value::as_str) {
                out.push_str(&wrap_marks(
                    &escape_html(text),
                    node.get("marks")
                        .and_then(Value::as_array)
                        .map_or(&[], Vec::as_slice),
                ));
            } else if node.get("type").and_then(Value::as_str) == Some("hardBreak") {
                out.push_str("<br>");
            } else {
                self.walk_inline(children(node), out, depth + 1);
            }
        }
    }

    /// The alt text and source for an attachment node, both already escaped.
    fn attachment(&self, node: &Value) -> Option<(String, String)> {
        let (label, href) = resolve_attachment(node, self.links)?;
        Some((escape_html(&label), escape_html(&href)))
    }
}

/// A container around its children, or nothing at all when there are none.
fn wrap_block(open: &str, body: &str, close: &str) -> String {
    if body.is_empty() {
        String::new()
    } else {
        format!("{open}\n{body}\n{close}")
    }
}

/// Only the alignments the editor can produce, and only as a fixed string, so
/// the attribute cannot carry anything else into the style attribute.
fn align(node: &Value) -> String {
    match attr(node, "textAlign").and_then(Value::as_str) {
        Some(value @ ("center" | "right" | "justify")) => {
            format!(" style=\"text-align:{value}\"")
        }
        _ => String::new(),
    }
}

/// The width the writer dragged a figure to, as a style attribute or nothing.
fn width_style(node: &Value) -> String {
    attr(node, "width")
        .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
        .map(|width| format!(" style=\"width:{width}px\""))
        .unwrap_or_default()
}

/// The HTML counterpart of `apply_marks`, in the same inside-out order.
fn wrap_marks(escaped_text: &str, marks: &[Value]) -> String {
    let has = |name: &str| {
        marks
            .iter()
            .any(|mark| mark.get("type").and_then(Value::as_str) == Some(name))
    };

    let mut out = escaped_text.to_string();
    for (name, open, close) in [
        ("code", "<code>", "</code>"),
        ("bold", "<strong>", "</strong>"),
        ("italic", "<em>", "</em>"),
        ("strike", "<s>", "</s>"),
        ("underline", "<u>", "</u>"),
    ] {
        if has(name) {
            out = format!("{open}{out}{close}");
        }
    }

    if let Some(href) = marks
        .iter()
        .find(|mark| mark.get("type").and_then(Value::as_str) == Some("link"))
        .and_then(|mark| mark.get("attrs")?.get("href"))
        .and_then(Value::as_str)
        .and_then(safe_href)
    {
        out = format!(
            "<a href=\"{}\" rel=\"noopener noreferrer\">{out}</a>",
            escape_html(href)
        );
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document(json: &str) -> Value {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn empty_document_derives_nothing() {
        let derived = derive(r#"{"type":"doc","content":[]}"#);
        assert_eq!(derived, Derived::default());
    }

    #[test]
    fn inline_runs_are_concatenated_so_a_phrase_survives_a_mark() {
        let doc = document(
            r#"{"type":"doc","content":[{"type":"paragraph","content":[
                {"type":"text","text":"a "},
                {"type":"text","marks":[{"type":"bold"}],"text":"bold"},
                {"type":"text","text":" word"}]}]}"#,
        );
        assert_eq!(to_plain_text(&doc), "a bold word");
    }

    #[test]
    fn blocks_are_separated_by_newlines() {
        let doc = document(
            r#"{"type":"doc","content":[
                {"type":"paragraph","content":[{"type":"text","text":"first"}]},
                {"type":"paragraph","content":[{"type":"text","text":"second"}]}]}"#,
        );
        assert_eq!(to_plain_text(&doc), "first\nsecond");
    }

    #[test]
    fn nested_lists_do_not_produce_blank_lines() {
        let doc = document(
            r#"{"type":"doc","content":[{"type":"bulletList","content":[
                {"type":"listItem","content":[{"type":"paragraph","content":[
                    {"type":"text","text":"outer"}]},
                {"type":"bulletList","content":[{"type":"listItem","content":[
                    {"type":"paragraph","content":[{"type":"text","text":"inner"}]}]}]}]}]}]}"#,
        );
        assert_eq!(to_plain_text(&doc), "outer\ninner");
    }

    #[test]
    fn hard_breaks_become_newlines() {
        let doc = document(
            r#"{"type":"doc","content":[{"type":"paragraph","content":[
                {"type":"text","text":"one"},{"type":"hardBreak"},
                {"type":"text","text":"two"}]}]}"#,
        );
        assert_eq!(to_plain_text(&doc), "one\ntwo");
    }

    #[test]
    fn every_node_type_the_editor_can_produce_is_flattened() {
        let doc = document(
            r#"{"type":"doc","content":[
                {"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"Title"}]},
                {"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"quoted"}]}]},
                {"type":"codeBlock","content":[{"type":"text","text":"let x = 1;"}]},
                {"type":"horizontalRule"},
                {"type":"orderedList","content":[{"type":"listItem","content":[
                    {"type":"paragraph","content":[{"type":"text","text":"numbered"}]}]}]},
                {"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":true},"content":[
                    {"type":"paragraph","content":[{"type":"text","text":"done"}]}]}]},
                {"type":"imageAttachment","attrs":{"attachmentId":7,"path":"attachments/1/7.png"}},
                {"type":"paragraph","content":[{"type":"text","marks":[
                    {"type":"link","attrs":{"href":"https://example.com"}}],"text":"a link"}]}]}"#,
        );
        assert_eq!(
            to_plain_text(&doc),
            "Title\nquoted\nlet x = 1;\nnumbered\ndone\na link"
        );
    }

    #[test]
    fn unknown_node_types_are_transparent_and_never_panic() {
        let doc = document(
            r#"{"type":"doc","content":[
                {"type":"somethingFromTheFuture","attrs":{"whatever":true},"content":[
                    {"type":"alsoUnknown","content":[{"type":"text","text":"still readable"}]}]}]}"#,
        );
        assert_eq!(to_plain_text(&doc), "still readable");
    }

    #[test]
    fn malformed_or_surprising_content_degrades_instead_of_failing() {
        assert_eq!(derive("not json at all"), Derived::default());
        assert_eq!(derive(""), Derived::default());
        assert_eq!(derive("null"), Derived::default());
        assert_eq!(derive("[]"), Derived::default());
        assert_eq!(derive("42"), Derived::default());
        assert_eq!(derive(r#"{"type":"doc"}"#), Derived::default());
        assert_eq!(
            derive(r#"{"type":"doc","content":[null,3,"loose string",{"type":"paragraph"}]}"#).text,
            ""
        );
    }

    #[test]
    fn absurdly_nested_json_is_refused_by_the_parser_not_by_a_crash() {
        let mut json = String::new();
        for _ in 0..5_000 {
            json.push_str(r#"{"type":"blockquote","content":["#);
        }
        json.push_str(r#"{"type":"text","text":"deep"}"#);
        for _ in 0..5_000 {
            json.push_str("]}");
        }
        assert_eq!(derive(&json), Derived::default());
    }

    #[test]
    fn the_walker_itself_stops_at_max_depth() {
        let mut node = serde_json::json!({"type": "text", "text": "deep"});
        for _ in 0..(MAX_DEPTH + 50) {
            node = serde_json::json!({"type": "blockquote", "content": [node]});
        }
        assert_eq!(to_plain_text(&node), "");
        assert!(collect_attachment_ids(&node).is_empty());
    }

    #[test]
    fn preview_collapses_whitespace_and_truncates_on_a_character_boundary() {
        let text = "first\nsecond   third";
        assert_eq!(to_preview(text), "first second third");

        let long = "é".repeat(PREVIEW_MAX_LENGTH + 50);
        let preview = to_preview(&long);
        assert_eq!(preview.chars().count(), PREVIEW_MAX_LENGTH);
    }

    #[test]
    fn word_count_counts_words_not_characters() {
        assert_eq!(word_count(""), 0);
        assert_eq!(word_count("one"), 1);
        assert_eq!(word_count("one two\nthree   four"), 4);
    }

    #[test]
    fn derive_produces_all_three_columns_together() {
        let derived = derive(
            r#"{"type":"doc","content":[{"type":"paragraph","content":[
                {"type":"text","text":"Hello "},
                {"type":"text","marks":[{"type":"italic"}],"text":"world"}]}]}"#,
        );
        assert_eq!(derived.text, "Hello world");
        assert_eq!(derived.preview, "Hello world");
        assert_eq!(derived.word_count, 2);
    }

    #[test]
    fn attachment_ids_are_collected_from_anywhere_in_the_document() {
        let doc = document(
            r#"{"type":"doc","content":[
                {"type":"imageAttachment","attrs":{"attachmentId":3}},
                {"type":"blockquote","content":[
                    {"type":"paragraph","content":[
                        {"type":"fileAttachment","attrs":{"attachmentId":1}}]}]},
                {"type":"videoAttachment","attrs":{"attachmentId":2}},
                {"type":"futureAttachment","attrs":{"attachmentId":9}},
                {"type":"paragraph","attrs":{"textAlign":"center"},"content":[
                    {"type":"text","text":"no id here"}]}]}"#,
        );
        assert_eq!(
            collect_attachment_ids(&doc).into_iter().collect::<Vec<_>>(),
            vec![1, 2, 3, 9]
        );
    }

    #[test]
    fn a_document_without_attachments_yields_none() {
        let doc = document(
            r#"{"type":"doc","content":[{"type":"paragraph","content":[
                {"type":"text","text":"plain"}]}]}"#,
        );
        assert!(collect_attachment_ids(&doc).is_empty());
    }

    fn folder_link(path: &str, label: &str) -> AttachmentLink {
        AttachmentLink {
            href: format!("../../{path}"),
            label: label.to_string(),
        }
    }

    #[test]
    fn attachments_use_the_link_the_export_decided_on() {
        let doc = document(
            r#"{"type":"doc","content":[
                {"type":"imageAttachment","attrs":{"attachmentId":7,"path":"attachments/1/7.png"}},
                {"type":"videoAttachment","attrs":{"attachmentId":8,"path":"attachments/1/8.mp4"}},
                {"type":"fileAttachment","attrs":{"attachmentId":9,"path":"attachments/1/9.pdf"}},
                {"type":"imageAttachment","attrs":{"attachmentId":10}}]}"#,
        );
        let links = BTreeMap::from([
            (7, folder_link("attachments/1/7.png", "holiday photo.png")),
            (8, folder_link("attachments/1/8.mp4", "clip.mp4")),
        ]);

        let rendered = to_html(&doc, &links);
        assert!(
            rendered.contains("<img alt=\"holiday photo.png\" src=\"../../attachments/1/7.png\">")
        );
        assert!(rendered.contains("<video controls src=\"../../attachments/1/8.mp4\">"));
        assert!(rendered.contains("<a href=\"attachments/1/9.pdf\">9.pdf</a>"));
    }

    #[test]
    fn an_attachment_the_export_never_mentioned_falls_back_to_the_documents_path() {
        let doc = document(
            r#"{"type":"doc","content":[
                {"type":"imageAttachment","attrs":{"attachmentId":9,"path":"attachments/1/9.png"}},
                {"type":"imageAttachment","attrs":{"attachmentId":10}}]}"#,
        );
        assert_eq!(
            to_html(&doc, &BTreeMap::new()),
            "<p class=\"figure\"><img alt=\"9.png\" src=\"attachments/1/9.png\"></p>"
        );
    }

    fn html(json: &str) -> String {
        to_html(&document(json), &BTreeMap::new())
    }

    #[test]
    fn every_block_the_editor_can_produce_has_an_html_spelling() {
        let rendered = html(
            r#"{"type":"doc","content":[
                {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Title"}]},
                {"type":"paragraph","content":[{"type":"text","text":"A paragraph."}]},
                {"type":"blockquote","content":[
                    {"type":"paragraph","content":[{"type":"text","text":"quoted"}]}]},
                {"type":"codeBlock","attrs":{"language":"rust"},
                    "content":[{"type":"text","text":"let x = 1;"}]},
                {"type":"horizontalRule"},
                {"type":"paragraph","content":[
                    {"type":"text","text":"one"},{"type":"hardBreak"},{"type":"text","text":"two"}]}]}"#,
        );

        assert_eq!(
            rendered,
            "<h2>Title</h2>\n\
             <p>A paragraph.</p>\n\
             <blockquote>\n<p>quoted</p>\n</blockquote>\n\
             <pre><code class=\"language-rust\">let x = 1;</code></pre>\n\
             <hr>\n\
             <p>one<br>two</p>"
        );
    }

    #[test]
    fn html_lists_nest_inside_their_item_and_tasks_carry_their_state() {
        let rendered = html(
            r#"{"type":"doc","content":[
                {"type":"bulletList","content":[
                    {"type":"listItem","content":[
                        {"type":"paragraph","content":[{"type":"text","text":"outer"}]},
                        {"type":"bulletList","content":[{"type":"listItem","content":[
                            {"type":"paragraph","content":[{"type":"text","text":"inner"}]}]}]}]}]},
                {"type":"orderedList","attrs":{"start":3},"content":[
                    {"type":"listItem","content":[
                        {"type":"paragraph","content":[{"type":"text","text":"third"}]}]}]},
                {"type":"taskList","content":[
                    {"type":"taskItem","attrs":{"checked":true},"content":[
                        {"type":"paragraph","content":[{"type":"text","text":"done"}]}]},
                    {"type":"taskItem","attrs":{"checked":false},"content":[
                        {"type":"paragraph","content":[{"type":"text","text":"todo"}]}]}]}]}"#,
        );

        assert_eq!(
            rendered,
            "<ul>\n<li>outer\n<ul>\n<li>inner</li>\n</ul></li>\n</ul>\n\
             <ol start=\"3\">\n<li>third</li>\n</ol>\n\
             <ul class=\"tasks\">\n\
             <li class=\"task done\"><input disabled type=\"checkbox\" checked> done</li>\n\
             <li class=\"task\"><input disabled type=\"checkbox\"> todo</li>\n\
             </ul>"
        );
    }

    #[test]
    fn user_text_can_never_become_markup() {
        let rendered = html(
            r#"{"type":"doc","content":[
                {"type":"paragraph","content":[
                    {"type":"text","text":"<script>alert('x' & \"y\")</script>"}]},
                {"type":"codeBlock","content":[
                    {"type":"text","text":"if (a < b && c > d) {}"}]},
                {"type":"imageAttachment","attrs":{"attachmentId":1,
                    "path":"attachments/1/\"><script>bad</script>.png"}}]}"#,
        );

        assert!(!rendered.contains("<script>"), "got {rendered}");
        assert!(rendered.contains("&lt;script&gt;alert(&#39;x&#39; &amp; &quot;y&quot;)"));
        assert!(rendered.contains("if (a &lt; b &amp;&amp; c &gt; d) {}"));
        assert!(rendered.contains("&quot;&gt;&lt;script&gt;"));

        assert_eq!(
            escape_html("a<b>&\"c\"'"),
            "a&lt;b&gt;&amp;&quot;c&quot;&#39;"
        );
    }

    #[test]
    fn a_link_that_would_execute_keeps_its_text_and_loses_its_link() {
        for dangerous in [
            "javascript:alert(1)",
            "JavaScript:alert(1)",
            "  javascript:alert(1)  ",
            "data:text/html,<script>alert(1)</script>",
            "vbscript:msgbox",
        ] {
            let rendered = html(&format!(
                r#"{{"type":"doc","content":[{{"type":"paragraph","content":[
                    {{"type":"text","marks":[{{"type":"link","attrs":{{"href":{}}}}}],
                      "text":"click me"}}]}}]}}"#,
                serde_json::to_string(dangerous).unwrap()
            ));
            assert_eq!(rendered, "<p>click me</p>", "href {dangerous:?} survived");
        }

        for safe in [
            "https://example.com/a?b=1&c=2",
            "http://example.com",
            "mailto:someone@example.com",
            "../another.html",
            "#section",
        ] {
            let rendered = html(&format!(
                r#"{{"type":"doc","content":[{{"type":"paragraph","content":[
                    {{"type":"text","marks":[{{"type":"link","attrs":{{"href":{}}}}}],
                      "text":"link"}}]}}]}}"#,
                serde_json::to_string(safe).unwrap()
            ));
            assert!(
                rendered.contains("<a href=") && rendered.contains("rel=\"noopener noreferrer\""),
                "href {safe:?} was dropped: {rendered}"
            );
        }
    }

    #[test]
    fn a_clip_exports_at_the_width_and_alignment_it_was_given() {
        let rendered = html(
            r#"{"type":"doc","content":[{"type":"videoAttachment",
                "attrs":{"attachmentId":2,"path":"attachments/1/2.mp4",
                    "textAlign":"center","width":360}}]}"#,
        );
        assert!(rendered.contains("<p class=\"figure\" style=\"text-align:center\">"));
        assert!(rendered.contains("src=\"attachments/1/2.mp4\" style=\"width:360px\""));

        let plain = html(
            r#"{"type":"doc","content":[{"type":"videoAttachment",
                "attrs":{"attachmentId":2,"path":"attachments/1/2.mp4"}}]}"#,
        );
        assert!(plain.contains("<p class=\"figure\"><video controls src=\"attachments/1/2.mp4\">"));

        let nonsense = html(
            r#"{"type":"doc","content":[{"type":"videoAttachment",
                "attrs":{"attachmentId":2,"path":"attachments/1/2.mp4",
                    "textAlign":"onclick=x","width":"not a number"}}]}"#,
        );
        assert!(nonsense.contains("<p class=\"figure\"><video controls"));
        assert!(!nonsense.contains("style="));
    }

    #[test]
    fn html_keeps_the_alignment_and_width_the_editor_was_given() {
        let rendered = html(
            r#"{"type":"doc","content":[
                {"type":"paragraph","attrs":{"textAlign":"center"},"content":[
                    {"type":"text","text":"centred"}]},
                {"type":"heading","attrs":{"level":1,"textAlign":"right"},"content":[
                    {"type":"text","text":"right"}]},
                {"type":"paragraph","attrs":{"textAlign":"onclick=x"},"content":[
                    {"type":"text","text":"nonsense"}]},
                {"type":"imageAttachment","attrs":{"attachmentId":1,
                    "path":"attachments/1/1.png","width":420}}]}"#,
        );

        assert!(rendered.contains("<p style=\"text-align:center\">centred</p>"));
        assert!(rendered.contains("<h1 style=\"text-align:right\">right</h1>"));
        assert!(rendered.contains("<p>nonsense</p>"));
        assert!(rendered.contains("src=\"attachments/1/1.png\" style=\"width:420px\""));

        let centred = html(
            r#"{"type":"doc","content":[{"type":"imageAttachment",
                "attrs":{"attachmentId":1,"path":"attachments/1/1.png","textAlign":"center"}}]}"#,
        );
        assert!(centred.contains("<p class=\"figure\" style=\"text-align:center\">"));
    }

    #[test]
    fn html_marks_nest_from_the_inside_out_and_unknown_nodes_stay_transparent() {
        let rendered = html(
            r#"{"type":"doc","content":[
                {"type":"paragraph","content":[
                    {"type":"text","marks":[{"type":"bold"},{"type":"italic"}],"text":"both"},
                    {"type":"text","marks":[{"type":"code"}],"text":"c"},
                    {"type":"text","marks":[{"type":"strike"}],"text":"s"},
                    {"type":"text","marks":[{"type":"underline"}],"text":"u"}]},
                {"type":"nodeFromAFutureRelease","content":[
                    {"type":"paragraph","content":[{"type":"text","text":"still readable"}]}]}]}"#,
        );

        assert_eq!(
            rendered,
            "<p><em><strong>both</strong></em><code>c</code><s>s</s><u>u</u></p>\n\
             <p>still readable</p>"
        );
    }

    #[test]
    fn html_degrades_instead_of_failing_on_surprising_content() {
        assert_eq!(html(r#"{"type":"doc","content":[]}"#), "");
        assert_eq!(html(r#"{"type":"doc"}"#), "");
        assert_eq!(html(r#"{"type":"doc","content":[null,3]}"#), "");

        let mut node = serde_json::json!({"type": "text", "text": "deep"});
        for _ in 0..(MAX_DEPTH + 50) {
            node = serde_json::json!({"type": "blockquote", "content": [node]});
        }
        assert_eq!(to_html(&node, &BTreeMap::new()), "");
    }
}
