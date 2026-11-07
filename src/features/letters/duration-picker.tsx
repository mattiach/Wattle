import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { fromCalendarDate, toCalendarDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * The eight offered spans.
 *
 * **Relative to choose, absolute to keep.** Picking "1 year" resolves to a
 * calendar date the moment it is pressed, and that date is what is shown, what
 * is stored and what the seal is bound to. Storing "+1 year" and working it out
 * later would make the unlock date depend on when it was read, which is the one
 * thing an unlock date must never do.
 *
 * Months and years are added by the calendar rather than by counting days, so
 * "1 year" from 29 February lands on 1 March rather than on the 28th - the
 * behaviour a person expects from a date, not from a duration.
 */
const PRESETS = [
  { key: "letterIn1Month", months: 1 },
  { key: "letterIn3Months", months: 3 },
  { key: "letterIn6Months", months: 6 },
  { key: "letterIn1Year", months: 12 },
  { key: "letterIn2Years", months: 24 },
  { key: "letterIn3Years", months: 36 },
  { key: "letterIn5Years", months: 60 },
  { key: "letterIn10Years", months: 120 },
] as const;

/** The same floor and ceiling Rust enforces, so the picker cannot offer a date
 * the seal will refuse. Rust is still the authority; this only keeps the
 * interface from proposing something it knows will be turned down. */
const MIN_DAYS_AHEAD = 7;
const MAX_YEARS_AHEAD = 50;

const addMonths = (from: Date, months: number): Date => {
  const target = new Date(from);
  target.setMonth(target.getMonth() + months);
  return target;
};

/**
 * One span, as a control.
 *
 * A component of its own rather than an arrow in the loop: the handler has to
 * be stable across renders, and a span is the only thing it needs to close
 * over.
 */
const PresetButton = ({
  chosen,
  labelKey,
  months,
  onPick,
}: {
  chosen: boolean;
  labelKey: string;
  months: number;
  onPick: (months: number) => void;
}) => {
  const { t } = useTranslation();
  const handleClick = useCallback(() => onPick(months), [months, onPick]);

  return (
    <Button
      aria-pressed={chosen}
      className={cn(chosen && "border-wattle text-wattle-ink")}
      onClick={handleClick}
      size="sm"
      type="button"
      variant="outline"
    >
      {t(labelKey)}
    </Button>
  );
};

interface DurationPickerProps {
  onChange: (unlockOn: string) => void;
  /** The chosen date as `YYYY-MM-DD`, or empty while none has been chosen. */
  value: string;
}

/**
 * When this letter opens.
 *
 * Eight presses for the common cases and one calendar for "my daughter's
 * eighteenth birthday", which is the most compelling use this feature has. The
 * resolved date appears the moment a span is chosen, because the date is the
 * thing being decided - the span is only a convenient way to say it.
 *
 * There is no countdown here and there is none anywhere else. A letter with a
 * timer on it is a letter that nags.
 */
export const DurationPicker = ({ onChange, value }: DurationPickerProps) => {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);

  const today = useMemo(() => new Date(), []);
  const earliest = useMemo(() => {
    const day = new Date(today);
    day.setDate(day.getDate() + MIN_DAYS_AHEAD);
    return day;
  }, [today]);
  const latest = useMemo(() => {
    const day = new Date(today);
    day.setFullYear(day.getFullYear() + MAX_YEARS_AHEAD);
    return day;
  }, [today]);

  const selected = value ? fromCalendarDate(value) : undefined;

  // `Intl` rather than a locale bundle, for the reason `DateField` gives: the
  // language picker offers sixteen codes and only two have catalogues.
  const formatters = useMemo(() => {
    const month = new Intl.DateTimeFormat(i18n.language, { month: "long" });
    const monthShort = new Intl.DateTimeFormat(i18n.language, {
      month: "short",
    });
    const weekday = new Intl.DateTimeFormat(i18n.language, {
      weekday: "short",
    });
    const year = new Intl.DateTimeFormat(i18n.language, { year: "numeric" });
    return {
      formatCaption: (date: Date) =>
        `${month.format(date)} ${year.format(date)}`,
      formatMonthDropdown: (date: Date) => monthShort.format(date),
      formatWeekdayName: (date: Date) => weekday.format(date),
      formatYearDropdown: (date: Date) => year.format(date),
    };
  }, [i18n.language]);

  const handlePreset = useCallback(
    (months: number) => {
      onChange(toCalendarDate(addMonths(today, months)));
    },
    [onChange, today]
  );

  const handleSelect = (next: Date | undefined) => {
    if (!next) {
      return;
    }
    onChange(toCalendarDate(next));
    setOpen(false);
  };

  return (
    <div className="flex flex-wrap gap-2">
      {PRESETS.map((preset) => (
        <PresetButton
          chosen={value === toCalendarDate(addMonths(today, preset.months))}
          key={preset.key}
          labelKey={preset.key}
          months={preset.months}
          onPick={handlePreset}
        />
      ))}
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger
          render={<Button size="sm" type="button" variant="outline" />}
        >
          {t("letterPickDate")}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-2">
          <Calendar
            autoFocus
            captionLayout="dropdown"
            defaultMonth={selected ?? earliest}
            // A day too close is not offered rather than offered and refused:
            // the floor is a rule about what a letter is, not a mistake to
            // correct after the fact.
            disabled={{ before: earliest }}
            endMonth={latest}
            formatters={formatters}
            mode="single"
            onSelect={handleSelect}
            selected={selected}
            startMonth={earliest}
            // Monday, as every other week in the application already counts.
            weekStartsOn={1}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
};
