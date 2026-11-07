import { readFileSync } from "node:fs";

import type { Plugin } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;
const isWindows = process.platform === "win32";

/**
 * A variable read straight out of `.env`.
 *
 * Vite's own env loading cannot answer for `NODE_ENV`: it sets that from the
 * build mode before the config runs and `loadEnv` merges `process.env` over
 * the file, so `.env` is always shadowed and every build reads "production".
 * `import.meta.env.NODE_ENV` is overwritten for the same reason. Reading the
 * file is the only way the value it actually holds survives.
 */
const ENV_LINE_BREAK = /\r?\n/;

const readEnvFile = (name: string): string => {
  try {
    const line = readFileSync(".env", "utf8")
      .split(ENV_LINE_BREAK)
      .find((entry) => entry.trimStart().startsWith(`${name}=`));
    return line === undefined ? "" : line.slice(line.indexOf("=") + 1).trim();
  } catch {
    return "";
  }
};

/**
 * Fontsource offers every face twice: WOFF2, and WOFF for a browser that cannot
 * read it. This one can - Tauri draws in WebView2 on Windows and WebKit
 * elsewhere, and the build already targets Chrome 120 - so the second copy is a
 * megabyte and a half of files nothing will ever open.
 *
 * Dropped from the stylesheet rather than from the folder: Vite emits an asset
 * because a rule points at it, so the way to not ship one is to stop pointing.
 */
const WOFF_FALLBACK = /,\s*url\([^)]+\.woff\)\s*format\(['"]woff['"]\)/g;

const woff2Only = (): Plugin => ({
  // At the end, not during the transform: an `@import`ed stylesheet is inlined
  // by Vite's own CSS pipeline before any plugin sees it, and by then the files
  // it points at have already been claimed. So the rules are rewritten in the
  // finished sheet and the assets nothing points at any more are dropped with
  // them.
  generateBundle(_options, bundle) {
    for (const [name, output] of Object.entries(bundle)) {
      if (output.type === "asset" && name.endsWith(".css")) {
        output.source = String(output.source).replace(WOFF_FALLBACK, "");
      }
      if (output.type === "asset" && name.endsWith(".woff")) {
        delete bundle[name];
      }
    }
  },
  name: "wattle:woff2-only",
});

// https://vite.dev/config/
export default defineConfig(() => {
  return {
    build: {
      chunkSizeWarningLimit: 1000,
      minify: process.env.TAURI_ENV_DEBUG ? false : ("esbuild" as const),
      sourcemap: !!process.env.TAURI_ENV_DEBUG,
      target: ["chrome120", "safari17"],
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    // 1. prevent Vite from obscuring rust errors
    clearScreen: false,
    // The one switch for the developer tooling: the components preview route
    // and its navigation entry both read this, so neither can outlive the
    // other, and a production `.env` leaves the whole thing out of the build.
    define: {
      __DEV_TOOLS__: JSON.stringify(readEnvFile("NODE_ENV") === "development"),
    },
    envPrefix: ["VITE_", "TAURI_ENV_*"],
    plugins: [woff2Only(), react(), tailwindcss()],
    resolve: {
      tsconfigPaths: true,
    },
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      // Use 127.0.0.1 on desktop so WebView2 and the HMR WebSocket share the same loopback stack.
      host: host || (isWindows ? "127.0.0.1" : false),
      port: 3000,
      strictPort: true,
      watch: {
        // 3. tell Vite to ignore watching `src-tauri`
        ignored: ["**/src-tauri/**"],
        // Windows + synced folders (e.g. OneDrive Desktop) often miss native FS events.
        usePolling: isWindows,
      },
      ws: host
        ? {
            host,
            port: 1421,
            protocol: "ws",
          }
        : {
            clientPort: 3000,
            host: "127.0.0.1",
            protocol: "ws",
          },
    },
  };
});
