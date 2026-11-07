import fs from "node:fs";

import { setCargoVersion } from "./cargo-version.js";

const level = process.argv[2] ?? "patch";
const pkgPath = "package.json";
const tauriCfgPath = "src-tauri/tauri.conf.json";

const pkgRaw = fs.readFileSync(pkgPath, "utf-8");
const pkg = JSON.parse(pkgRaw);
const [major, minor, patch] = pkg.version.split(".").map(Number);

const bumped = {
  major: `${major + 1}.0.0`,
  minor: `${major}.${minor + 1}.0`,
  patch: `${major}.${minor}.${patch + 1}`,
}[level];

if (!bumped) {
  throw new Error(
    `Unknown version level "${level}". Use major, minor or patch.`
  );
}

fs.writeFileSync(
  pkgPath,
  pkgRaw.replace(`"version": "${pkg.version}"`, `"version": "${bumped}"`)
);

const tauriCfg = JSON.parse(fs.readFileSync(tauriCfgPath, "utf-8"));
tauriCfg.version = bumped;
fs.writeFileSync(tauriCfgPath, `${JSON.stringify(tauriCfg, null, 2)}\n`);
setCargoVersion(bumped);

console.info(`Wattle v.${pkg.version} -> v.${bumped}`);
