import { PALETTE_IDS } from "./palettes.generated";

/**
 * How the interface is coloured, lettered and shaped.
 *
 * Read off the generated list rather than written out, so the palettes the
 * stylesheet can draw and the ones the application will accept cannot fall out
 * of step: both come from the folder. See `scripts/generate-themes.js`.
 */
export type Palette = (typeof PALETTE_IDS)[number];

/**
 * What a journal wears when nobody has chosen: Wattle's own paper and ink, the
 * one palette written into `globals.css` itself rather than generated.
 */
export const DEFAULT_PALETTE: Palette = "wattle";

/** Every palette, in the order the menu offers them. */
export const PALETTES: readonly Palette[] = PALETTE_IDS;

/**
 * The stored name, if it is still one of the palettes.
 *
 * A name is only ever a name: nothing validates it on the way into the database
 * and nothing needs to, because a palette the stylesheet does not recognise
 * simply leaves the default in place. The picker is the one place that cannot
 * shrug - it would show the raw name back - so it asks here first.
 */
export const knownPalette = (id: string): Palette =>
  PALETTES.find((palette) => palette === id) ?? DEFAULT_PALETTE;

/**
 * What a palette is called before anybody has written its name down.
 *
 * A theme generated from a file nobody has translated yet is still a theme, and
 * it goes in the menu under the name of its own file. `generate:themes` prints
 * which ones are in this position.
 */
export const provisionalName = (id: string): string =>
  id.charAt(0).toUpperCase() + id.slice(1);
