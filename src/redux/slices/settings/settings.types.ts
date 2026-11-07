/**
 * The named appearance choices.
 *
 * Names rather than values on purpose: the stylesheet decides what each one
 * means, so tuning a width or a palette is a change to `globals.css` and never
 * a migration of everyone's settings.
 */
import type { LanguageCode } from "@/languages/languages";
// Owned there because the list is generated from the `themes/` folder, the same
// way the language codes are owned by the language catalogue.
import type { Palette } from "@/theme/palettes";

export type LayoutWidth = "compact" | "default" | "wide";

/**
 * How large the writing is set on the editing surface.
 *
 * A name rather than a number, exactly like `LayoutWidth`: the stylesheet
 * decides what each one measures, so tuning a size is a change to `globals.css`
 * and never a migration of everyone's settings.
 */
export type EditorScale = "small" | "default" | "large" | "largest";

/**
 * The settings slice: everything that is stored, plus what is only true for
 * this run of the application.
 *
 * Kept apart from `Settings` on purpose. That interface is the wire shape of
 * `SettingsDto` field for field, and `saveSettingsThunk` posts it whole - so a
 * runtime flag added there would be written to the database as though it were a
 * preference. Anything declared here and not in `Settings` has to be stripped
 * before saving and carried through every reducer that rebuilds the state.
 */
export interface SettingsState extends Settings {
  /**
   * True while a model is downloading.
   *
   * Session-only, and never persisted: it describes what Ollama is doing right
   * now. It is in the store rather than in a component because two controls on
   * two different screens are held by it - the assistance switch, which would
   * unmount the panel driving the pull, and the control that empties the
   * journal.
   */
  aiPulling: boolean;
}

export interface Settings {
  /** Whether Wattle may talk to a local Ollama at all. Off by default. */
  aiEnabled: boolean;
  /** The chosen model from the curated catalog, or empty for none yet. */
  aiModel: string;
  /** Where backups are written without asking. Empty means not configured, and
   * the backup action falls back to asking for a path each time. */
  backupDir: string;
  /** How large the writing is set in the editor, on every writing surface. */
  editorScale: EditorScale;
  /** Whether an entry that already holds writing opens read-only. */
  entryLock: boolean;
  /** One of the codes in the language catalogue, which owns the list. */
  language: LanguageCode;
  /** How wide the reading and scanning columns are, across every screen. */
  layoutWidth: LayoutWidth;
  /** Where the primary navigation is shown. */
  navigation: "bottom" | "both" | "header";
  /** Whether this profile has been through onboarding. False only on a journal
   * that has never been set up. */
  onboarded: boolean;
  /** Whether entries from previous years may resurface on the home screen. */
  onThisDay: boolean;
  /** Which palette the interface wears. */
  palette: Palette;
  /** Whether an older spark may come back on its own. Separate from On This
   * Day: the two resurfacings mean different things. */
  sparkEcho: boolean;
  theme: "light" | "dark";
  /** The ids of the guided tours already seen. A flat list, so a new tour costs
   * a string and not a migration. */
  toursSeen: string[];
  version: string;
  zoomLevel: number;
}
