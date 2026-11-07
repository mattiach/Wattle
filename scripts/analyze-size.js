import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}·GB`;
}

function getFolderSize(dirPath) {
  let total = 0;

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      try {
        if (entry.isDirectory()) {
          walk(fullPath);
        } else {
          const stat = fs.statSync(fullPath);
          total += stat.size;
        }
      } catch (error) {
        console.error(error);
      }
    }
  }

  walk(dirPath);
  return total;
}

const rootSize = getFolderSize(ROOT);

const nodeModulesPath = path.join(ROOT, "node_modules");
const nodeModulesSize = fs.existsSync(nodeModulesPath)
  ? getFolderSize(nodeModulesPath)
  : 0;

// optional: git
const gitPath = path.join(ROOT, ".git");
const gitSize = fs.existsSync(gitPath) ? getFolderSize(gitPath) : 0;

console.log(`Root total:      ${formatBytes(rootSize)}`);
console.log(`node_modules:    ${formatBytes(nodeModulesSize)}`);
console.log(`.git:            ${formatBytes(gitSize)}`);
