import fs from "node:fs";

import { setCargoVersion } from "./cargo-version.js";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
const tauriCfgPath = "src-tauri/tauri.conf.json";
const tauriCfg = JSON.parse(fs.readFileSync(tauriCfgPath, "utf-8"));

tauriCfg.version = pkg.version;

fs.writeFileSync(tauriCfgPath, JSON.stringify(tauriCfg, null, 2));
setCargoVersion(pkg.version);
console.info(`Wattle v.${pkg.version}`);
