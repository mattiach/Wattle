import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import { invoke } from "@tauri-apps/api/core";

import { defaultSettings } from "./settings.data";

import type { Settings } from "./settings.types";
import type { RootState } from "@/redux/store";

export const saveSettingsThunk = createAsyncThunk<
  void,
  void,
  { state: RootState }
>("settings/saveSettingsThunk", async (_, { getState }) => {
  // `aiPulling` is the one thing in this slice that is not a setting: it says
  // what Ollama is doing at this moment. Stripped here rather than guarded in
  // Rust, so `SettingsDto` stays the wire shape of `Settings` field for field.
  const { aiPulling: _aiPulling, ...settings } = getState().settings;
  await invoke("save_settings", { settings });
});

const settingsSlice = createSlice({
  initialState: defaultSettings,
  name: "settings",
  reducers: {
    // `aiPulling` survives all three of the reducers that rebuild this state
    // wholesale. It is not a preference to be reset and not a stored value to
    // be replaced: clearing it while a download is running would release the
    // two controls that are being held precisely because it is running.
    clearSettings: (state) => ({
      ...defaultSettings,
      aiPulling: state.aiPulling,
    }),
    hydrateSettings: (state, action: PayloadAction<Settings>) => ({
      ...action.payload,
      aiPulling: state.aiPulling,
    }),
    markTourSeen: (state, action: PayloadAction<string>) => {
      if (!state.toursSeen.includes(action.payload)) {
        state.toursSeen.push(action.payload);
      }
    },
    /**
     * Back to how Wattle arrives, minus the things that are not preferences.
     *
     * Assistance is left exactly as it was: turning it on was a deliberate
     * decision about what may run on this machine, and a "reset appearance"
     * button has no business reversing it. The profile name is not in this
     * slice at all, so it cannot be touched from here either.
     *
     * Onboarding, the backup folder and the seen tours are held back for the
     * same reason: none of them is a preference. Resetting appearance must not
     * throw someone back into a first-run flow, forget where their backups go,
     * or replay every tour they have already sat through.
     */
    resetSettings: (state) => ({
      ...defaultSettings,
      aiEnabled: state.aiEnabled,
      aiModel: state.aiModel,
      aiPulling: state.aiPulling,
      backupDir: state.backupDir,
      // Kept for the same reason as the rest of this list, and more plainly
      // than any of them: resetting the appearance of an application into a
      // language its reader cannot read leaves them no way to undo it.
      language: state.language,
      onboarded: state.onboarded,
      toursSeen: state.toursSeen,
      version: state.version,
    }),
    /**
     * Forgets which tours have been seen, so every one is offered again.
     *
     * Deliberately not part of `resetSettings`: a tour already sat through is
     * not a preference, and someone resetting their palette has not asked to be
     * walked round the application again.
     */
    resetTours: (state) => {
      state.toursSeen = [];
    },
    setAiEnabled: (state, action: PayloadAction<boolean>) => {
      state.aiEnabled = action.payload;
    },
    setAiModel: (state, action: PayloadAction<string>) => {
      state.aiModel = action.payload;
    },
    /**
     * Raised and lowered by the pull itself, not by the panel's lifetime.
     *
     * A download keeps running in Rust when the screen showing it is left, so
     * an unmount must not lower this - otherwise navigating away would release
     * the controls it is holding while gigabytes are still arriving.
     */
    setAiPulling: (state, action: PayloadAction<boolean>) => {
      state.aiPulling = action.payload;
    },
    setBackupDir: (state, action: PayloadAction<string>) => {
      state.backupDir = action.payload;
    },
    setEditorScale: (state, action: PayloadAction<Settings["editorScale"]>) => {
      state.editorScale = action.payload;
    },
    setEntryLock: (state, action: PayloadAction<boolean>) => {
      state.entryLock = action.payload;
    },
    setLanguage: (state, action: PayloadAction<Settings["language"]>) => {
      state.language = action.payload;
    },
    setLayoutWidth: (state, action: PayloadAction<Settings["layoutWidth"]>) => {
      state.layoutWidth = action.payload;
    },
    setNavigation: (state, action: PayloadAction<Settings["navigation"]>) => {
      state.navigation = action.payload;
    },
    setOnboarded: (state, action: PayloadAction<boolean>) => {
      state.onboarded = action.payload;
    },
    setOnThisDay: (state, action: PayloadAction<boolean>) => {
      state.onThisDay = action.payload;
    },
    setPalette: (state, action: PayloadAction<Settings["palette"]>) => {
      state.palette = action.payload;
    },
    setSparkEcho: (state, action: PayloadAction<boolean>) => {
      state.sparkEcho = action.payload;
    },
    setTheme: (state, action: PayloadAction<Settings["theme"]>) => {
      state.theme = action.payload;
    },
    setZoomLevel: (state, action: PayloadAction<number>) => {
      state.zoomLevel = action.payload;
    },
  },
});

export const {
  clearSettings,
  hydrateSettings,
  markTourSeen,
  resetSettings,
  resetTours,
  setAiEnabled,
  setAiModel,
  setAiPulling,
  setBackupDir,
  setEditorScale,
  setEntryLock,
  setLanguage,
  setLayoutWidth,
  setNavigation,
  setOnboarded,
  setOnThisDay,
  setPalette,
  setSparkEcho,
  setTheme,
  setZoomLevel,
} = settingsSlice.actions;

export default settingsSlice.reducer;
