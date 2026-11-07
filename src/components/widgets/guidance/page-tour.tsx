import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { matchPath, useLocation } from "react-router";

import { TourProvider, useTour } from "@/components/ui/tour";
import type { Tour } from "@/components/ui/tour";
import { useAppDispatch, useAppSelector } from "@/redux/hooks";
import {
  markTourSeen,
  saveSettingsThunk,
} from "@/redux/slices/settings/settings.slice";
import { paths } from "@/routing/paths";

interface TourStepDef {
  contentKey: string;
  /**
   * Matched against `data-tour-step-id` with a **substring** selector, so no id
   * may be a substring of another - `home` would also spotlight
   * `home-timeline`. Prefix per page and keep siblings distinct.
   */
  stepId: string;
  titleKey: string;
}

/**
 * Every tour there is, keyed by the route it belongs to.
 *
 * One place rather than a fragment inside each page, so what the application
 * teaches can be read in one sitting - while each step still names an element
 * of its own page. Only the i18n keys live here: no hooks, no copy, no
 * rendering, which is what keeps this a plain data module.
 *
 * Adding a tour is an entry here plus `data-tour-step-id` attributes. It needs
 * no migration, because a seen tour is only a string in a list.
 */
const TOUR_STEPS: Record<string, TourStepDef[]> = {
  [paths.app.path]: [
    {
      contentKey: "tours.home.write.body",
      stepId: "home-write",
      titleKey: "tours.home.write.title",
    },
    {
      contentKey: "tours.home.search.body",
      stepId: "home-search",
      titleKey: "tours.home.search.title",
    },
    {
      contentKey: "tours.home.timeline.body",
      stepId: "home-timeline",
      titleKey: "tours.home.timeline.title",
    },
    // Last, and the only step that points at something outside the page: the
    // bar is how every other screen in this tour is reached, and nothing on
    // the home screen says so.
    {
      contentKey: "tours.home.nav.body",
      stepId: "app-nav",
      titleKey: "tours.home.nav.title",
    },
  ],
  [paths.calendar.path]: [
    {
      contentKey: "tours.calendar.grid.body",
      stepId: "calendar-grid",
      titleKey: "tours.calendar.grid.title",
    },
    {
      contentKey: "tours.calendar.view.body",
      stepId: "calendar-view",
      titleKey: "tours.calendar.view.title",
    },
    {
      contentKey: "tours.calendar.kinds.body",
      stepId: "calendar-kinds",
      titleKey: "tours.calendar.kinds.title",
    },
  ],
  [paths.sparks.path]: [
    {
      contentKey: "tours.sparks.capture.body",
      stepId: "sparks-capture",
      titleKey: "tours.sparks.capture.title",
    },
    {
      contentKey: "tours.sparks.archive.body",
      stepId: "sparks-archive",
      titleKey: "tours.sparks.archive.title",
    },
    {
      contentKey: "tours.sparks.recent.body",
      stepId: "sparks-recent",
      titleKey: "tours.sparks.recent.title",
    },
  ],
  // A letter is the one thing here that cannot be undone once done, so it is
  // the one thing worth explaining before it is done. The tour on the shelf
  // says what a letter is; the one on the desk says what sealing means.
  [paths.letters.path]: [
    {
      contentKey: "tours.letters.what.body",
      stepId: "letters-what",
      titleKey: "tours.letters.what.title",
    },
    {
      contentKey: "tours.letters.write.body",
      stepId: "letters-write",
      titleKey: "tours.letters.write.title",
    },
    {
      contentKey: "tours.letters.waiting.body",
      stepId: "letters-waiting",
      titleKey: "tours.letters.waiting.title",
    },
  ],
  // Before the dynamic route, exactly as `routes.ts` declares them: `tourIdFor`
  // takes the first pattern that matches, and `/app/letters/:id` matches
  // `/app/letters/new` perfectly well.
  [paths.letters.compose.path]: [
    {
      contentKey: "tours.letterCompose.directions.body",
      stepId: "letter-directions",
      titleKey: "tours.letterCompose.directions.title",
    },
    {
      contentKey: "tours.letterCompose.seal.body",
      stepId: "letter-seal",
      titleKey: "tours.letterCompose.seal.title",
    },
  ],
  // The one screen in Wattle that can only be arrived at once: a letter is
  // sealed until its day, and this is the day.
  [paths.letters.detail.path]: [
    {
      contentKey: "tours.letterRead.opened.body",
      stepId: "letter-read",
      titleKey: "tours.letterRead.opened.title",
    },
    {
      contentKey: "tours.letterRead.keep.body",
      stepId: "letter-keep",
      titleKey: "tours.letterRead.keep.title",
    },
  ],
  // In the order the page itself is read, top to bottom: a tour that jumps
  // about a page it is teaching teaches the page wrong.
  [paths.settings.path]: [
    {
      contentKey: "tours.settings.profile.body",
      stepId: "settings-profile",
      titleKey: "tours.settings.profile.title",
    },
    {
      contentKey: "tours.settings.appearance.body",
      stepId: "settings-appearance",
      titleKey: "tours.settings.appearance.title",
    },
    // Assistance is not on this page any more - it has a destination of its
    // own - so the step that pointed at it went with the section. A step whose
    // anchor is not on the page is a spotlight on nothing.
    {
      contentKey: "tours.settings.data.body",
      stepId: "settings-data",
      titleKey: "tours.settings.data.title",
    },
    {
      contentKey: "tours.settings.reset.body",
      stepId: "settings-reset",
      titleKey: "tours.settings.reset.title",
    },
  ],
  // The surface writing actually happens on, and the one place the slash menu
  // has to be said out loud: nothing on screen announces it.
  [paths.entries.detail.path]: [
    {
      contentKey: "tours.entry.title.body",
      stepId: "entry-title",
      titleKey: "tours.entry.title.title",
    },
    {
      contentKey: "tours.entry.editor.body",
      stepId: "entry-editor",
      titleKey: "tours.entry.editor.title",
    },
    {
      contentKey: "tours.entry.actions.body",
      stepId: "entry-actions",
      titleKey: "tours.entry.actions.title",
    },
  ],
};

