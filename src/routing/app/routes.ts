import { redirect } from "react-router";

import { paths } from "../paths";
import { AppLayout } from "./app-layout";
import { HomePage } from "@/pages/home.page";

/**
 * A screen, fetched the first time it is opened.
 *
 * Everything but the home screen is loaded this way. The application opens on
 * `/app` and nothing else is on the way there, yet a single bundle made the
 * first paint wait for the editor - TipTap, ProseMirror and thirteen syntax
 * grammars - along with the letter composer and the model catalogue. None of
 * that is reachable without a click, and a click is long enough to fetch a file
 * that is already on the disk beside the one running.
 *
 * `lazy` rather than `React.lazy`: the router resolves it before it renders, so
 * there is no fallback to design and no Suspense boundary to place. The dev-only
 * components page has been loaded this way from the start; this is the same
 * thing said about the other eleven.
 *
 * @param load the import, kept as a function so the bundler can split on it
 * @param name the export inside that module
 */
const screen = (
  load: () => Promise<Record<string, unknown>>,
  name: string
) => ({
  lazy: async () => ({
    Component: (await load())[name] as React.ComponentType,
  }),
});

export const app = [
  {
    Component: AppLayout,
    children: [
      {
        // Eager, and the only one: this is where the application opens, and a
        // screen fetched on the way to itself is a screen that flickers.
        Component: HomePage,
        path: paths.app.path,
      },
      {
        ...screen(() => import("@/pages/calendar.page"), "CalendarPage"),
        path: paths.calendar.path,
      },
      {
        ...screen(() => import("@/pages/sparks.page"), "SparksPage"),
        path: paths.sparks.path,
      },
      // The static archive path is declared before the dynamic one so
      // `/app/sparks/all` can never be read as a spark called "all".
      {
        ...screen(() => import("@/pages/sparks-all.page"), "SparksAllPage"),
        path: paths.sparks.all.path,
      },
      {
        ...screen(() => import("@/pages/spark.page"), "SparkPage"),
        path: paths.sparks.detail.path,
      },
      {
        ...screen(() => import("@/pages/letters.page"), "LettersPage"),
        path: paths.letters.path,
      },
      // The composer is declared before the dynamic route so `/app/letters/new`
      // can never be read as a letter called "new" - the same reason
      // `/app/sparks/all` is declared where it is.
      {
        ...screen(
          () => import("@/pages/letter-compose.page"),
          "LetterComposePage"
        ),
        path: paths.letters.compose.path,
      },
      {
        ...screen(() => import("@/pages/letter.page"), "LetterPage"),
        path: paths.letters.detail.path,
      },
      {
        ...screen(() => import("@/pages/settings.page"), "SettingsPage"),
        path: paths.settings.path,
      },
      {
        ...screen(() => import("@/pages/trash.page"), "TrashPage"),
        path: paths.settings.trash.path,
      },
      {
        ...screen(() => import("@/pages/entry.page"), "EntryPage"),
        path: paths.entries.detail.path,
      },
      // Inside the layout so the components preview gets the same navigation
      // as every other page. Gated by the same value as the route itself, so a
      // production `.env` leaves the page out of the build entirely rather
      // than shipping a chunk nothing can reach.
      ...(__DEV_TOOLS__
        ? [
            {
              ...screen(
                () => import("@/pages/components.page"),
                "ComponentsPage"
              ),
              path: paths.developer.path,
            },
          ]
        : []),
    ],
  },
  {
    loader: () => redirect(paths.app.path),
    path: "/",
  },
];
