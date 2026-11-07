/**
 * One opened letter, written out to a file the reader names.
 *
 * The same shape as `exportEntry`, and deliberately so: a letter that has
 * arrived is writing like any other, and getting it out of Wattle should not be
 * a different act from getting an entry out. What it does not share is
 * `entries/export.ts` itself - that file is the journal's, and a letter is not
 * a journal entry.
 *
 * Rust refuses to write a file for a letter that has not opened, so the gate
 * holds here as everywhere else.
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

export const exportLetter = async (id: number): Promise<void> => {
  let suggested: string;
  try {
    suggested = await invoke<string>("letter_export_filename", { id });
  } catch {
    await report(null);
    return;
  }

  const destinationPath = await save({
    defaultPath: `${suggested}.html`,
    filters: [{ extensions: ["html"], name: "HTML" }],
  });
  if (!destinationPath) {
    return;
  }

  try {
    // The folder is made here, so where the page actually landed is
    // whatever Rust answers - not the path the dialog proposed.
    const written = await invoke<string>("export_letter_html", {
      destinationPath,
      id,
    });
    await report(written);
  } catch {
    await report(null);
  }
};
