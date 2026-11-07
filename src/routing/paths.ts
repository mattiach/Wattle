export const paths = {
  app: {
    getHref: () => "/app",
    path: "/app",
  },
  calendar: {
    getHref: () => "/app/calendar",
    path: "/app/calendar",
  },
  developer: {
    getHref: () => "/components",
    path: "/components",
  },
  entries: {
    detail: {
      getHref: (id: number) => `/app/entries/${id}`,
      path: "/app/entries/:id",
    },
  },
  letters: {
    compose: {
      getHref: () => "/app/letters/new",
      path: "/app/letters/new",
    },
    detail: {
      getHref: (id: number) => `/app/letters/${id}`,
      path: "/app/letters/:id",
    },
    getHref: () => "/app/letters",
    path: "/app/letters",
  },
  settings: {
    getHref: () => "/app/settings",
    path: "/app/settings",
    // Under settings because that is the only thing that points at it, and the
    // way back leads there.
    trash: {
      getHref: () => "/app/settings/trash",
      path: "/app/settings/trash",
    },
  },
  sparks: {
    all: {
      getHref: () => "/app/sparks/all",
      path: "/app/sparks/all",
    },
    detail: {
      // `edit` opens the same page with the field already open, which is what
      // the card's edit control wants - one route, two ways in.
      getHref: (id: number, edit?: boolean) =>
        `/app/sparks/${id}${edit ? "?edit" : ""}`,
      path: "/app/sparks/:id",
    },
    getHref: () => "/app/sparks",
    path: "/app/sparks",
  },
};
