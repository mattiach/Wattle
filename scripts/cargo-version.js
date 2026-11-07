import { execFileSync } from "node:child_process";
import fs from "node:fs";

const CARGO_DIR = "src-tauri";
const CARGO_TOML = `${CARGO_DIR}/Cargo.toml`;
const CARGO_LOCK = `${CARGO_DIR}/Cargo.lock`;
const PACKAGE_VERSION =
  /^(\[package\](?:(?!^\[)[\s\S])*?^version\s*=\s*")([^"]+)(")/m;
const LOCKED_VERSION =
  /^\[\[package\]\]\r?\nname = "wattle"\r?\nversion = "([^"]+)"/m;

export const cargoTomlVersion = () =>
  fs.readFileSync(CARGO_TOML, "utf-8").match(PACKAGE_VERSION)?.[2];

export const cargoLockVersion = () =>
  fs.readFileSync(CARGO_LOCK, "utf-8").match(LOCKED_VERSION)?.[1];

/**
 * Writes the version into `Cargo.toml` and lets Cargo carry it into
 * `Cargo.lock`. `cargo update --workspace` refreshes only the workspace's own
 * entry, so no dependency moves.
 */
export const setCargoVersion = (version) => {
  const manifest = fs.readFileSync(CARGO_TOML, "utf-8");
  if (!PACKAGE_VERSION.test(manifest)) {
    throw new Error(`No [package] version found in ${CARGO_TOML}.`);
  }
  if (cargoTomlVersion() !== version) {
    fs.writeFileSync(
      CARGO_TOML,
      manifest.replace(PACKAGE_VERSION, `$1${version}$3`)
    );
  }
  if (cargoLockVersion() !== version) {
    execFileSync("cargo", ["update", "--workspace", "--offline"], {
      cwd: CARGO_DIR,
      stdio: "inherit",
    });
  }
};
