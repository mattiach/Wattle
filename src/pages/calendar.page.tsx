import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, PenLine } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { MonthGrid } from "@/features/calendar/month-grid";
import type { DayTally } from "@/features/calendar/month-grid";
import { PageHeader } from "@/components/layout/page-header";
import { PageIntro } from "@/components/layout/page-intro";
import { EntryResultRow } from "@/components/search-results";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { YearGrid } from "@/features/calendar/yeargrid";
import { monthBounds, todayCalendarDate, yearBounds } from "@/lib/dates";
import { arrivalTransition } from "@/lib/motion";
import { useAppDispatch } from "@/redux/hooks";
import { createEntry } from "@/redux/slices/entries/entries.slice";
import { paths } from "@/routing/paths";

import type { EntrySummary } from "@/redux/slices/entries/entries.types";

/** A day, and what was written on it, split by kind. */
interface DayCount {
  count: number;
  date: string;
  sparks: number;
}

/** How far the card leans as it changes day. A direction, not a slide. */
const DAY_SHIFT_PX = 8;

/**
 * Arriving from the way you are going, and leaving back the way it came.
 *
 * The two halves are mirror images on purpose. Leaving towards the *opposite*
 * side reads as travel only while something is arriving to take the place; on a
 * day with nothing written there is no such thing, and the card set off across
 * the page on its own before vanishing. Retracing is right either way: what
 * leaves undoes what it did to arrive.
 *
 * Variants rather than plain objects because the direction is only known at the
 * moment each half runs: `custom` is what carries it in, and on the way out
 * `AnimatePresence` supplies whichever value is current by then - the pick that
 * pushed this card out.
 */
const dayVariants = {
  arriving: (direction: number) => ({
    opacity: 0,
    x: direction * DAY_SHIFT_PX,
  }),
  leaving: (direction: number) => ({
    opacity: 0,
    x: direction * DAY_SHIFT_PX,
  }),
  settled: { opacity: 1, x: 0 },
};

type CalendarView = "month" | "year";

/**
 * Which kinds of writing the grid is showing.
 *
 * Not a filter over a search - a way of looking at the same year. "Both" is the
 * default because a journal is both, and the two are told apart by colour
 * rather than by having to choose between them.
 */
type CalendarKinds = "both" | "entry" | "spark";

/** Enough for any single day; a day with more than this is not a real journal. */
const DAY_ENTRY_LIMIT = 100;

