import type { JSONContent } from "@tiptap/core";

/**
 * Sparks as plain text, over the storage every other kind of entry uses.
 *
 * A spark is a *product* rule, not a storage format: it is still a Tiptap
 * document in `entries.content`, because four subsystems read that column as
 * JSON - the derived `content_text` / `preview` / `word_count`, the FTS
 * triggers that index them, the exporter, and attachment reconciliation. Store
 * anything else and a spark quietly leaves search and exports as source code.
 *
 * So the composer flattens on the way in and on the way out, and everything
 * downstream keeps working with no change at all.
 */

/**
 * How long a thought may be.
 *
 * Enforced here and on the textarea, deliberately nowhere else: a limit is a
 * product rule, not a trust boundary, and an existing spark written before it
 * must never become unsaveable. Sparks longer than this are shown in full and
 * stay editable.
 */
export const SPARK_MAX_CHARS = 280;

/** The point past which the counter is worth showing at all. */
export const SPARK_COUNTER_THRESHOLD = Math.round(SPARK_MAX_CHARS * 0.8);

/** Trailing block breaks, which `to_plain_text` also trims on the Rust side. */
const TRAILING_NEWLINES = /\n+$/;

const paragraph = (line: string): JSONContent =>
  line
    ? { content: [{ text: line, type: "text" }], type: "paragraph" }
    : { type: "paragraph" };

/**
 * Text as the canonical minimal document.
 *
 * Newlines become separate paragraphs, so a two-line spark survives the round
 * trip back through `docToText`.
 */
export const textToDoc = (text: string): JSONContent => ({
  content: text.split("\n").map(paragraph),
  type: "doc",
});

/**
 * A document back as text.
 *
 * Mirrors `content.rs::to_plain_text`: text nodes concatenate, a hard break and
 * the end of any block close a line, and unknown node types are transparent
 * containers rather than an error. That last property is what keeps a legacy
 * spark readable here even though this composer could never have produced it.
 */
export const docToText = (doc: JSONContent): string => {
  let out = "";

  const walk = (node: JSONContent) => {
    if (typeof node.text === "string") {
      out += node.text;
      return;
    }
    if (node.type === "hardBreak") {
      out += "\n";
      return;
    }
    for (const child of node.content ?? []) {
      walk(child);
    }
    if (node.type !== "doc" && out !== "" && !out.endsWith("\n")) {
      out += "\n";
    }
  };

  walk(doc);
  return out.replace(TRAILING_NEWLINES, "");
};

/**
 * Whether a spark is one the plain composer could have written.
 *
 * Legacy sparks can hold anything the full entry editor can produce, because
 * until now "Edit" on a spark card opened exactly that editor. None of it is
 * invalid - it is simply richer than the new composer - so it is detected and
 * routed rather than converted. Nothing is transformed, so nothing can be lost.
 *
 * The length is *not* part of the test: a spark written before the limit
 * existed is still a plain spark, and must stay editable where it was written.
 */
export const isPlainSpark = (doc: JSONContent): boolean => {
  const isPlainInline = (node: JSONContent): boolean =>
    (node.type === "text" || node.type === "hardBreak") &&
    (node.marks ?? []).length === 0;

  return (doc.content ?? []).every(
    (block) =>
      block.type === "paragraph" &&
      (block.content ?? []).every(isPlainInline) &&
      block.attrs?.attachmentId === undefined
  );
};
