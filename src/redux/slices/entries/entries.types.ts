import type { JSONContent } from "@tiptap/core";

/**
 * Which surface a row was written on.
 *
 * `"letter"` is not an `entries.kind` - the CHECK on that column still allows
 * two values, and a letter is never a row in that table. It appears here
 * because an **opened** letter can turn up in a search result, which is the one
 * place the journal and the letters meet. It never appears while browsing.
 */
export type EntryKind = "entry" | "spark" | "letter";

export interface EntrySummary {
  createdAt: string;
  entryDate: string;
  id: number;
  kind: EntryKind;
  /** Plain-text excerpt derived on write; the list never parses a document. */
  preview: string;
  /**
   * Why this entry matched, with the matching runs wrapped in the highlight
   * markers. Only present for a search; browsing leaves it null.
   */
  snippet: string | null;
  title: string;
  updatedAt: string;
  wordCount: number;
}

export interface EntryDetail extends EntrySummary {
  content: JSONContent;
}

export interface AttachmentDto {
  createdAt: string;
  entryId: number;
  filename: string;
  id: number;
  mimeType: string;
  path: string;
  size: number;
}

/** An entry from an earlier year, shown on the day it comes round again. */
export interface Memory {
  entryDate: string;
  id: number;
  /** Relative path of the entry's first image, if it has one. */
  imagePath: string | null;
  preview: string;
  title: string;
  yearsAgo: number;
}

/**
 * An older spark, returned by the daily rotation.
 *
 * Not a `Memory`: a memory is about a date coming round again, an echo is
 * about something left behind. Different mechanism, different wording, its own
 * setting - so it gets its own shape rather than borrowing that one.
 */
export interface SparkEcho {
  /** Whole days between the spark's day and today. */
  daysAgo: number;
  entryDate: string;
  id: number;
  preview: string;
}

export type EntryListStatus = "idle" | "loading" | "loaded" | "error";
export type ActiveEntryStatus =
  | "idle"
  | "loading"
  | "loaded"
  | "saving"
  | "error";

export interface EntriesState {
  activeEntry: EntryDetail | null;
  activeEntryAttachments: AttachmentDto[];
  activeEntryStatus: ActiveEntryStatus;
  /** Whether the last page came back full, meaning there may be another one. */
  hasMore: boolean;
  list: EntrySummary[];
  listStatus: EntryListStatus;
  /** Total matches for the current search, not just the loaded page. */
  matchCount: number | null;
  /** What was written on this day in earlier years. */
  memories: Memory[];
  /** Set aside for this run of the app, not remembered between them. */
  memoriesDismissed: boolean;
  /** The search the current list reflects; load-more must reuse it. */
  query: string;
  /** The one older spark returning today, if there is one. */
  sparkEcho: SparkEcho | null;
  /** Set aside for this run of the app, not remembered between them. */
  sparkEchoDismissed: boolean;
}