export const CalendarPage = () => {
  const { i18n, t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const today = todayCalendarDate();
  const [view, setView] = useState<CalendarView>("month");
  const [kinds, setKinds] = useState<CalendarKinds>("both");
  const [cursor, setCursor] = useState(() => new Date());
  const [counts, setCounts] = useState<Record<string, DayTally>>({});
  const [selected, setSelected] = useState<string | null>(null);
  // Which way through the calendar the last pick went: forwards into the month
  // or back through it. The card leans that way as it changes, so moving from
  // day to day reads as travel rather than as a redraw.
  const [towards, setTowards] = useState(1);

  const handleSelect = (date: string) => {
    setTowards(selected && date < selected ? -1 : 1);
    setSelected(date);
  };
  const [dayEntries, setDayEntries] = useState<EntrySummary[]>([]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  // Counts for whatever is on screen. Kept local rather than in the entries
  // slice so browsing the calendar never disturbs the list on the home screen.
  //
  // Fetched whole and filtered here: the answer for a month is a few dozen rows
  // either way, and asking again on every flick of the filter would be a round
  // trip for something already in hand.
  useEffect(() => {
    const range =
      view === "month" ? monthBounds(year, month) : yearBounds(year);
    let cancelled = false;
    invoke<DayCount[]>("entry_dates_in_range", range).then((days) => {
      if (!cancelled) {
        setCounts(
          Object.fromEntries(
            days.map((day) => [
              day.date,
              { entries: day.count - day.sparks, sparks: day.sparks },
            ])
          )
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [view, year, month]);

  useEffect(() => {
    if (!selected) {
      setDayEntries([]);
      return;
    }
    let cancelled = false;
    // Emptied first, not left to be overwritten when the answer comes: the
    // section is keyed on the date, so a new day used to mount holding the
    // previous day's rows and then drop them a frame later - which is what made
    // picking a quiet day look like something collapsing rather than something
    // ending.
    setDayEntries([]);
    invoke<EntrySummary[]>("list_entries", {
      from: selected,
      kind: kinds === "both" ? "" : kinds,
      limit: DAY_ENTRY_LIMIT,
      offset: 0,
      query: "",
      to: selected,
    }).then((entries) => {
      if (!cancelled) {
        setDayEntries(entries);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selected, kinds]);

  const step = useCallback(
    (direction: number) => {
      setCursor((current) =>
        view === "month"
          ? new Date(current.getFullYear(), current.getMonth() + direction, 1)
          : new Date(current.getFullYear() + direction, current.getMonth(), 1)
      );
    },
    [view]
  );

  const handlePrevious = () => {
    step(-1);
  };
  const handleNext = () => {
    step(1);
  };

  // The day being looked at, or today when none has been picked. Writing into
  // a past day is the whole reason this button is here rather than only on the
  // home screen, where it can only ever mean "now".
  const writingDay = selected ?? today;
  const handleWrite = async () => {
    const result = await dispatch(createEntry(writingDay));
    if (createEntry.fulfilled.match(result)) {
      navigate(paths.entries.detail.getHref(result.payload.id));
    }
  };

  // A view of the same counts, not a second fetch: hiding a kind sets it to
  // zero, so the grid draws exactly what the filter says and the day numerals
  // dim with it.
  const shown: Record<string, DayTally> =
    kinds === "both"
      ? counts
      : Object.fromEntries(
          Object.entries(counts).map(([date, tally]) => [
            date,
            {
              entries: kinds === "entry" ? tally.entries : 0,
              sparks: kinds === "spark" ? tally.sparks : 0,
            },
          ])
        );

  const heading =
    view === "month"
      ? new Intl.DateTimeFormat(i18n.language, {
          month: "long",
          year: "numeric",
        }).format(new Date(year, month, 1))
      : `${year}`;

  return (
    <main className="mx-auto w-full max-w-column flex-1 px-6 pb-28">
      <PageHeader description={t("calendarIntro")} title={t("calendar")} />

      {/* The home screen's button, unchanged: same variant, same size, same
          icon. Starting to write is one action wherever it is offered, so it
          should not look like two. Only the label changes, and only when a day
          is picked - here it can mean a day that has already passed. */}
      <div className="mt-4 flex justify-end">
        <Button onClick={handleWrite} type="button">
          <PenLine />
          {selected ? t("writeOnThisDay") : t("newEntry")}
        </Button>
      </div>

      {/* Everything that points the grid at something, on one line: which month
          is being looked at on the left, and on the right what is being shown in
          it - the kinds first, then the span. Both are questions about the same
          grid, and they were a screen apart, which made the filter read as a
          property of the page rather than of the calendar under it. */}
      <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-0.5">
          <Button
            aria-label={t("previous")}
            className="text-muted-foreground"
            onClick={handlePrevious}
            size="icon-sm"
            variant="ghost"
          >
            <ChevronLeft />
          </Button>
          {/* Wide enough for the longest month name in either language and no
              wider: the arrows sit against the name rather than a hand's width
              away from it, and still do not shuffle sideways as the months
              change length. */}
          <h2 className="min-w-36 text-center font-heading text-[1.15rem] text-foreground capitalize">
            {heading}
          </h2>
          <Button
            aria-label={t("next")}
            className="text-muted-foreground"
            onClick={handleNext}
            size="icon-sm"
            variant="ghost"
          >
            <ChevronRight />
          </Button>
        </div>
        {/* Two questions, not one: what is being shown, and over how long.
            Set apart by a gap and a rule between them, because sitting flush
            they read as a single control with four choices in it. */}
        <div className="flex flex-wrap items-center gap-3">
          <div data-tour-step-id="calendar-kinds">
            <Segmented<CalendarKinds>
              onValueChange={setKinds}
              options={[
                { label: t("calendarBoth"), value: "both" },
                { label: t("calendarEntriesOnly"), value: "entry" },
                { label: t("calendarSparksOnly"), value: "spark" },
              ]}
              value={kinds}
            />
          </div>
          <span
            aria-hidden="true"
            className="h-5 w-px bg-hairline max-sm:hidden"
          />
          <div data-tour-step-id="calendar-view">
            <Segmented<CalendarView>
              onValueChange={setView}
              options={[
                { label: t("month"), value: "month" },
                { label: t("year"), value: "year" },
              ]}
              value={view}
            />
          </div>
        </div>
      </div>

      {/* Close under its own controls: the month header and the grid it names
          are one block, and the gap above them is what separates that block
          from the page-level row further up. */}
      <PageIntro className="mt-4" delay={0.05}>
        <div data-tour-step-id="calendar-grid">
          {view === "month" ? (
            <MonthGrid
              counts={shown}
              month={month}
              onSelect={handleSelect}
              selected={selected}
              today={today}
              year={year}
            />
          ) : (
            <YearGrid
              counts={shown}
              onSelect={handleSelect}
              selected={selected}
              today={today}
              year={year}
            />
          )}
        </div>
      </PageIntro>

      {/* One card, sitting close under the grid: the selection has to read as
          having produced this, not as having merely highlighted a cell.

          Going from one day to the next is the common move here, and it used
          to be a cut: the old day vanished on the same frame the new one began
          to fade in, which read as the page reloading. Now a day arrives from
          the way you are going and leaves back the way it came, so a run of
          clicks along a week reads as moving along it rather than as a page
          being redrawn.

          `wait` rather than `popLayout`: `popLayout` lifts the outgoing card
          out of the flow on the frame it starts leaving, so everything under it
          jumped up while it was still on screen - the card appeared to sink,
          though it never moved down. Waiting keeps it in the flow until it has
          finished, and the space closes only once there is nothing left in it.
          The distance is eight pixels - enough to have a direction, not enough
          to be a slide.

          A day with nothing written mounts nothing at all rather than an empty
          section: there is no card to be seen, so there is no card. */}
      <AnimatePresence custom={towards} initial={false} mode="wait">
        {selected && dayEntries.length > 0 ? (
          <motion.section
            animate="settled"
            className="mt-6"
            custom={towards}
            exit="leaving"
            initial="arriving"
            key={selected}
            transition={arrivalTransition}
            variants={dayVariants}
          >
            {/* The home screen's rows: same date rail, same card, same
                `gap-4` between them. A day's entries are the same entries, so
                finding them here should not look like a different journal.
                `uniform` is the one departure - here a spark is shaped like
                an entry and says what it is in a word, because this list is
                one answer to "what did I write that day" rather than two. */}
            <ul className="mt-4 flex flex-col gap-4">
              {dayEntries.map((entry) => (
                <EntryResultRow entry={entry} key={entry.id} uniform />
              ))}
            </ul>
          </motion.section>
        ) : null}
      </AnimatePresence>
    </main>
  );
};
