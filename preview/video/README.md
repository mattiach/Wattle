# Wattle promotional video

A ~49 second, 1920×1080, 30 fps film made with [Remotion](https://remotion.dev).
The output is `wattle.mp4` in this folder, plus `poster.png`, the frame the
root README links to the film with.

From the repository root, one command installs this project's dependencies (on
the first run only) and renders:

```sh
pnpm generate:video
```

Working on the film itself, from this folder:

```sh
pnpm install
pnpm dev         # Remotion Studio: preview and scrub
pnpm render      # writes wattle.mp4 and poster.png
```

This folder is its own pnpm root (`pnpm-workspace.yaml`, `pnpm-lock.yaml`),
separate from the app's dependencies. `dev` and `render` first run `scripts/generate-audio.mjs`, which synthesises the
soundtrack (an ambient pad, a chime, a whoosh, a tick) into `public/audio/`.
The audio is generated from code rather than sampled, so it carries no licence
of its own. It is not committed.

## Where to change things

| What | Where |
|---|---|
| Every line of on-screen text | `src/copy.ts` |
| Scene lengths, transition length | `src/timeline.ts` |
| Colours, fonts, easing | `src/theme.ts` (the app's own tokens) |
| One scene | `src/scenes/<scene>.tsx`, also registered alone under *Scenes* in Studio |
| Camera on a screenshot | the `zoom` and `focus` props of `<AppWindow>` in that scene |

## Scenes

1. **Opening**: "Your life is made of moments. Don't let them disappear."
2. **Logo**: the wordmark is written on, then the wattle dot lands.
3. **Pages**: screenshots `1.png` → `2.png`.
4. **Sparks**: type only.
5. **Letters**: screenshot `3.png`.
6. **Remember**: On This Day, Echo, Calendar, in type only.
7. **Privacy**: night palette over a blurred `4.png`.
8. **Local AI**: screenshot `5.png`.
9. **Closing**: logo and "Your life. Your words. Your computer."

Screenshots are copies of `../screenshots/` in `public/screenshots/`. Sparks,
On This Day, Echo and Calendar have no capture yet, so their scenes draw no app
UI. When captures exist, drop them into `public/screenshots/` and give those
scenes an `<AppWindow>` the way `letters.tsx` does.

`public/logo.svg` is `src/assets/logo/logo.svg` with its light tone changed to
the video's paper colour, so the letter counters don't show as grey.

## Licensing

This folder's own code is MIT-licensed, like the rest of Wattle. Its fonts are
under the SIL Open Font License 1.1 (`public/fonts/*-OFL.txt`).

Remotion is not covered by that licence and is not open source. It is
distributed under the [Remotion License](https://www.remotion.dev/license),
which lets individuals, small companies and non-profits use it for free and
requires a company licence for larger for-profit organisations. Before
rendering this video, and especially before using it commercially, check
whether you are eligible for the free licence or obtain the licence that
applies to you.
