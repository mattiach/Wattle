# Preview

Wattle Preview Images: use this guide to update the preview images whenever there are substantial UI changes to the app.

- `screenshots/` - captures of the app window, *taken by hand*.
- `src/<ratio>/` - HTML templates that place a screenshot beside a heading and a
  short description.
- `renders/<ratio>/` - the PNGs generated from the templates. *Never edited by hand*.
- `video/` - the Remotion project for the promotional film, rendered with
  `pnpm generate:video`. See `video/README.md`.

## Updating Preview Images

1. Take new screenshots of the maximised app window and
   save them over the files in `screenshots/`:

   | File | Screen |
   |------|--------|
   | `1.png` | Home |
   | `2.png` | Editor, with the `/` menu open |
   | `3.png` | A new letter |
   | `4.png` | Settings, with the theme picker open, dark mode |
   | `5.png` | Settings, AI models |

2. From the repository root, run:

   ```sh
   pnpm generate:previews
   ```

3. Check the PNGs in `renders/`. If a screenshot is misaligned, adjust the `.shot img` rule: in the page's own `<style>` for `src/1-1/`, in `shot.css` for `src/16-9/`.
