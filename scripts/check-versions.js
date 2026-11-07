import fs from "node:fs";

import { cargoLockVersion, cargoTomlVersion } from "./cargo-version.js";

const versions = {
  "package.json": JSON.parse(fs.readFileSync("package.json", "utf-8")).version,
  "src-tauri/Cargo.lock": cargoLockVersion(),
  "src-tauri/Cargo.toml": cargoTomlVersion(),
  "src-tauri/tauri.conf.json": JSON.parse(
    fs.readFileSync("src-tauri/tauri.conf.json", "utf-8")
  ).version,
};

const expected = versions["package.json"];
const mismatched = Object.entries(versions).filter(
  ([, version]) => version !== expected
);

if (mismatched.length > 0) {
  console.error(`The app version is ${expected} in package.json, but:`);
  for (const [file, version] of mismatched) {
    console.error(`  - ${file} says ${version ?? "nothing"}`);
  }
  console.error("Run `pnpm update:tauri-version` to bring them back in step.");
  process.exit(1);
}

console.info(`Every manifest carries Wattle v.${expected}. ✅`);
