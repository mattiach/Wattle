/**
 * Handing one of a letter's files back to the reader.
 *
 * The letters' answer to `downloadAttachment` in `entries/export.ts`, kept
 * apart for the reason the table is: an id only means something alongside the
 * document it belongs to, and pointing the entries' command at a letter's
 * attachment id would open the wrong file - or somebody else's.
 */

import { invoke } from "@tauri-apps/api/core";
import { message, save } from "@tauri-apps/plugin-dialog";

import i18n from "@/languages/i18n";

const report = async (path: string | null): Promise<void> => {
  if (path === null) {
    await message(i18n.t("exportError"), {
      kind: "error",
      title: i18n.t("export"),
    });
    return;
  }
  await message(i18n.t("exportSuccess", { path }), { title: i18n.t("export") });
};

export const downloadLetterAttachment = async (
  id: number,
  filename: string
): Promise<void> => {
  const extension = filename.includes(".")
    ? (filename.split(".").pop() ?? "")
    : "";

  const destinationPath = await save({
    defaultPath: filename,
    filters: extension
      ? [{ extensions: [extension], name: extension.toUpperCase() }]
      : undefined,
  });
  if (!destinationPath) {
    return;
  }

  try {
    // Rust refuses this for a sealed letter, so a download cannot become the
    // way a picture escapes the seal.
    await invoke("save_letter_attachment_as", { destinationPath, id });
    await report(destinationPath);
  } catch {
    await report(null);
  }
};
