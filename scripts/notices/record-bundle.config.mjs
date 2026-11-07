import { writeFileSync } from "node:fs";

import projectConfig from "../../vite.config.ts";

const ASSET_MODULE = /\.(css|woff2?|svg|png)(\?|$)/;

const base = projectConfig({ command: "build", mode: "production" });
const recorded = new Set();

const recordBundledModules = {
  closeBundle() {
    const modules = [...recorded].toSorted();
    writeFileSync(process.env.NOTICES_MODULES_FILE, JSON.stringify(modules));
  },
  generateBundle(_options, bundle) {
    for (const output of Object.values(bundle)) {
      if (output.type === "chunk") {
        for (const [id, module] of Object.entries(output.modules)) {
          if (module.renderedLength > 0) {
            recorded.add(id);
          }
        }
      }
      if (output.type === "asset") {
        for (const name of output.originalFileNames ?? []) {
          recorded.add(name);
        }
      }
    }
    for (const id of this.getModuleIds()) {
      if (ASSET_MODULE.test(id)) {
        recorded.add(id);
      }
    }
  },
  name: "notices:record-bundled-modules",
};

export default {
  ...base,
  build: {
    ...base.build,
    emptyOutDir: true,
    outDir: process.env.NOTICES_OUT_DIR,
  },
  plugins: [...base.plugins, recordBundledModules],
};
