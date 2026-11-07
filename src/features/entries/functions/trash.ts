import { invoke } from "@tauri-apps/api/core";

import type { TrashedEntry } from "../interfaces/trash";

/** Newest deletion first, which is the order somebody hunting a mistake reads in. */
export const listTrash = (): Promise<TrashedEntry[]> =>
  invoke<TrashedEntry[]>("list_trash");

/** Puts a page back in the journal, under the id and the date it had. */
export const restoreEntry = (id: number): Promise<void> =>
  invoke("restore_entry", { id });

/** Destroys one page ahead of its wait, files included. */
export const purgeEntry = (id: number): Promise<void> =>
  invoke("purge_entry", { id });

/** The same, for everything waiting. */
export const emptyTrash = (): Promise<void> => invoke("empty_trash");

/**
 * How long a page waits, asked of the only place that decides it.
 *
 * Not a constant repeated on this side: the number lives in the SQL that does
 * the purging, and a second copy of it in the sentence describing the rule is a
 * promise free to drift out of step with the rule.
 */
export const trashRetentionDays = (): Promise<number> =>
  invoke<number>("trash_retention_days");

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The day this page stops existing.
 *
 * A date rather than a countdown, because a countdown has to be pluralised in
 * sixteen languages to say "1 day left" without embarrassing itself, and a date
 * says the same thing without counting anything.
 */
export const expiresOn = (deletedAt: string, retentionDays: number): Date =>
  new Date(new Date(deletedAt).getTime() + retentionDays * MS_PER_DAY);
