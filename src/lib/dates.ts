/**
 * Calendar dates, kept out of timezones.
 *
 * An entry's date is the day the writing belongs to, not an instant. Pushing it
 * through UTC - which is what `toISOString()` does - shifts it by a day for
 * anyone whose offset happens to cross midnight, so nothing here ever does.
 */

const pad = (value: number) => `${value}`.padStart(2, "0");

/** The local calendar date of a `Date`, as `YYYY-MM-DD`. */
export const toCalendarDate = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Today, where the user is. */
export const todayCalendarDate = (): string => toCalendarDate(new Date());

/** Reads a `YYYY-MM-DD` back at local midnight. */
export const fromCalendarDate = (value: string): Date =>
  new Date(`${value}T00:00:00`);

const MORNING_END_HOUR = 12;
const AFTERNOON_END_HOUR = 18;

/** Which stretch of the day it is, where the reader is. */
export type PartOfDay = "morning" | "afternoon" | "evening";

/**
 * The hour of the day, named.
 *
 * One definition rather than two: the greeting on the home screen and the
 * writing nudge under it both divide the day, and a day divided differently in
 * two places would greet someone good evening while asking them what their
 * afternoon held.
 */
export const partOfDay = (date = new Date()): PartOfDay => {
  const hour = date.getHours();
  if (hour < MORNING_END_HOUR) {
    return "morning";
  }
  if (hour < AFTERNOON_END_HOUR) {
    return "afternoon";
  }
  return "evening";
};

const MS_PER_DAY = 86_400_000;
const DAYS_PER_MONTH = 30;
const DAYS_PER_YEAR = 365;

/**
 * Whole days from one calendar date to another.
 *
 * Both ends are read at local midnight and the result is rounded, so the one
 * hour a daylight-saving change adds or removes never turns into an off-by-one
 * day.
 */
export const daysBetween = (from: string, to: string): number =>
  Math.round(
    (fromCalendarDate(to).getTime() - fromCalendarDate(from).getTime()) /
      MS_PER_DAY
  );

/**
 * "three months ago", in the interface language.
 *
 * `Intl.RelativeTimeFormat` is native, so neither the phrasing nor the Italian
 * pluralisation is written by hand. It does not pick a unit for you, though -
 * that is the only judgement here, and it is the same one a person makes:
 * days for the recent past, then months, then years.
 */
export const relativeDaysAgo = (language: string, days: number): string => {
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  if (days < DAYS_PER_MONTH) {
    return formatter.format(-days, "day");
  }
  if (days < DAYS_PER_YEAR) {
    return formatter.format(-Math.round(days / DAYS_PER_MONTH), "month");
  }
  return formatter.format(-Math.round(days / DAYS_PER_YEAR), "year");
};

/** The first and last day of a month, as calendar dates. */
export const monthBounds = (year: number, month: number) => ({
  from: toCalendarDate(new Date(year, month, 1)),
  // Day zero of the next month is the last day of this one, leap years included.
  to: toCalendarDate(new Date(year, month + 1, 0)),
});

export const yearBounds = (year: number) => ({
  from: `${year}-01-01`,
  to: `${year}-12-31`,
});

/** How many days a month has. */
export const daysInMonth = (year: number, month: number): number =>
  new Date(year, month + 1, 0).getDate();

/**
 * How many blank cells a month grid starts with, counting from Monday - the
 * week as both interface languages read it.
 */
export const leadingBlanks = (year: number, month: number): number =>
  (new Date(year, month, 1).getDay() + 6) % 7;
