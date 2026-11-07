import { invoke } from "@tauri-apps/api/core";

import { applyAppearance } from "@/theme/appearance-provider";

import { defaultProfile } from "./slices/profile/profile.data";
import { hydrateProfile } from "./slices/profile/profile.slice";
import { defaultSettings } from "./slices/settings/settings.data";
import { hydrateSettings } from "./slices/settings/settings.slice";
import { store } from "./store";

import type { Profile } from "./slices/profile/profile.types";
import type { Settings } from "./slices/settings/settings.types";

export const hydrateStore = async (): Promise<Settings["language"]> => {
  let language: Settings["language"] = defaultSettings.language;

  try {
    const settings = await invoke<Settings>("load_settings");
    store.dispatch(hydrateSettings(settings));
    ({ language } = settings);
  } catch (error) {
    console.error("Failed to load settings:", error);
    store.dispatch(hydrateSettings(defaultSettings));
  }

  // Before React, not after: the providers write these from an effect, which
  // runs once the first frame is already on screen. For an accent that was a
  // detail nobody caught; for a whole theme it is a flash of a different
  // application. This runs before `createRoot`, so the first frame is right.
  dressTheWindow();

  try {
    const profile = await invoke<Profile>("load_profile");
    store.dispatch(hydrateProfile(profile));
  } catch (error) {
    console.error("Failed to load profile:", error);
    store.dispatch(hydrateProfile(defaultProfile));
  }

  wakeOllamaIfAsked();

  return language;
};

/**
 * The stored appearance, on `<html>`, at once.
 *
 * Light and dark is a class because the `dark:` variant is built on it; the
 * rest are names in data attributes. Both live with their own provider, and
 * this only calls them earlier than React can.
 */
const dressTheWindow = (): void => {
  const { editorScale, layoutWidth, palette, theme } =
    store.getState().settings;
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(theme);
  applyAppearance({ editorScale, layoutWidth, palette });
};

/**
 * Starts an already-installed Ollama that happens not to be running.
 *
 * Only ever a start, never an install: an install needs consent, and consent
 * needs a dialog, and a dialog over someone's journal at launch is exactly what
 * this product does not do. If Ollama is missing, the panel on the AI screen
 * asks - when the user is there to be asked.
 *
 * Not awaited: nothing on the home screen depends on it, and one refusal is one
 * refusal - the command fails quietly and is not retried.
 */
const wakeOllamaIfAsked = (): void => {
  if (!store.getState().settings.aiEnabled) {
    return;
  }
  invoke("ai_start_ollama").catch(() => {
    // Not installed, or it would not start. Either way the panel says so when
    // the user next looks, and nothing here nags in the meantime.
  });
};
