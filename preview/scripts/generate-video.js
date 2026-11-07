// @ts-check
/**
 * Renders the promotional film in `preview/video/` into `preview/video/wattle.mp4`.
 *
 *   pnpm generate:video
 *
 * The film is its own Remotion project with its own dependencies. They are
 * installed on the first run (when `preview/video/node_modules` is missing),
 * then `pnpm run render` synthesises the audio and renders the MP4.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const VIDEO = resolve("preview", "video");

// `pnpm` is a .cmd shim on Windows, so go through the shell.
const run = (/** @type {string} */ command) =>
  execSync(command, { cwd: VIDEO, stdio: "inherit" });

if (!existsSync(join(VIDEO, "node_modules"))) {
  run("pnpm install");
}
run("pnpm run render");
