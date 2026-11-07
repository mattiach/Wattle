import { invoke } from "@tauri-apps/api/core";

/**
 * Where the journal actually is: the folder holding `wattle.db` and
 * `attachments/`.
 *
 * `Documents/Wattle` until somebody moves it, and after that wherever they put
 * it - which is why nothing asks the operating system for the default and
 * assumes. Rust decides, and this reports what it decided.
 */
export const journalDir = (): Promise<string> =>
  invoke<string>("get_wattle_dir");

/**
 * Moves the journal into `<destination>/Wattle` and opens it there.
 *
 * Resolving means the journal is at its new home and the running application is
 * already using it - the database, the paths and the asset scope all swapped
 * under it, the way `restore_backup` swaps the database. The caller reloads
 * afterwards for the same reason it does after a restore: every slice has to
 * come back from what is now on disk.
 *
 * Rejecting only ever means the move did not happen: the journal is still where
 * it was, still open, and the message says why.
 */
export const moveJournalDir = (destination: string): Promise<void> =>
  invoke("move_journal_dir", { destination });
