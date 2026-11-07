import { useEffect, useState } from "react";

/**
 * The two widths the navigation changes shape at.
 *
 * Measured against what the bars actually need rather than picked off a
 * breakpoint scale. The floating bar is icons plus one label: six collapsed
 * items at 44px, their gaps, the bar's own padding and the active item come to
 * roughly 350px, so a window narrower than this leaves the label a few pixels
 * and a truncated fragment. The header is text only, five destinations plus the
 * wordmark, which wants a great deal more.
 *
 * Both went up by one item's width when the assistant gained a destination.
 * They are numbers about how much the bars measure, so they have to be revised
 * whenever the number of destinations changes - a tab added without touching
 * them is a tab that overflows on a narrow window.
 *
 * They are constants rather than CSS breakpoints because two different
 * components have to agree on them: when the header stops showing
 * destinations, the floating bar has to start - otherwise a reader whose
 * navigation setting is "header" would have none at all.
 */
const LABELLED_NAV_MIN_WIDTH = 524;
const HEADER_NAV_MIN_WIDTH = 720;

const matches = (minWidth: number) =>
  typeof window === "undefined"
    ? true
    : window.matchMedia(`(min-width: ${minWidth}px)`).matches;

const useMinWidth = (minWidth: number) => {
  const [wide, setWide] = useState(() => matches(minWidth));

  useEffect(() => {
    const query = window.matchMedia(`(min-width: ${minWidth}px)`);
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [minWidth]);

  return wide;
};

export interface NavLayout {
  /** Whether the header may show its destinations, or only the wordmark. */
  headerNav: boolean;
  /** Whether the floating bar's active item may carry its label. */
  labelled: boolean;
}

/**
 * What shape the navigation takes at this window width.
 *
 * The window, not the reading column: `layout_width` in Settings decides how
 * wide the writing is set, and the bars are centred independently of it.
 */
export const useNavLayout = (): NavLayout => ({
  headerNav: useMinWidth(HEADER_NAV_MIN_WIDTH),
  labelled: useMinWidth(LABELLED_NAV_MIN_WIDTH),
});
