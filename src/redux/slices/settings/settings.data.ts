import packageJson from "../../../../package.json";

import type { SettingsState } from "./settings.types";

export const defaultSettings: SettingsState = {
  aiEnabled: false,
  aiModel: "",
  // Nothing is being downloaded until something starts a download. Never read
  // from the database, and never written to it.
  aiPulling: false,
  backupDir: "",
  editorScale: "default",
  // Opening writing you finished months ago should not put a caret in the
  // middle of it: an accidental keystroke in an old entry is the one edit a
  // journal cannot help you notice.
  entryLock: true,
  language: "en",
  layoutWidth: "default",
  navigation: "both",
  // A journal nobody has set up yet. Migration 11 marks every existing one
  // onboarded, so this default only ever applies to a genuinely new one.
  onboarded: false,
  onThisDay: true,
  palette: "wattle",
  sparkEcho: true,
  theme: "light",
  toursSeen: [],
  version: packageJson.version || "0.0.0",
  zoomLevel: 1,
};
