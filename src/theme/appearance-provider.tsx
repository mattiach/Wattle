import { useEffect } from "react";

import { useAppSelector } from "@/redux/hooks";

import type { ReactNode } from "react";
import type { Settings } from "@/redux/slices/settings/settings.types";

/**
 * Every stored appearance choice, and the attribute it is written to.
 *
 * The whole mechanism is this table. A future font family or density is one
 * more row here and one more block in `globals.css` - the provider never
 * learns what a name means, and the stylesheet never learns where it came
 * from.
 */
export const APPEARANCE_ATTRIBUTES = {
  editorScale: "data-wattle-editor-scale",
  layoutWidth: "data-wattle-width",
  palette: "data-wattle-palette",
} as const;

interface AppearanceProviderProps {
  children: ReactNode;
}

/**
 * Writes the reader's appearance choices onto `<html>`.
 *
 * Separate from `ThemeProvider`, which owns the one thing that is not a name:
 * light and dark, expressed as a class because the `dark:` variant is built on
 * it. Everything else is a data attribute, so CSS decides what each choice
 * means and nothing here has an opinion about colour or measurement.
 */
export const AppearanceProvider = ({ children }: AppearanceProviderProps) => {
  const editorScale = useAppSelector((state) => state.settings.editorScale);
  const layoutWidth = useAppSelector((state) => state.settings.layoutWidth);
  const palette = useAppSelector((state) => state.settings.palette);

  useEffect(() => {
    applyAppearance({ editorScale, layoutWidth, palette });
  }, [editorScale, layoutWidth, palette]);

  return <>{children}</>;
};

/**
 * The same write, done once before React renders.
 *
 * An effect runs after the first paint, which for an accent nobody noticed and
 * for a whole theme is a frame of the wrong application. The store is hydrated
 * before `createRoot` is called, so this can be too - see `redux/bootstrap.ts`.
 */
export const applyAppearance = (values: {
  editorScale: Settings["editorScale"];
  layoutWidth: Settings["layoutWidth"];
  palette: Settings["palette"];
}): void => {
  const root = document.documentElement;
  for (const [key, attribute] of Object.entries(APPEARANCE_ATTRIBUTES)) {
    root.setAttribute(attribute, values[key as keyof typeof values]);
  }
};
