// @ts-check
/**
 * Renders the preview pages in `preview/src/` into PNGs, with headless Edge.
 *
 *   pnpm generate:previews
 *
 *   preview/src/16-9/*.html  -> preview/renders/16-9/*.png  1920x1080
 *   preview/src/1-1/*.html   -> preview/renders/1-1/*.png   1200x1200
 *
 * The pages read `preview/screenshots/` and the fonts in `node_modules`, so
 * replace a screenshot and run this again. Set `EDGE_PATH` if Edge is
 * installed somewhere else.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const EDGE =
  process.env.EDGE_PATH ??
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

const PREVIEW = resolve("preview");

const SIZES = { "1-1": "1200,1200", "16-9": "1920,1080" };

for (const [ratio, size] of Object.entries(SIZES)) {
  const from = join(PREVIEW, "src", ratio);
  const to = join(PREVIEW, "renders", ratio);
  mkdirSync(to, { recursive: true });
  const pages = readdirSync(from).filter((file) => file.endsWith(".html"));
  for (const page of pages) {
    const out = join(to, page.replace(".html", ".png"));
    execFileSync(EDGE, [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--allow-file-access-from-files",
      "--virtual-time-budget=3000",
      `--window-size=${size}`,
      `--screenshot=${out}`,
      pathToFileURL(join(from, page)).href,
    ]);
  }
}
