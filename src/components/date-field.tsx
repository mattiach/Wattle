import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { fromCalendarDate, toCalendarDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * How far the month and year dropdowns reach.
 *
 * Left alone, react-day-picker stops the year list at the end of the current
 * one - which would make it impossible to re-file an entry into next January,
 * and a journal is written across new years more often than most things are.
 * Backwards is generous because a journal can be started from old notebooks.
 */
const YEARS_BACK = 40;
const YEARS_FORWARD = 1;

interface DateFieldProps {
  "aria-label": string;
  /**
   * How the date is set, which is the only thing that differs between the two
   * places it appears: an entry wears it as a small-caps line above its title,
   * a spark wears it *as* its title. The affordances - the caret, the focus
   * ring, the truncation - are the same either way and are not this prop's
   * business, so every caller says only what it wants said differently.
   */
  className?: string;
  /** Locked entries still show their date; they just cannot be re-filed. */
  disabled?: boolean;
  onChange: (value: string) => void;
  /** A plain `YYYY-MM-DD` calendar date, never a timestamp. */
  value: string;
}

/**
 * An editable date that still reads as a sentence.
 *
 * The visible text is the date written out in the interface language, and it is
 * also the control: clicking it opens a calendar under it. The line of prose is
 * the point - a header should read as a header, not as a form - so the calendar
 * arrives in a popover and leaves again, rather than sitting in the layout.
 *
 * **It used to be a native `<input type="date">` laid over the text**, which
 * meant the picker was whatever the platform's WebView felt like drawing. That
 * bought locale handling for free, and it is the one thing worth being careful
 * about now that it is drawn here instead: nothing below hardcodes a month
 * name, a weekday or a week start it invented.
 */
export const DateField = ({
  "aria-label": ariaLabel,
  className,
  disabled,
  onChange,
  value,
}: DateFieldProps) => {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);

  // Parsed at local midnight, so the day shown is the day stored - a plain
  // calendar date must never be pushed through a timezone.
  const selected = value ? fromCalendarDate(value) : undefined;

  const formatted = selected
    ? new Intl.DateTimeFormat(i18n.language, {
        day: "numeric",
        month: "long",
        weekday: "long",
        year: "numeric",
      }).format(selected)
    : "";

  // `Intl` rather than a date library's locale objects: the language picker
  // offers sixteen codes and only two have catalogues, so a locale import would
  // put fourteen of them into English months. `Intl` speaks all of them, and it
  // is what every other date in Wattle is already written with.
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

  const thisYear = new Date().getFullYear();

  const handleSelect = (next: Date | undefined) => {
    // Clearing would leave an entry with no date at all; the previous one
    // stands until a real date is chosen.
    if (!next) {
      return;
    }
    onChange(toCalendarDate(next));
    setOpen(false);
  };

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <button
            aria-label={ariaLabel}
            className={cn(
              // Opacity rather than a colour, so the same hover reads at both
              // sizes: a title is already `text-foreground` and has nowhere
              // darker to go.
              "min-w-0 cursor-pointer truncate rounded-sm text-left outline-none transition-opacity duration-150 hover:opacity-70 focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-default disabled:hover:opacity-100",
              className
            )}
            disabled={disabled}
            type="button"
          />
        }
      >
        {formatted}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <Calendar
          autoFocus
          captionLayout="dropdown"
          defaultMonth={selected}
          endMonth={new Date(thisYear + YEARS_FORWARD, 11)}
          formatters={formatters}
          mode="single"
          onSelect={handleSelect}
          selected={selected}
          startMonth={new Date(thisYear - YEARS_BACK, 0)}
          // Monday, as `leadingBlanks` counts and as the calendar page, the
          // year grid all already assume. Left to
          // itself react-day-picker would start the week on Sunday and put this
          // picker out of step with every other week in the application.
          weekStartsOn={1}
        />
      </PopoverContent>
    </Popover>
  );
};
