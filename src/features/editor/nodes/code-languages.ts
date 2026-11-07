/**
 * The languages a code block can be written in, and the grammars that colour
 * them.
 *
 * **A list, not a library.** `lowlight` ships nearly two hundred grammars and
 * `highlight.js` weighs what all of them weigh; importing them one at a time is
 * what keeps the cost to the ones a journal actually holds. Adding a language
 * is an import and a row - and removing one is deleting the row, which is the
 * property that matters when this list is wrong.
 *
 * The `id` is not decoration: it is written into the document's `language`
 * attribute, and `content.rs` already carries it out into the Markdown fence
 * and the exported `class="language-…"`. It has to be the name highlight.js
 * knows, or the colour and the export disagree.
 *
 * Labels are proper names, so they are not translated - "JavaScript" is
 * "JavaScript" in both catalogues.
 */

import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import xml from "highlight.js/lib/languages/xml";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import yaml from "highlight.js/lib/languages/yaml";
import { createLowlight } from "lowlight";

export interface CodeLanguage {
  /** What the document stores, and what the export fence says. */
  id: string;
  /** How it is named in the picker. A proper name, never translated. */
  label: string;
}

/**
 * The value a block carries when no language has been chosen.
 *
 * An empty string rather than `null`, because that is what an unset `language`
 * attribute already serialises to everywhere else in the chain, and a `<Select>`
 * cannot hold `null` as a value.
 */
export const NO_LANGUAGE = "";

export const CODE_LANGUAGES: CodeLanguage[] = [
  { id: "bash", label: "Shell" },
  { id: "css", label: "CSS" },
  { id: "go", label: "Go" },
  { id: "java", label: "Java" },
  { id: "javascript", label: "JavaScript" },
  { id: "json", label: "JSON" },
  { id: "markdown", label: "Markdown" },
  { id: "python", label: "Python" },
  { id: "rust", label: "Rust" },
  { id: "sql", label: "SQL" },
  { id: "typescript", label: "TypeScript" },
  { id: "xml", label: "HTML" },
  { id: "yaml", label: "YAML" },
];

/**
 * The highlighter, with those grammars and no others.
 *
 * `xml` covers HTML, and `typescript` covers TSX - highlight.js registers both
 * under aliases of the same grammar, so the list above is thirteen imports for
 * the fifteen things someone might reasonably paste in.
 */
export const lowlight = createLowlight();

lowlight.register({
  bash,
  css,
  go,
  java,
  javascript,
  json,
  markdown,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
});
