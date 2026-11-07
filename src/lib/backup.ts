import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { join } from "@tauri-apps/api/path";

import { journalDir } from "./journal-dir";

/** What a backup attempt did. Cancelling is not failing, and neither is silent. */
export type BackupOutcome = "saved" | "cancelled" | "failed";

/** The same three answers, for the journey the other way. */
export type RestoreOutcome = "restored" | "cancelled" | "failed";

/**
 * Where backups go when nobody has said otherwise: the journal folder itself.
 *
 * Everything Wattle keeps is then in one place, which is the point. It works
 * because `create_backup` leaves earlier `wattle-backup-*` archives out of the
 * archive it is writing - so a backup never contains itself, and never
 * accumulates the ones before it. `attachments/` is the one subfolder still
 * refused: restoring deletes it, and an archive kept there would not survive
 * the restore it exists for.
 *
 * Asked for rather than assembled from `Documents`: the journal is movable, and
 * a default computed from where it *used* to be would send the next backup to
 * an empty folder.
 */
export const defaultBackupDir = (): Promise<string> => journalDir();

/**
 * The extension a Wattle backup wears, everywhere it is written or picked.
 *
 * A ZIP container under a different name, and deliberately not called one: an
 * archive named for its format invites being opened, rummaged through and
 * repacked, and a backup that has been through that is no longer a backup. The
 * name says which application it belongs to and nothing about how it is packed.
 */
const BACKUP_EXTENSION = "wattle";

/** Named for the day, so accepting it twice over is the same journal twice. */
const backupFilename = () =>
  `wattle-backup-${new Date().toISOString().slice(0, 10)}.${BACKUP_EXTENSION}`;

/** The one filter, on both journeys: `.wattle` is the only format there is. */
const backupFilters = [
  { extensions: [BACKUP_EXTENSION], name: "Wattle backup" },
];

/**
 * Writes a backup, where the reader says, every time.
 *
 * **The dialog always opens.** A copy of someone's whole journal is not a file
 * to put away silently: writing it into a folder chosen once, months ago, means
 * the button gives no sign of what it did and no chance to put this one
 * somewhere else - onto the drive you are about to carry away, most of the
 * time. Asking is the feature, not the fallback.
 *
 * `backupDir` is what the dialog *opens at*, so the folder chosen during
 * onboarding still decides where the picker starts and the reader is one click
 * from the usual place. Windows may still show the folder it was last used in;
 * that is the shell's to decide, and either way the destination on screen is
 * the destination written.
 *
 * The day's filename comes pre-filled. Accepting it twice in one day overwrites
 * that day's file, which is the same journal saved twice.
 */
export const runBackup = async (backupDir: string): Promise<BackupOutcome> => {
  const destinationPath = await save({
    defaultPath: backupDir
      ? await join(backupDir, backupFilename())
      : backupFilename(),
    filters: backupFilters,
  });

  if (!destinationPath) {
    return "cancelled";
  }

  try {
    await invoke("create_backup", { destinationPath });
    return "saved";
  } catch {
    return "failed";
  }
};

/**
 * Reads an archive back over this journal: pick a `.wattle` file, and the whole
 * of `wattle.db` and `attachments/` becomes whatever is in it.
 *
 * Asking first is the caller's job, and it is asked *before* this runs - in a
 * `ConfirmDialog`, in the app's own type and colours, rather than in the
 * operating system's alert box. The same act means two different things anyway:
 * in Settings it lands on a journal that is being written in and the warning has
 * to say so, while during onboarding there is nothing yet to overwrite.
 *
 * Reloading afterwards is the caller's too - every slice has to come back from
 * what is now on disk, and only the caller knows where the reader should land.
 */
export const runRestore = async (): Promise<RestoreOutcome> => {
  const sourcePath = await open({
    filters: backupFilters,
    multiple: false,
  });
  if (typeof sourcePath !== "string") {
    return "cancelled";
  }

  try {
    await invoke("restore_backup", { sourcePath });
    return "restored";
  } catch {
    return "failed";
  }
};
