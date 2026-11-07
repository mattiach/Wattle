import type { EditorScale } from "@/redux/slices/settings/settings.types";

/** The sizes on offer, smallest first, which is the order a menu reads in. */
export const EDITOR_SCALES = [
  "small",
  "default",
  "large",
  "largest",
] as const satisfies readonly EditorScale[];

/**
 * What each size is called. Keys rather than words: this is a data module, and
 * the copy belongs to the catalogue like everything else on screen.
 */
export const EDITOR_SCALE_LABEL_KEYS: Record<EditorScale, string> = {
  default: "editorScaleDefault",
  large: "editorScaleLarge",
  largest: "editorScaleLargest",
  small: "editorScaleSmall",
};

/**
 * The variable each size's sample is drawn with, as a class rather than an
 * inline style so the value stays in the stylesheet with the other three.
 *
 * Written out rather than composed from the name because Tailwind reads the
 * source for whole class names, and a template literal is not one.
 */
export const EDITOR_SCALE_SAMPLE_CLASSES: Record<EditorScale, string> = {
  default: "[--editor-scale-sample:var(--editor-scale-default)]",
  large: "[--editor-scale-sample:var(--editor-scale-large)]",
  largest: "[--editor-scale-sample:var(--editor-scale-largest)]",
  small: "[--editor-scale-sample:var(--editor-scale-small)]",
};
