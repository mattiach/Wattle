import { loadFont } from "@remotion/fonts";
import { Easing, staticFile } from "remotion";

// Wattle's own tokens, from src/styles/globals.css (the default "Wattle" theme).
export const colors = {
  assist: "oklch(0.52 0.06 250)",
  ink: "oklch(0.235 0.008 65)",
  line: "oklch(0.235 0.008 65 / 12%)",
  muted: "oklch(0.522 0.012 68)",
  night: "oklch(0.185 0.005 70)",
  nightInk: "oklch(0.925 0.006 85)",
  nightMuted: "oklch(0.68 0.008 78)",
  nightWattle: "oklch(0.78 0.13 84)",
  paper: "oklch(0.967 0.005 85)",
  wattle: "oklch(0.68 0.13 82)",
  wattleInk: "oklch(0.5 0.13 82)",
} as const;

// Serif is what *you* wrote; sans is the app talking. Same rule as the app.
export const fonts = {
  sans: "Inter, system-ui, sans-serif",
  serif: "Literata, Georgia, serif",
} as const;

loadFont({
  family: "Literata",
  url: staticFile("fonts/literata-latin-wght-normal.woff2"),
  weight: "200 900",
});
loadFont({
  family: "Literata",
  style: "italic",
  url: staticFile("fonts/literata-latin-wght-italic.woff2"),
  weight: "200 900",
});
loadFont({
  family: "Inter",
  url: staticFile("fonts/inter-latin-wght-normal.woff2"),
  weight: "100 900",
});

// One curve for every arrival: fast out, long settle. No overshoot.
export const ease = Easing.bezier(0.16, 1, 0.3, 1);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);

export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;
