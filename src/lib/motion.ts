/**
 * The one spring the whole application animates on.
 *
 * Defined once rather than per component so a saved spark, an arriving memory
 * and the navigation pill all move at the same rate - which is what makes them
 * read as one interface rather than three. `bounce: 0` means every motion
 * glides to a stop with nothing left to settle.
 */
export const springTransition = {
  bounce: 0,
  type: "spring",
  visualDuration: 0.34,
} as const;

/**
 * Something that appeared without being asked for: a memory, a spark echo, the
 * card under a picked calendar day.
 *
 * A fade and nothing else, for the same reason the page intro is: arriving is
 * not travelling, and reserving movement for what genuinely moves is what
 * keeps the movement meaningful.
 */
export const arrivalTransition = {
  duration: 0.24,
  ease: [0.22, 1, 0.36, 1],
} as const;

export const arrivalInitial = { opacity: 0 } as const;
export const arrivalAnimate = { opacity: 1 } as const;

/**
 * Nearly all of the movement in the first third, then a long settle. The one
 * easing curve the arriving surfaces share.
 */
const EXPO_OUT = [0.16, 1, 0.3, 1] as const;

/**
 * No animation at all.
 *
 * Used for the first paint of a shared-layout element: Motion has nothing to
 * animate *from* on mount, so letting it run produces a drop-in rather than
 * the horizontal slide the same element makes on every later change.
 */
export const instantTransition = { duration: 0 } as const;

/**
 * A control resizing under the pointer - a field opening, a bar widening.
 *
 * Deliberately quicker than the spring: the spring is for something travelling
 * across the screen, and reusing it here made the search field feel like it was
 * being dragged open rather than simply making room.
 */
export const resizeTransition = {
  duration: 0.32,
  ease: EXPO_OUT,
} as const;

/**
 * Something that kept the reader waiting before it could appear.
 *
 * `arrivalTransition` is a quick fade, which is right for a surface that is
 * already there when the screen paints - a memory, a letter's arrival, the
 * card under a picked day. The writing nudge is not one of those: it lands
 * seconds later, whenever a local model has finished thinking, and a 0.24s fade
 * arriving out of nowhere reads as a snap rather than an offer. It gets the
 * page intro's treatment instead - the blur lifting as it settles, over long
 * enough to look like it resolved rather than switched on.
 *
 * Still nothing travels, for the reason written under `pageIntroInitial`.
 */
export const settleInitial = {
  filter: "blur(6px)",
  opacity: 0,
} as const;

export const settleAnimate = {
  filter: "blur(0px)",
  opacity: 1,
} as const;

export const settleTransition = {
  duration: 0.55,
  ease: EXPO_OUT,
} as const;

/**
 * A screen arriving: a block resolving into focus, and staying put while it
 * does.
 *
 * **Nothing travels.** A screen that slides up as it appears is the house
 * style of every framework template, and it competes with the one thing on
 * screen that is *meant* to move - a row being added or removed. So the intro
 * is the fade alone, with the blur lifting as it lands to keep it from being a
 * flat dissolve. The easing is a strong expo-out, so almost all of it happens
 * in the first third.
 *
 * Mount-only: nothing animates on the way *out*, so navigating away is never
 * delayed.
 */
export const pageIntroInitial = {
  filter: "blur(4px)",
  opacity: 0,
} as const;

export const pageIntroAnimate = {
  filter: "blur(0px)",
  opacity: 1,
} as const;

export const pageIntroTransition = (delay = 0) =>
  ({ delay, duration: 0.5, ease: EXPO_OUT }) as const;
