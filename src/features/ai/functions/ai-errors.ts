/**
 * A Rust failure code, turned into the sentence a reader sees.
 *
 * The shape it answers with, and why it is shaped that way, are in
 * `interfaces/ai-errors.ts`.
 */

import type { AiFailure } from "../interfaces/ai-errors";

const PREFIX = "ai:";

/** Every kind the interface has a sentence for. Anything else is unknown. */
const KNOWN_KINDS = new Set([
  "badSelection",
  "cancelled",
  "daemon",
  "disabled",
  "empty",
  "modelGone",
  "noModel",
  "noPassage",
  "reasoned",
  "timeout",
  "tooLong",
  "unreachable",
  "unreadable",
]);

export const toAiFailure = (error: unknown): AiFailure => {
  const raw = String(error);
  if (!raw.startsWith(PREFIX)) {
    return { detail: raw, messageKey: "aiError.unknown", wasCancelled: false };
  }

  const [kind, ...rest] = raw.slice(PREFIX.length).split(" ");
  const detail = rest.join(" ").trim();
  if (!KNOWN_KINDS.has(kind)) {
    return { detail: raw, messageKey: "aiError.unknown", wasCancelled: false };
  }
  return {
    detail: detail === "" ? null : detail,
    messageKey: `aiError.${kind}`,
    wasCancelled: kind === "cancelled",
  };
};
