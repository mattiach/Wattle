import { cn } from "@/lib/utils";
import { daysInMonth, leadingBlanks, toCalendarDate } from "@/lib/dates";
import { useTranslation } from "react-i18next";
import type { DayTally } from "./month-grid";
import { blankCells, EMPTY_TALLY } from "./month-grid";

/**
 * Density as saturation, the way the month view says it with dots: three
 * entries reads as full in both, so a busy day looks the same either way.
 *
 * One colour at four alphas, empty square included. The empty square used to
 * be `--hairline`, which is a border colour: tuned so a 1px line is just
 * visible, it is far too heavy once it fills a whole cell, and in several
 * palettes it out-shouted the one-entry square and ran the ramp backwards.
 * Four alphas of one colour cannot do that whatever the palette.
 */
const DENSITY_FILLS = [
  "bg-wattle/15",
  "bg-wattle/30",
  "bg-wattle/60",
  "bg-wattle",
];

/**
 * The same four steps in the spark colour.
 *
 * A day holding both is painted as an entry day: entries are the longer
 * writing, and a square can only be one colour. The month view, where a day is
 * a row of dots rather than one square, is where both show at once.
 *
 * One colour at three alphas, matching the entry ramp, rather than the three
 * chart slots this used to reach for. `--chart-2/3/4` are categorical: nothing
 * orders them by lightness, so the ramp ran backwards in half the palettes -
 * a three-spark day came out paler than a one-spark day. `--assist` is the
 * second voice every theme defines, always the primary hue rotated, so the
 * steps climb wherever the palette lands.
 */
const SPARK_FILLS = [
  "bg-assist/15",
  "bg-assist/30",
  "bg-assist/60",
  "bg-assist",
];

const densityFill = (tally: DayTally) => {
  const total = tally.entries + tally.sparks;
  const fills = tally.entries > 0 ? DENSITY_FILLS : SPARK_FILLS;
  return fills[Math.min(total, fills.length - 1)];
};

interface YearGridProps {
  counts: Record<string, DayTally>;
  onSelect: (date: string) => void;
  selected: string | null;
  today: string;
  year: number;
}

export const YearGrid = ({
  counts,
  onSelect,
  selected,
  today,
  year,
}: YearGridProps) => {
  const { i18n, t } = useTranslation();
  const monthName = new Intl.DateTimeFormat(i18n.language, { month: "long" });
  const dayName = new Intl.DateTimeFormat(i18n.language, {
    day: "numeric",
    month: "long",
  });

  return (
    // Twelve small blocks rather than twelve wide ones: a year is read at a
    // glance, so the columns get denser instead of the squares getting bigger.
    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 12 }, (_outer, month) => {
        const blanks = leadingBlanks(year, month);
        const dates = Array.from(
          { length: daysInMonth(year, month) },
          (_ignored, dayOffset) =>
            toCalendarDate(new Date(year, month, dayOffset + 1))
        );

        let total = 0;
        for (const date of dates) {
          const tally = counts[date] ?? EMPTY_TALLY;
          total += tally.entries + tally.sparks;
        }

        return (
          <section
            className="w-fit"
            key={monthName.format(new Date(year, month, 1))}
          >
            {/* The month's own total, so a year reads as a year and not just
                as twelve blocks of squares. */}
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <h3 className="eyebrow text-faint">
                {monthName.format(new Date(year, month, 1))}
              </h3>
              {total > 0 ? (
                <span className="eyebrow text-faint tabular-nums">{total}</span>
              ) : null}
            </div>
            {/* Fixed 1rem tracks: the block keeps its size whatever the
                column it lands in, so the year never grows to fill the page. */}
            <div className="grid grid-cols-[repeat(7,0.875rem)] gap-1">
              {blankCells(blanks, `year-${month}`).map((blankId) => (
                <span key={blankId} />
              ))}
              {dates.map((date, dayOffset) => {
                const tally = counts[date] ?? EMPTY_TALLY;
                const count = tally.entries + tally.sparks;
                const handleClick = () => {
                  onSelect(date);
                };
                return (
                  <button
                    aria-label={`${dayName.format(new Date(year, month, dayOffset + 1))}, ${t("entryCount", { count })}`}
                    aria-pressed={selected === date}
                    className={cn(
                      "flex aspect-square items-center justify-center rounded-sm outline-none transition-colors duration-150 hover:ring-1 hover:ring-border focus-visible:ring-2 focus-visible:ring-ring/60",
                      densityFill(tally),
                      // Today is a marker inside the cell and selection is a
                      // ring around it, so the two compose. They used to be two
                      // rings writing the same custom properties, which meant
                      // whichever the stylesheet ordered last simply won.
                      selected === date && "ring-2 ring-ring/60"
                    )}
                    key={date}
                    onClick={handleClick}
                    type="button"
                  >
                    {today === date ? (
                      <span className="size-1 rounded-full bg-foreground/70" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
};
