/**
 * What a letter is on this side of the wire.
 *
 * Thin, and for one reason: every rule lives in Rust, where a caller cannot argue with it. The floor of
 * seven days, the ceiling of fifty years, what may be edited, what may be
 * deleted, and above all *when a letter may be opened* are all decided there.
 * This file names the shapes; `functions/letters.ts` invokes the commands.
 *
 * There is no Redux slice here, deliberately. The README's rule is that the
 * store holds what more than one screen needs, and no letters screen needs
 * another's state. There is also a second reason particular to this one: a draft in a global store is a copy of the plaintext in a place nothing
 * is responsible for clearing.
 */

export type LetterStatus = "draft" | "sealed";

/** A letter without its words: the two dates, and how long it is. */
export interface LetterSummary {
  /** `sealed` and its day has come. Derived in Rust at the moment of asking -
   * nothing is stored when a date passes, and nothing runs to notice. */
  available: boolean;
  id: number;
  /** Empty until it has actually been opened. */
  openedAt: string;
  promptId: string;
  sealedAt: string;
  status: LetterStatus;
  /** Empty while a draft has not been given a date yet. */
  unlockOn: string;
  wordCount: number;
  writtenOn: string;
}

/** A letter with its words. Only ever a draft, or one whose day has come. */
export interface Letter extends LetterSummary {
  /** Tiptap JSON, as a string - the same representation an entry's content has. */
  content: string;
}

export interface LetterStatusSummary {
  /** Letters whose day has come and which have not been opened yet. */
  arrived: LetterSummary[];
  /** The nearest letter still waiting, and only that one. */
  waiting: LetterSummary | null;
}

/**
 * One of a letter's own files.
 *
 * Shaped like an entry's attachment because the node views that draw it read
 * the same fields - but it comes from its own table, so an id here means
 * nothing on the entries side and vice versa.
 */
export interface LetterAttachment {
  createdAt: string;
  filename: string;
  id: number;
  letterId: number;
  mimeType: string;
  /** Relative to the Wattle folder. Only ever a readable path: Rust refuses to
   * list a sealed letter's files at all. */
  path: string;
  size: number;
}
