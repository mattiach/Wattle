/**
 * The themes the assistant may invite someone to write about, and the pick.
 *
 * The list is meant to be edited. Adding a theme is one line and costs nothing
 * else - no key in either catalogue, no change in Rust, no migration. The rule
 * a theme has to keep is written beside `WritingNudge` in
 * `interfaces/writing-nudges.ts`.
 */

import type { PartOfDay } from "@/lib/dates";

import type { WritingNudge } from "../interfaces/writing-nudges";

/**
 * The themes, spread across the day and across time.
 *
 * Deliberately not all about *today*. A journal that only ever asks "how was
 * your day" gets the same entry every day - so some of these reach back a week,
 * some reach into next year, and some are not about a period at all.
 */
export const WRITING_NUDGES: WritingNudge[] = [
  {
    id: "beauty",
    theme: "something beautiful or striking they saw today",
    when: "any",
  },
  {
    id: "dayAhead",
    theme: "what they are walking into today",
    when: "morning",
  },
  {
    id: "slept",
    theme: "what they woke up thinking about",
    when: "morning",
  },
  {
    id: "firstHour",
    theme: "the first hour of their day",
    when: "morning",
  },
  {
    id: "dayLived",
    theme: "the middle of the day they have just lived",
    when: "evening",
  },
  {
    id: "unfinished",
    theme: "a thought they started today and never finished thinking",
    when: "evening",
  },
  {
    id: "tomorrow",
    theme: "one thing they would like tomorrow to hold",
    when: "evening",
  },
  {
    id: "taste",
    theme: "something they ate or drank recently",
    when: "afternoon",
  },
  {
    id: "interrupted",
    theme: "what interrupted them today",
    when: "afternoon",
  },
  {
    id: "person",
    theme: "someone they crossed paths with in the last few days",
    when: "any",
  },
  {
    id: "kindness",
    theme: "a small kindness they were shown, or one they showed someone else",
    when: "any",
  },
  {
    id: "sound",
    theme: "a sound, a smell or a piece of music that has stayed with them",
    when: "any",
  },
  {
    id: "learned",
    theme: "something they learned or finally understood in the last few days",
    when: "any",
  },
  {
    id: "place",
    theme: "a place they passed through recently",
    when: "any",
  },
  {
    id: "changed",
    theme: "something about their life that has changed since a few months ago",
    when: "any",
  },
  {
    id: "carrying",
    theme: "something they have been carrying around without writing down",
    when: "any",
  },
  {
    id: "reread",
    theme: "a book, a film or a conversation they keep going back to",
    when: "any",
  },
  {
    id: "hands",
    theme: "something they made, fixed or worked on with their hands",
    when: "any",
  },
  {
    id: "weather",
    theme: "the weather where they are today",
    when: "any",
  },
  {
    id: "yearAgo",
    theme: "where they were a year ago",
    when: "any",
  },
  {
    id: "putOff",
    theme: "something they have been putting off",
    when: "any",
  },
  {
    id: "smallGood",
    theme: "one ordinary thing that went right today",
    when: "any",
  },
];

/**
 * A theme to ask about now, or nothing at all.
 *
 * Pure and total: given the same arguments it can only ever return one of the
 * themes above, which is what makes it readable in isolation.
 *
 * `recent` is what has just been asked, so a second press of "another" cannot
 * hand back what is already on the screen. When it has ruled out everything -
 * a short list, or a stretch of the day with few themes of its own - it is
 * ignored rather than obeyed: repeating a theme is better than offering
 * nothing.
 */
export const pickNudge = (
  when: PartOfDay,
  recent: readonly string[] = []
): WritingNudge | null => {
  const suitable = WRITING_NUDGES.filter(
    (nudge) => nudge.when === when || nudge.when === "any"
  );
  const fresh = suitable.filter((nudge) => !recent.includes(nudge.id));
  const pool = fresh.length > 0 ? fresh : suitable;
  if (pool.length === 0) {
    return null;
  }
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
};
