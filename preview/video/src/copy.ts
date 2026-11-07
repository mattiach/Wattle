// Every line of on-screen text lives here. Edit freely; layout adapts.
// Feature descriptions follow the README so the video promises nothing the app
// does not do.

export const copy = {
  ai: {
    eyebrow: "Optional local AI",
    points: [
      "Off by default.",
      "Runs through Ollama, on your own machine.",
      "Never edits your writing on its own.",
    ],
    title: "It runs on your computer.",
  },
  closing: {
    phrases: ["Your life.", "Your words.", "Your computer."],
  },
  intro: {
    tagline: "A private journal that lives entirely on your computer.",
  },
  letters: {
    body: "Write something now and seal it until a date you choose.",
    eyebrow: "Write",
    title: "Letters",
  },
  opening: {
    first: "Your life is made of moments.",
    second: "Don't let them",
    vanishing: "disappear.",
  },
  pages: {
    body: "Dated entries in a rich editor: headings, lists, quotes and checklists from a / menu.",
    eyebrow: "Write",
    title: "Pages",
  },
  privacy: {
    footnote: "Your journal never leaves your device.",
    lines: ["No account.", "No cloud.", "No telemetry."],
  },
  remember: {
    eyebrow: "Remember",
    headline: "Read your days back, over time.",
    items: [
      {
        body: "What you wrote on this date in earlier years.",
        title: "On This Day",
      },
      { body: "An older spark returns each day.", title: "Echo" },
      {
        body: "Month and year views. A fuller day is a day you wrote more.",
        title: "Calendar",
      },
    ],
  },
  sparks: {
    body: "One plain line for a passing thought, written in seconds.",
    example: "The light through the kitchen window this morning.",
    eyebrow: "Write",
    title: "Sparks",
  },
} as const;
