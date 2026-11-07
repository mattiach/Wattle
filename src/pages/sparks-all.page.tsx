import { invoke } from "@tauri-apps/api/core";
import { Search, Trash2 } from "lucide-react";
import type { ChangeEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageIntro } from "@/components/layout/page-intro";
import { Snippet } from "@/components/search-results";
import { SparkCapture } from "@/features/sparks/spark-composer";
import { SparkPageHeader } from "@/features/sparks/spark-page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { groupByMonth } from "@/features/entries/entry-list";
import { fromCalendarDate } from "@/lib/dates";
import { useAppDispatch } from "@/redux/hooks";
import { removeEntry } from "@/redux/slices/entries/entries.slice";
import type { EntrySummary } from "@/redux/slices/entries/entries.types";
import { paths } from "@/routing/paths";

/** Long enough to swallow a burst of typing, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 220;
/**
 * One page of the archive.
 *
 * There is still a limit - hundreds of rows is a DOM cost, not a SQLite one -
 * but it no longer lies. When a page comes back full there may be more, and
 * the reader is told so and given the control, rather than being shown a wall
 * that silently stops.
 */
const SPARK_PAGE_SIZE = 100;

interface SparkRowProps {
  onDelete: (spark: EntrySummary) => void;
  spark: EntrySummary;
}

/**
 * Denser than a card, because the archive is for reading many at once. The
 * date sits on its own rail to the left and the fragment keeps the spark
 * marker, so a month scans as a column of days with thoughts beside them.
 */
const SparkRow = ({ onDelete, spark }: SparkRowProps) => {
  const { i18n, t } = useTranslation();
  const date = fromCalendarDate(spark.entryDate);

  const handleConfirmDelete = useCallback(() => {
    onDelete(spark);
  }, [onDelete, spark]);

  return (
    <li className="group/row relative border-hairline border-b last:border-b-0">
      <Link
        className="group grid grid-cols-[3.5rem_minmax(0,1fr)] gap-4 rounded-lg py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        to={paths.sparks.detail.getHref(spark.id)}
      >
        <div className="pt-0.5">
          <p className="font-heading font-light text-[1.35rem] text-foreground tabular-nums leading-none">
            {new Intl.DateTimeFormat(i18n.language, { day: "numeric" }).format(
              date
            )}
          </p>
          <p className="mt-1.5 text-[0.75rem] text-muted-foreground capitalize leading-tight">
            {new Intl.DateTimeFormat(i18n.language, {
              weekday: "short",
            }).format(date)}
          </p>
        </div>
        <div className="spark-rail min-w-0 pr-9 pl-4">
          {spark.snippet ? (
            <Snippet
              className="font-serif text-body-sm text-foreground/90 italic leading-relaxed"
              snippet={spark.snippet}
            />
          ) : (
            <p className="font-serif text-body-sm text-foreground/90 italic leading-relaxed">
              {spark.preview}
            </p>
          )}
        </div>
      </Link>

      <ConfirmDialog
        confirmLabel={t("delete")}
        description={t("deleteSparkConfirm")}
        onConfirm={handleConfirmDelete}
        title={t("deleteSpark")}
        trigger={
          <Button
            aria-label={t("deleteSpark")}
            className="absolute top-3 right-0 text-muted-foreground opacity-0 transition-opacity duration-200 ease-out-soft hover:text-destructive focus-visible:opacity-100 group-focus-within/row:opacity-100 group-hover/row:opacity-100"
            size="icon-sm"
            type="button"
            variant="destructiveGhost"
          />
        }
      >
        <Trash2 />
      </ConfirmDialog>
    </li>
  );
};

