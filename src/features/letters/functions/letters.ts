/**
 * How to ask for a letter.
 *
 * Thin on purpose: every rule lives in Rust, where a caller cannot argue with
 * it. The shapes these commands answer with are in `interfaces/letters.ts`.
 */

import { invoke } from "@tauri-apps/api/core";
import type { JSONContent } from "@tiptap/core";

import { isEntryEmpty } from "@/redux/slices/entries/entries.slice";

import type {
  Letter,
  LetterAttachment,
  LetterStatusSummary,
  LetterSummary,
} from "../interfaces/letters";

export const createLetter = (promptId: string): Promise<Letter> =>
  invoke<Letter>("create_letter", { promptId });

/**
 * Saves the draft and the date chosen for it so far.
 *
 * The date is not judged here or in Rust's draft path: it is a choice in
 * progress, and refusing to save the words because of the date would lose the
 * words. It is judged at sealing, against that day. The direction travels with
 * the draft for the same reason - it can be changed while writing.
 */
export const saveLetterDraft = (
  id: number,
  content: string,
  unlockOn: string,
  promptId: string
): Promise<Letter> =>
  invoke<Letter>("save_letter_draft", { content, id, promptId, unlockOn });

export const deleteLetter = (id: number): Promise<void> =>
  invoke("delete_letter", { id });

/** Closes a letter, permanently. There is no command that reverses this. */
export const sealLetter = (
  id: number,
  unlockOn: string
): Promise<LetterSummary> =>
  invoke<LetterSummary>("seal_letter", { id, unlockOn });

export const listLetters = (): Promise<LetterSummary[]> =>
  invoke<LetterSummary[]>("list_letters");

export const letterStatus = (): Promise<LetterStatusSummary> =>
  invoke<LetterStatusSummary>("letter_status");

/**
 * The one gate, as this side sees it.
 *
 * Note what it does not take: a date. The day is Rust's, read from the machine,
 * and there is no argument here that could persuade it otherwise.
 */
export const openLetter = (id: number): Promise<Letter> =>
  invoke<Letter>("open_letter", { id });

export const addLetterAttachment = (
  letterId: number,
  sourcePath: string
): Promise<LetterAttachment> =>
  invoke<LetterAttachment>("add_letter_attachment", { letterId, sourcePath });

/**
 * The files of a draft, or of a letter that has been opened.
 *
 * Rejects with `letter:notYet` in between, which is the same gate the words go
 * through - a sealed letter has no filenames to give out either.
 */
export const listLetterAttachments = (
  letterId: number
): Promise<LetterAttachment[]> =>
  invoke<LetterAttachment[]>("list_letter_attachments", { letterId });

export const reconcileLetterAttachments = (letterId: number): Promise<void> =>
  invoke("reconcile_letter_attachments", { letterId });

/**
 * The failure codes Rust answers with, mapped to sentences.
 *
 * The same device as `ai-errors.ts`: Rust returns `letter:notYet`, and the
 * interface chooses the wording. Anything unrecognised falls back rather than
 * showing a reader an English sentence written for a developer.
 */
const PREFIX = "letter:";

const KNOWN_KINDS = new Set([
  "badDate",
  "corrupt",
  "empty",
  "futureEnvelope",
  "noKey",
  "notFound",
  "notYet",
  "sealed",
  "tooFar",
  "tooSoon",
]);

/** The i18n key for whatever went wrong. */
export const toLetterErrorKey = (error: unknown): string => {
  const message = typeof error === "string" ? error : String(error);
  if (!message.startsWith(PREFIX)) {
    return "letterError.unknown";
  }
  const kind = message.slice(PREFIX.length).split(" ")[0] ?? "";
  return KNOWN_KINDS.has(kind) ? `letterError.${kind}` : "letterError.unknown";
};

/** The empty document a new letter starts from. */
export const EMPTY_DOCUMENT = '{"type":"doc","content":[]}';

/**
 * Whether a draft has anything in it yet.
 *
 * The journal's own predicate, with no title to give it: a letter has none, and
 * "nothing was written" means the same thing on both surfaces. Rust refuses to
 * seal an empty letter either way - this is so the composer does not offer the
 * ceremony before there is anything to hold one over.
 */
export const isLetterEmpty = (content: JSONContent): boolean =>
  isEntryEmpty("", content);
