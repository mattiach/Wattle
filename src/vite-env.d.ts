/// <reference types="vite/client" />

/**
 * Whether `.env` says `NODE_ENV=development`.
 *
 * Baked in by `define` in `vite.config.ts`. It is deliberately not
 * `import.meta.env.NODE_ENV`, which Vite overwrites with the build mode, nor
 * `import.meta.env.DEV`, which only says whether a dev server is running.
 */
declare const __DEV_TOOLS__: boolean;