export const SparksAllPage = () => {
  const { i18n, t } = useTranslation();
  const dispatch = useAppDispatch();

  const [query, setQuery] = useState("");
  const [sparks, setSparks] = useState<EntrySummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Told apart from "no sparks" on purpose: before the first read has come
  // back, an empty list means nothing yet - and disabling the field on that
  // would flash a disabled search on every visit.
  const [hasRead, setHasRead] = useState(false);

  const readPage = useCallback(
    (searchQuery: string, offset: number) =>
      invoke<EntrySummary[]>("list_entries", {
        kind: "spark",
        limit: SPARK_PAGE_SIZE,
        offset,
        query: searchQuery,
      }),
    []
  );

  // Every keystroke restarts the timer and the list starts over; on first
  // render this simply asks for everything.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      readPage(query, 0).then((page) => {
        if (!cancelled) {
          setSparks(page);
          setHasMore(page.length === SPARK_PAGE_SIZE);
          setHasRead(true);
        }
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, readPage]);

  const handleQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
  };

  // A spark written here belongs at the top of the list it was written above,
  // so the first page is read again rather than waiting for the next visit.
  const handleCaptured = useCallback(async () => {
    const page = await readPage(query, 0);
    setSparks(page);
    setHasMore(page.length === SPARK_PAGE_SIZE);
  }, [query, readPage]);

  // The `offset` `list_entries` already accepts. A full page back means there
  // may be another one, which is what the notice above this control says.
  const handleLoadOlder = async () => {
    setLoadingMore(true);
    try {
      const page = await readPage(query, sparks.length);
      setSparks((current) => [...current, ...page]);
      setHasMore(page.length === SPARK_PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  };

  // A deleted spark leaves the list without re-fetching the pages already
  // loaded, so scrolling position and "load older" state survive it.
  const handleDelete = useCallback(
    async (spark: EntrySummary) => {
      await dispatch(removeEntry(spark.id));
      setSparks((current) => current.filter((row) => row.id !== spark.id));
    },
    [dispatch]
  );

  const isSearching = query.trim() !== "";
  // Only while browsing: a search that found nothing must not disable the field
  // holding the query, which would trap the reader in no results.
  const searchDisabled = hasRead && sparks.length === 0 && !isSearching;
  const monthLabel = new Intl.DateTimeFormat(i18n.language, {
    month: "long",
    year: "numeric",
  });

  const searchField = (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        aria-label={t("searchSparks")}
        className="h-10 pl-9"
        disabled={searchDisabled}
        onChange={handleQueryChange}
        placeholder={t("searchSparksPlaceholder")}
        type="search"
        value={query}
      />
    </div>
  );

  return (
    <main className="mx-auto w-full max-w-column flex-1 px-6 pb-28">
      <SparkPageHeader
        back
        description={t("allSparksIntro")}
        title={t("allSparks")}
      />

      {/* The same sheet the sparks page opens with: reading the archive is the
          most likely moment for the next thought to arrive, and having to
          navigate back to write it down is how thoughts get lost. */}
      <PageIntro delay={0.05}>
        <SparkCapture className="mt-8" onSaved={handleCaptured} />
      </PageIntro>

      {/* `mt-12`, the gap the sparks page leaves between the sheet and what
          follows it: the two screens keep the same vertical rhythm, so only
          what fills the third block tells them apart. */}
      <PageIntro className="mt-12" delay={0.1}>
        {/* The tooltip hangs on a wrapper, not on the field: a disabled input
            emits no pointer events, so a trigger on it would never fire -
            which is exactly when the explanation is needed. */}
        {searchDisabled ? (
          <Tooltip>
            <TooltipTrigger render={<div className="cursor-not-allowed" />}>
              {searchField}
            </TooltipTrigger>
            <TooltipContent className="max-w-72 leading-relaxed">
              {t("searchSparksDisabledHint")}
            </TooltipContent>
          </Tooltip>
        ) : (
          searchField
        )}
      </PageIntro>

      {sparks.length === 0 ? (
        <EmptyState
          body={isSearching ? undefined : t("emptySparksBody")}
          className="mt-24"
          title={isSearching ? t("noSparkResults") : t("emptySparksTitle")}
        />
      ) : (
        <div className="mt-10">
          <p aria-live="polite" className="eyebrow mb-4 text-faint">
            {t("sparkCount", { count: sparks.length })}
          </p>
          {/* Searching answers a different question from browsing: the best
              match leads, and the month headings would only get in the way. */}
          {isSearching ? (
            <ul className="flex flex-col">
              {sparks.map((spark) => (
                <SparkRow
                  key={spark.id}
                  onDelete={handleDelete}
                  spark={spark}
                />
              ))}
            </ul>
          ) : (
            <div className="flex flex-col gap-10">
              {groupByMonth(sparks).map((group) => (
                <section key={group.key}>
                  <h2 className="eyebrow mb-1 text-faint">
                    {monthLabel.format(new Date(`${group.key}-01T00:00:00`))}
                  </h2>
                  <ul className="flex flex-col">
                    {group.entries.map((spark) => (
                      <SparkRow
                        key={spark.id}
                        onDelete={handleDelete}
                        spark={spark}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}

          {/* Said out loud rather than left as a silent cut-off. */}
          {hasMore ? (
            <div className="mt-8 flex flex-col items-center gap-3">
              <p className="text-meta text-muted-foreground">
                {t("sparkTruncated", { count: sparks.length })}
              </p>
              <Button
                disabled={loadingMore}
                onClick={handleLoadOlder}
                size="sm"
                type="button"
                variant="outline"
              >
                {loadingMore ? t("loading") : t("loadOlder")}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </main>
  );
};
