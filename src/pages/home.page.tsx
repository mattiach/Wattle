import { PenLine, Search } from "lucide-react";
import { motion } from "motion/react";
import type { ChangeEvent, Ref } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { EmptyState } from "@/components/empty-state";
import { OnThisDay } from "@/features/entries/on-this-day";
import { PageHeader } from "@/components/layout/page-header";
import { PageIntro } from "@/components/layout/page-intro";
import { SearchResults } from "@/components/search-results";
import { SparkEcho } from "@/features/sparks/spark-echo";
import { WritingNudge } from "@/features/ai/writing-nudge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { EntryList } from "@/features/entries/entry-list";
import { LetterArrival } from "@/features/letters/letter-arrival";
import { SealedLetterCard } from "@/features/letters/sealed-letter-card";
import { partOfDay, todayCalendarDate } from "@/lib/dates";
import { springTransition } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/redux/hooks";
import {
  createEntry,
  dismissMemories,
  dismissSparkEcho,
  fetchEntries,
  fetchOnThisDay,
  fetchSparkEcho,
  removeEntry,
} from "@/redux/slices/entries/entries.slice";
import type { EntrySummary } from "@/redux/slices/entries/entries.types";
import { paths } from "@/routing/paths";

/** The two widths the search field lives at, in pixels rather than classes.
 * A class swap can only be animated by measuring the box and interpolating it
 * with a transform, which scales the icon and the placeholder along with it -
 * the squashing this replaces. A width is a value, and a value can just be
 * animated. */
const CLOSED_WIDTH = 240;
const OPEN_WIDTH = 320;

/** Long enough to swallow a burst of typing, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 220;
/** Fetch the next page slightly before the sentinel is actually on screen. */
const INFINITE_SCROLL_MARGIN = "240px";

/** The day is divided once, in `lib/dates`, so the greeting and the writing
 * nudge under it can never disagree about which part of it this is. */
const GREETING_KEYS = {
  afternoon: "greetingAfternoon",
  evening: "greetingEvening",
  morning: "greetingMorning",
} as const;

interface HomeToolbarProps {
  onCreate: () => void;
  onQueryChange: (event: ChangeEvent<HTMLInputElement>) => void;
  query: string;
  /** True while there is nothing written to search through yet. */
  searchDisabled: boolean;
}

/**
 * One row instead of two full-width blocks.
 *
 * Searching and starting to write are both things you do to the list below, so
 * they share its width rather than each taking a band of the page. The field
 * grows into the row while it is in use and gives the space back when it is
 * not - the enlargement is the affordance, so nothing else has to signal it.
 */
const HomeToolbar = ({
  onCreate,
  onQueryChange,
  query,
  searchDisabled,
}: HomeToolbarProps) => {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  // Still open while a query stands: collapsing the field out from under a
  // live search would hide what the list is being filtered by.
  const isOpen = focused || query !== "";

  const handleFocus = () => setFocused(true);
  const handleBlur = () => setFocused(false);

  const field = (
    <motion.div
      // Wider while in use, not the whole row: the field only needs room for
      // a query, and the action stays anchored to the right edge either way.
      //
      // The width is animated, not laid out. `layout` would project the change
      // as a transform and take the icon and the placeholder with it; nothing
      // here is ever scaled, so nothing here can ever be distorted. The cap
      // stays in the class, where `max-width` still beats an inline width on a
      // narrow window.
      animate={{ width: isOpen ? OPEN_WIDTH : CLOSED_WIDTH }}
      className="relative min-w-0 max-w-full"
      data-tour-step-id="home-search"
      // Nothing to animate from on the first paint: without this the field
      // widens into place on arrival, which reads as the page still loading.
      initial={false}
      // The application's one spring. `bounce: 0` is the point - a field that
      // overshoots its open width and settles back looks like it was thrown
      // rather than opened.
      transition={springTransition}
    >
      <Search
        className={cn(
          "pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 transition-colors duration-200",
          isOpen ? "text-foreground" : "text-faint"
        )}
      />
      <Input
        aria-label={t("search")}
        className="h-10 rounded-full border-transparent bg-muted/60 pl-9 shadow-none transition-colors duration-200 hover:bg-muted focus-visible:border-transparent focus-visible:bg-card"
        disabled={searchDisabled}
        onBlur={handleBlur}
        onChange={onQueryChange}
        onFocus={handleFocus}
        placeholder={t("searchPlaceholder")}
        type="search"
        value={query}
      />
    </motion.div>
  );

  return (
    <div className="mt-5 flex items-center gap-3">
      {/* The tooltip hangs on a wrapper, not on the field: a disabled input
          emits no pointer events, so a trigger on it would never fire - which
          is exactly when the explanation is needed. The cursor has to live here
          for the same reason: the input's own `disabled:cursor-not-allowed`
          cannot apply to a pointer it is not receiving. */}
      {searchDisabled ? (
        <Tooltip>
          <TooltipTrigger
            render={<div className="min-w-0 cursor-not-allowed" />}
          >
            {field}
          </TooltipTrigger>
          <TooltipContent className="max-w-72 leading-relaxed">
            {t("searchDisabledHint")}
          </TooltipContent>
        </Tooltip>
      ) : (
        field
      )}

      <Button
        className="ml-auto shrink-0"
        data-tour-step-id="home-write"
        onClick={onCreate}
        type="button"
      >
        <PenLine />
        {t("newEntry")}
      </Button>
    </div>
  );
};

