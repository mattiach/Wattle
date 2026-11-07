import { lazy, Suspense } from "react";
import { Outlet } from "react-router";

import { BackToTop } from "@/components/widgets/navigation/back-to-top";
import { FloatingNav } from "@/components/widgets/navigation/floating-nav";
import { PageTour } from "@/components/widgets/guidance/page-tour";
import { TopNav } from "@/components/widgets/navigation/top-nav";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/redux/hooks";

/**
 * Setting up a journal happens once, and never again.
 *
 * Fetched when that once arrives rather than carried into every launch after
 * it: the flow holds the five steps, the restore, and the language select with
 * sixteen flags behind it - a fair weight for a screen almost nobody will see
 * twice. Nothing is drawn while it arrives, because the alternative is a frame
 * of the application it is standing in front of.
 */
const Onboarding = lazy(async () => ({
  default: (await import("@/components/widgets/guidance/onboarding"))
    .Onboarding,
}));

/**
 * Shell for the top-level screens. Both navigations live here, so they stay
 * mounted across route changes and every page inherits the user's preference.
 */
export const AppLayout = () => {
  const navigation = useAppSelector((state) => state.settings.navigation);
  const onboarded = useAppSelector((state) => state.settings.onboarded);

  // Instead of the application rather than over it: a journal that has never
  // been set up has no screen worth showing behind a dialog, and rendering the
  // shell would put navigation within reach of a flow meant to be finished.
  if (!onboarded) {
    return (
      <Suspense fallback={null}>
        <Onboarding />
      </Suspense>
    );
  }

  const hasHeader = navigation !== "bottom";

  return (
    <>
      {/* The header is `fixed`, so the space it no longer takes in the flow is
          given back here. `min-h-svh` is a border-box height, so the padding
          comes out of it and the column is the same size it always was. */}
      <div className={cn("flex min-h-svh flex-col", hasHeader && "pt-14")}>
        {hasHeader ? <TopNav /> : null}
        <Outlet />
      </div>
      <FloatingNav />
      {/* Mounted with the shell rather than per page: it decides for itself
          whether there is anything to return from, so a short screen simply
          never scrolls far enough to summon it. Living here also means it
          survives a route change instead of remounting on every one. */}
      <BackToTop />
      <PageTour />
    </>
  );
};
