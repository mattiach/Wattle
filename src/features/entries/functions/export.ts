import { invoke } from "@tauri-apps/api/core";
import { message, open, save } from "@tauri-apps/plugin-dialog";

import i18n from "@/languages/i18n";

/** The one refusal Rust makes that is not a fault, matched on its message. */
const NOTHING_TO_EXPORT = "there is nothing to export";

/**
 * Where the export landed is the only thing the user needs to know afterwards:
 * the export never touches the journal itself, so a failure has nothing to undo.
 */
const report = async (path: string | null, error?: unknown): Promise<void> => {
  if (path === null) {
    // The reason travels with the failure. "Export failed" on its own leaves
    // the reader with nothing to act on - and an empty journal is not a
    // failure at all, so it gets its own sentence rather than an error's.
    const detail = error === undefined ? "" : String(error);
    if (detail.includes(NOTHING_TO_EXPORT)) {
      await message(i18n.t("exportEmpty"), { title: i18n.t("export") });
      return;
    }
    await message([i18n.t("exportError"), detail].join("\n\n").trim(), {
      kind: "error",
      title: i18n.t("export"),
    });
    return;
  }
  await message(i18n.t("exportSuccess", { path }), { title: i18n.t("export") });
};

/**
 * One entry, one file, at a path the user names.
 *
 * A single entry has no folder to keep anything in, so the native save dialog
 * is the whole interface: it picks the directory and the filename in one step,
 * opening on a suggestion derived from the entry's date and title.
 */
export const exportEntry = async (id: number): Promise<void> => {
  let suggested: string;
  try {
    suggested = await invoke<string>("entry_export_filename", { id });
  } catch (error) {
    await report(null, error);
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
    const written = await invoke<string>("export_entry_html", {
      destinationPath,
      id,
    });
    await report(written);
  } catch (error) {
    await report(null, error);
  }
};

/**
 * One attachment, copied out to a path the user names.
 *
 * The way a file gets back *out* of the journal. Wattle keeps attachments in
 * its own directory under names of its own choosing, so before this the only
 * way to retrieve a PDF you attached last year was to go looking inside the
 * application's storage - which is not somewhere anyone should have to know
 * about.
 *
 * A copy, not a move: the entry still references it, and Rust refuses if the
 * file has gone rather than writing an empty one over whatever the reader
 * pointed the dialog at. The dialog opens on the original filename, since that
 * is the name the reader gave it and the one they will look for.
 */
export const downloadAttachment = async (
  id: number,
  filename: string
): Promise<void> => {
  // The extension the file already has, so the dialog offers to keep it. A
  // filename with no dot has no filter rather than a wrong one.
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
    await invoke("save_attachment_as", { destinationPath, id });
    await report(destinationPath);
  } catch (error) {
    await report(null, error);
  }
};

/** The whole journal, as an HTML folder written inside a directory the user picks. */
export const exportJournal = async (): Promise<void> => {
  const destinationDir = await open({ directory: true });
  if (typeof destinationDir !== "string") {
    return;
  }

  try {
    const path = await invoke<string>("export_journal_html", {
      destinationDir,
    });
    await report(path);
  } catch (error) {
    await report(null, error);
  }
};