interface TimelineSentinelProps {
  /** True only while a page is actually on its way. */
  loading: boolean;
  ref: Ref<HTMLDivElement>;
}

/**
 * What the observer watches for, at the foot of the list.
 *
 * It stays mounted for as long as there may be another page, because it is the
 * target - but it only says so while a page is being fetched. A list sitting
 * still under a permanent "Loading" reads as a screen that never finished.
 */
const TimelineSentinel = ({ loading, ref }: TimelineSentinelProps) => {
  const { t } = useTranslation();

  return (
    <div className="pt-8 text-center text-muted-foreground text-sm" ref={ref}>
      {loading ? t("loading") : null}
    </div>
  );
};

export const HomePage = () => {
  const { i18n, t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const entries = useAppSelector((state) => state.entries.list);
  const listStatus = useAppSelector((state) => state.entries.listStatus);
  const hasMore = useAppSelector((state) => state.entries.hasMore);
  const loadedQuery = useAppSelector((state) => state.entries.query);
  const matchCount = useAppSelector((state) => state.entries.matchCount);
  const memories = useAppSelector((state) => state.entries.memories);
  const memoriesDismissed = useAppSelector(
    (state) => state.entries.memoriesDismissed
  );
  const onThisDayEnabled = useAppSelector((state) => state.settings.onThisDay);
  const echo = useAppSelector((state) => state.entries.sparkEcho);
  const echoDismissed = useAppSelector(
    (state) => state.entries.sparkEchoDismissed
  );
  const echoEnabled = useAppSelector((state) => state.settings.sparkEcho);
  const profileName = useAppSelector((state) => state.profile.name);

  const [query, setQuery] = useState("");
  const sentinelRef = useRef<HTMLDivElement>(null);
  const isLoading = listStatus === "loading";

  // Every keystroke restarts the timer and the first page is re-fetched from
  // scratch; on first render this simply searches for nothing.
  useEffect(() => {
    const timer = setTimeout(() => {
      dispatch(fetchEntries({ offset: 0, query }));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [dispatch, query]);

  // Infinite scroll: the sentinel under the list asks for the next page. The
  // query comes from the store, so a page can never be appended to a list that
  // was loaded for a different search.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!(sentinel && hasMore) || isLoading) {
      return;
    }
    const observer = new IntersectionObserver(
      (observed) => {
        if (observed.some((entry) => entry.isIntersecting)) {
          dispatch(
            fetchEntries({ offset: entries.length, query: loadedQuery })
          );
        }
      },
      { rootMargin: INFINITE_SCROLL_MARGIN }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [dispatch, hasMore, isLoading, entries.length, loadedQuery]);

  // Asked once for the day, and only when resurfacing is switched on - reading
  // the journal back should never cost anything the reader did not ask for.
  useEffect(() => {
    if (onThisDayEnabled) {
      dispatch(fetchOnThisDay(todayCalendarDate()));
    }
  }, [dispatch, onThisDayEnabled]);

  useEffect(() => {
    if (echoEnabled) {
      dispatch(fetchSparkEcho(todayCalendarDate()));
    }
  }, [dispatch, echoEnabled]);

  const handleQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
  };

  const handleDismissMemories = () => {
    dispatch(dismissMemories());
  };

  const handleDismissEcho = () => {
    dispatch(dismissSparkEcho());
  };

  // `nudge` is carried in the route's state, never into the document: the entry
  // page turns it into the editor's placeholder, which is gone the moment
  // anything is typed. Nothing a model wrote is ever saved as writing.
  const createToday = async (nudge?: string) => {
    // Not `toISOString()`, which is UTC: writing after midnight in a positive
    // offset - or before it in a negative one - would file the entry a day out.
    const result = await dispatch(createEntry(todayCalendarDate()));
    if (createEntry.fulfilled.match(result)) {
      navigate(
        paths.entries.detail.getHref(result.payload.id),
        nudge ? { state: { nudge } } : undefined
      );
    }
  };

  const handleCreate = async () => {
    await createToday();
  };

  const handleWriteAbout = async (nudge: string) => {
    await createToday(nudge);
  };

  // Confirmation happens in the row's own dialog; this only carries it out.
  //
  // The list is then read again from its first page rather than left as the
  // reducer trimmed it. A search's total is fixed when the page is fetched, so
  // a result removed in place leaves the count above the list saying one too
  // many - and it is announced, so it is read out wrong as well as shown wrong.
  //
  // Deliberately here and not inside `removeEntry`: five pages delete through
  // that thunk and this screen is the only one holding this list, so a reload
  // in there would be four invisible queries and would contradict the spark
  // archive, which filters locally on purpose to keep its scroll position.
  // Every other page either navigates here afterwards or is not mounted, and
  // arriving here re-reads the first page anyway.
  const handleDelete = async (entry: EntrySummary) => {
    await dispatch(removeEntry(entry.id));
    dispatch(fetchEntries({ offset: 0, query: loadedQuery }));
  };

  const handleRetry = () => {
    dispatch(fetchEntries({ offset: 0, query }));
  };

  const today = new Date();
  const greetingKey = GREETING_KEYS[partOfDay(today)];
  const greeting = profileName
    ? t(`${greetingKey}Named`, { name: profileName })
    : t(greetingKey);
  const isError = listStatus === "error";
  const isEmpty = listStatus === "loaded" && entries.length === 0;
  const isSearching = loadedQuery !== "";
  // Only while browsing: a search that returned nothing must not disable the
  // field that is holding the query - that would trap the reader in no results
  // with no way to change them.
  const hasNothingToSearch = isEmpty && !isSearching;
  const canResurface = !(isSearching || isError);
  const showMemories =
    onThisDayEnabled &&
    canResurface &&
    !memoriesDismissed &&
    memories.length > 0;
  const showEcho =
    echoEnabled &&
    canResurface &&
    !echoDismissed &&
    echo !== null &&
    !showMemories;

  return (
    <main className="mx-auto w-full max-w-column flex-1 px-6 pb-28">
      {/* The masthead: the greeting, the day under it, and a hairline that
          separates reading the header from acting on the toolbar below.
          The one screen with no description - an application explaining its
          front door to someone already standing in it is the application
          talking over the journal. */}
      <PageHeader
        subtitle={new Intl.DateTimeFormat(i18n.language, {
          day: "numeric",
          month: "long",
          weekday: "long",
        }).format(today)}
        title={greeting}
      />

      <PageIntro delay={0.05}>
        <HomeToolbar
          onCreate={handleCreate}
          onQueryChange={handleQueryChange}
          query={query}
          searchDisabled={hasNothingToSearch}
        />
      </PageIntro>

      {/* Before the three blocks that look backwards, because it does not look
          backwards: it is the same thing as the button beside it - starting to
          write. Every rule about when it may appear lives inside it. */}
      <WritingNudge browsing={canResurface} onWrite={handleWriteAbout} />

      {/* One line, and only when a letter is actually waiting: the day it
          opens, and nothing about how far away that is. It can be set aside for
          the session. Every rule lives inside it. */}
      <SealedLetterCard browsing={canResurface} />

      {/* Above everything that looks backwards, because it is not looking
          backwards - it is something that arrived today. The one block on this
          screen that cannot be dismissed. */}
      <LetterArrival browsing={canResurface} />

      {/* Above the list, and only while browsing: a memory offered in the
          middle of a search would be an interruption, not a gift. */}
      {showMemories ? (
        <div className="mt-10">
          <OnThisDay memories={memories} onDismiss={handleDismissMemories} />
        </div>
      ) : null}

      {/* Never alongside a memory. Two "look back" blocks above one timeline
          is a wall, not an offering - so on a day that already holds a memory
          the echo stays on the sparks page, where it belongs anyway. */}
      {showEcho ? (
        <div className="mt-10">
          <SparkEcho echo={echo} onDismiss={handleDismissEcho} />
        </div>
      ) : null}

      {/* A failed read must never be mistaken for an empty journal: that is the
          most alarming thing this screen could get wrong. */}
      {isError ? (
        <EmptyState
          action={
            <Button onClick={handleRetry} type="button" variant="outline">
              {t("retry")}
            </Button>
          }
          body={t("listErrorBody")}
          className="mt-24"
          title={t("listErrorTitle")}
        />
      ) : null}

      {isEmpty ? (
        <EmptyState
          body={isSearching ? undefined : t("emptyBody")}
          className="mt-24"
          title={isSearching ? t("noResults") : t("emptyTitle")}
        />
      ) : null}

      {isError || isEmpty ? null : (
        <PageIntro className="mt-10" delay={0.1}>
          {/* Searching answers a different question from browsing, so it gets
              its own presentation: ranked, with the match shown in context. */}
          <div data-tour-step-id="home-timeline">
            {isSearching ? (
              <SearchResults
                entries={entries}
                matchCount={matchCount}
                onDelete={handleDelete}
              />
            ) : (
              <EntryList entries={entries} onDelete={handleDelete} />
            )}
          </div>
          {hasMore ? (
            <TimelineSentinel loading={isLoading} ref={sentinelRef} />
          ) : null}
        </PageIntro>
      )}
    </main>
  );
};
