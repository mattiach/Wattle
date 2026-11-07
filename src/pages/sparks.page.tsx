import { invoke } from "@tauri-apps/api/core";
import { ArrowRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { EmptyState } from "@/components/empty-state";
import { PageIntro } from "@/components/layout/page-intro";
import { SparkCard } from "@/features/sparks/spark-card";
import { SparkCapture } from "@/features/sparks/spark-composer";
import { SparkEcho } from "@/features/sparks/spark-echo";
import { SparkPageHeader } from "@/features/sparks/spark-page-header";
import { Button } from "@/components/ui/button";
import { todayCalendarDate } from "@/lib/dates";
import { springTransition } from "@/lib/motion";
import { useAppDispatch, useAppSelector } from "@/redux/hooks";
import {
  dismissSparkEcho,
  fetchSparkEcho,
  removeEntry,
} from "@/redux/slices/entries/entries.slice";
import { paths } from "@/routing/paths";

import type { EntrySummary } from "@/redux/slices/entries/entries.types";

/** Enough to remember the week by; the rest is one click away. */
const RECENT_SPARK_LIMIT = 6;

/** Enter: fade and rise. Exit: fade and collapse out of the grid. */
const listItemInitial = { opacity: 0, y: 8 };
const listItemAnimate = { opacity: 1, y: 0 };
const listItemExit = { opacity: 0, scale: 0.97 };

export const SparksPage = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const echo = useAppSelector((state) => state.entries.sparkEcho);
  const echoDismissed = useAppSelector(
    (state) => state.entries.sparkEchoDismissed
  );
  const echoEnabled = useAppSelector((state) => state.settings.sparkEcho);

  const today = todayCalendarDate();
  const [sparks, setSparks] = useState<EntrySummary[]>([]);

  // Local state, like the calendar: reading sparks must not disturb the list
  // the home screen is showing.
  const refresh = useCallback(async () => {
    const entries = await invoke<EntrySummary[]>("list_entries", {
      kind: "spark",
      limit: RECENT_SPARK_LIMIT,
      offset: 0,
      query: "",
    });
    setSparks(entries);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Asked once for the day, and only when the echo is switched on.
  useEffect(() => {
    if (echoEnabled) {
      dispatch(fetchSparkEcho(today));
    }
  }, [dispatch, echoEnabled, today]);

  const handleDelete = useCallback(
    async (spark: EntrySummary) => {
      await dispatch(removeEntry(spark.id));
      await refresh();
    },
    [dispatch, refresh]
  );

  const handleDismissEcho = () => {
    dispatch(dismissSparkEcho());
  };

  return (
    <main className="mx-auto w-full max-w-column flex-1 px-6 pb-28">
      <SparkPageHeader
        description={t("sparksIntro")}
        title={t("dailySparks")}
      />

      {/* Today's sheet, the same one the archive carries. */}
      <PageIntro delay={0.05}>
        <SparkCapture className="mt-8" onSaved={refresh} />
      </PageIntro>

      {/* The last handful, and a way through to all of them. Browsing month by
          month made the reader navigate before they could read anything. */}
      <PageIntro className="mt-12" delay={0.1}>
        <section>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="eyebrow text-faint">{t("pastSparks")}</h2>
            <Button
              className="text-muted-foreground"
              data-tour-step-id="sparks-archive"
              nativeButton={false}
              render={<Link to={paths.sparks.all.getHref()} />}
              size="sm"
              variant="ghost"
            >
              {t("allSparks")}
              <ArrowRight />
            </Button>
          </div>
          {sparks.length > 0 ? (
            // Six items at most, so the layout animation stays cheap - the
            // archive deliberately does not do this.
            <ul
              className="grid gap-3 sm:grid-cols-2"
              data-tour-step-id="sparks-recent"
            >
              <AnimatePresence initial={false}>
                {sparks.map((spark) => (
                  <motion.li
                    animate={listItemAnimate}
                    exit={listItemExit}
                    initial={listItemInitial}
                    key={spark.id}
                    layout
                    transition={springTransition}
                  >
                    <SparkCard onDelete={handleDelete} spark={spark} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          ) : (
            // The same shape every other empty surface in the application
            // uses. A line of small italics read as a search that had failed
            // rather than as a page waiting to be written on.
            <EmptyState
              body={t("emptySparksBody")}
              className="mt-16"
              title={t("emptySparksTitle")}
            />
          )}
        </section>
      </PageIntro>

      {/* Always here, whether or not a memory is on the home screen: this is
          the sparks' own surface, so the echo belongs to it. */}
      {echoEnabled && !echoDismissed && echo ? (
        <div className="mt-14">
          <SparkEcho echo={echo} onDismiss={handleDismissEcho} />
        </div>
      ) : null}
    </main>
  );
};
