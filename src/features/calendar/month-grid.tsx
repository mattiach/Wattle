import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { daysInMonth, leadingBlanks, toCalendarDate } from "@/lib/dates";

/** Beyond three, a busier day is just a busier day. */
const MAX_DENSITY_DOTS = 3;

/** Weekday names, Monday first, in the interface language. */
const useWeekdayLabels = (language: string) => {
  const formatter = new Intl.DateTimeFormat(language, { weekday: "short" });
  // Any known Monday will do; only the weekday is read off it.
  const monday = new Date(2024, 0, 1);
  return Array.from({ length: 7 }, (_unused, offset) => ({
    // Labels repeat across a week, so each carries its own identity.
    id: `weekday-${offset}`,
    label: formatter.format(new Date(2024, 0, monday.getDate() + offset)),
  }));
};

/** One dot per piece of writing, each stably identified and kind-tagged. */
const dotIds = (date: string, kind: "entry" | "spark", count: number) =>
  Array.from({ length: Math.max(count, 0) }, (_unused, offset) => ({
    id: `${date}-${kind}-${offset}`,
    kind,
  }));

/** Placeholder cells before the first of a month, each stably identified. */
export const blankCells = (count: number, prefix: string) =>
  Array.from(
    { length: count },
    (_unused, offset) => `${prefix}-blank-${offset}`
  );

interface DayCellProps {
  date: string;
  day: number;
  /** Ordinary entries written that day. */
  entries: number;
  isSelected: boolean;
  isToday: boolean;
  onSelect: (date: string) => void;
  /** Sparks written that day, dotted in their own colour. */
  sparks: number;
}

const DayCell = ({
  entries,
  date,
  day,
  isSelected,
  isToday,
  onSelect,
  sparks,
}: DayCellProps) => {
  // Entries first, then sparks, so a day reads left to right in the same order
  // whichever it holds more of.
  const dots = [
    ...dotIds(date, "entry", entries),
    ...dotIds(date, "spark", sparks),
  ].slice(0, MAX_DENSITY_DOTS);
  const count = entries + sparks;

  const handleClick = () => {
    onSelect(date);
  };

  return (
    <button
      aria-pressed={isSelected}
      className={cn(
        // A fixed row height, not a ratio: the column can then be as wide as
        // the composition wants without the month growing taller for it.
        "flex h-9 flex-col items-center justify-center rounded-lg outline-none transition-colors duration-150 ease-out-soft hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60",
        // A ring, not just a fill: the fill alone is what hovering already
        // does, so the selected day was indistinguishable under the cursor.
        isSelected && "bg-accent ring-1 ring-ring/60"
      )}
      onClick={handleClick}
      type="button"
    >
      <span
        className={cn(
          "font-heading text-[0.95rem] text-muted-foreground tabular-nums leading-none",
          count > 0 && "text-foreground",
          isToday && "font-semibold text-wattle-ink"
        )}
      >
        {day}
      </span>
      {/* Density without a score: one dot for a day, a second for a busy one.
          A spark's dot is `--assist` rather than the journal's own accent, so
          the two kinds are told apart without a legend or a second grid. It
          used to be `--chart-3`, which is a categorical slot no theme picks
          for legibility: in clay and umber it landed within 1.2 of the page
          and the dot simply was not there. */}
      <span className="mt-1 flex h-1.5 items-center gap-0.5">
        {dots.map((dot) => (
          <span
            className={cn(
              "size-1.5 rounded-full",
              dot.kind === "spark" ? "bg-assist" : "bg-wattle"
            )}
            key={dot.id}
          />
        ))}
      </span>
    </button>
  );
};

/** What a day holds, split by kind. */
export interface DayTally {
  entries: number;
  sparks: number;
}

/** Nothing written, which is most days. */
export const EMPTY_TALLY: DayTally = { entries: 0, sparks: 0 };

interface MonthGridProps {
  counts: Record<string, DayTally>;
  month: number;
  onSelect: (date: string) => void;
  selected: string | null;
  today: string;
  year: number;
}

export const MonthGrid = ({
  counts,
  month,
  onSelect,
  selected,
  today,
  year,
}: MonthGridProps) => {
  const { i18n } = useTranslation();
  const weekdays = useWeekdayLabels(i18n.language);
  const blanks = leadingBlanks(year, month);
  const days = daysInMonth(year, month);

  return (
    <div className="grid grid-cols-7 gap-1">
      {weekdays.map((weekday) => (
        <span className="eyebrow pb-1 text-center text-faint" key={weekday.id}>
          {weekday.label}
        </span>
      ))}
      {blankCells(blanks, "month").map((blankId) => (
        <span key={blankId} />
      ))}
      {Array.from({ length: days }, (_unused, dayOffset) => {
        const day = dayOffset + 1;
        const date = toCalendarDate(new Date(year, month, day));
        const tally = counts[date] ?? EMPTY_TALLY;
        return (
          <DayCell
            date={date}
            day={day}
            entries={tally.entries}
            isSelected={selected === date}
            isToday={today === date}
            key={date}
            onSelect={onSelect}
            sparks={tally.sparks}
          />
        );
      })}
    </div>
  );
};