/** How long a page gets to put its first step on screen: 10 × 100ms. */
const START_POLL_MS = 100;
const START_ATTEMPTS = 10;

/** The tour belonging to this route, if there is one. */
const tourIdFor = (pathname: string): string | undefined =>
  Object.keys(TOUR_STEPS).find((path) => matchPath(path, pathname));

/**
 * Starts the right tour, once, and remembers that it ran.
 *
 * Separate from the provider because `useTour` has to be called inside it. This
 * is also the only piece that knows about routes and persistence - the overlay
 * in `components/ui/tour.tsx` knows about neither.
 */
const TourRunner = () => {
  const { start } = useTour();
  const { pathname } = useLocation();
  const toursSeen = useAppSelector((state) => state.settings.toursSeen);

  useEffect(() => {
    const tourId = tourIdFor(pathname);
    if (!tourId || toursSeen.includes(tourId)) {
      return;
    }

    const first = TOUR_STEPS[tourId]?.at(0);
    if (!first) {
      return;
    }

    // Only once the step actually has something to point at. An empty journal
    // has no timeline; starting anyway would show nothing and then record the
    // tour as seen, spending it on a blank screen.
    //
    // Polled rather than checked once after paint, because a page whose subject
    // is fetched - an entry - has nothing on screen yet at that moment. Giving
    // up after a second leaves the tour unseen, so it is offered again rather
    // than silently spent.
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (document.querySelector(`[data-tour-step-id*='${first.stepId}']`)) {
        window.clearInterval(timer);
        start(tourId);
      } else if (attempts >= START_ATTEMPTS) {
        window.clearInterval(timer);
      }
    }, START_POLL_MS);

    return () => window.clearInterval(timer);
  }, [pathname, toursSeen, start]);

  return null;
};

/**
 * The guided tours, mounted once beside the rest of the shell.
 *
 * One provider and one route at a time is what makes "only one tour at a time"
 * structural rather than a rule somebody has to remember.
 */
export const PageTour = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  // Memoised because `start` is derived from it, and `TourRunner`'s effect
  // depends on `start`. A fresh array each render would re-run that effect
  // every render and restart the active tour at step one.
  const tours: Tour[] = useMemo(
    () =>
      Object.entries(TOUR_STEPS).map(([id, steps]) => ({
        id,
        steps: steps.map((step, index) => ({
          content: t(step.contentKey),
          id: step.stepId,
          nextLabel: index === steps.length - 1 ? t("tourDone") : t("next"),
          previousLabel: t("previous"),
          title: t(step.titleKey),
        })),
      })),
    [t]
  );

  const handleTourEnd = useCallback(
    (tourId: string) => {
      dispatch(markTourSeen(tourId));
      dispatch(saveSettingsThunk());
    },
    [dispatch]
  );

  const stepLabel = useCallback(
    (current: number, total: number) => t("tourStep", { current, total }),
    [t]
  );

  return (
    <TourProvider
      closeLabel={t("tourClose")}
      onTourEnd={handleTourEnd}
      stepLabel={stepLabel}
      tours={tours}
    >
      <TourRunner />
    </TourProvider>
  );
};
