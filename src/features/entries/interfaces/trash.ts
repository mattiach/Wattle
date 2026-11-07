import type { EntryKind } from "@/redux/slices/entries/entries.types";

/**
 * A page waiting in the trash.
 *
 * A summary and the day it was deleted, and nothing more: the document itself
 * stays in the database until the page is either brought back or destroyed, so
 * a list of thirty days of deletions costs one row each rather than one
 * document each.
 */
export interface TrashedEntry {
  /** When it was deleted, as an ISO instant - the clock that runs the wait. */
  deletedAt: string;
  entryDate: string;
  id: number;
  kind: EntryKind;
  preview: string;
  title: string;
  wordCount: number;
}
