import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LANGUAGES_DIR = path.resolve(__dirname, "../src/languages");
const DEFAULT_LANGUAGE = "en";

/**
 * Folder name to language code, for the four that differ.
 *
 * A folder is named after the flag it carries (`cz`, `gr`, `se`, `ua`) while
 * the code is the language (`cs`, `el`, `sv`, `uk`). `languages.tsx` pairs the
 * same two lists for the picker; the plural rules below need the code, not the
 * folder, or they fall back to English rules and wave the Slavic files through.
 */
const LANGUAGE_CODES = {
  cz: "cs",
  gr: "el",
  se: "sv",
  ua: "uk",
};

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/**
 * The plural categories a language actually uses for whole numbers.
 *
 * A plural key is not one key to match against English: it is one key per
 * category the language needs - two in English, four in Czech, Polish, Russian
 * and Ukrainian. i18next resolves `{ count: 3 }` to `key_few` in those and does
 * **not** fall back to `key_other`, so a catalogue missing that form renders
 * the raw key on screen. Comparing key names alone both misses that and reports
 * the forms it does have as strays.
 */
function pluralCategories(code) {
  const rules = new Intl.PluralRules(code);
  const categories = new Set();

  for (let n = 0; n <= 200; n += 1) {
    categories.add(rules.select(n));
  }

  return categories;
}

function flattenKeys(obj, prefix = "") {
  const keys = {};

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(keys, flattenKeys(value, fullKey));
    } else {
      keys[fullKey] = value;
    }
  }

  return keys;
}

function findKeyLine(filePath, key) {
  const content = fs.readFileSync(filePath, "utf8");
  const parts = key.split(".");

  const search = parts.at(-1);

  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const match = line.match(new RegExp(`"${search}"\\s*:`));

    if (match) {
      return i + 1;
    }
  }

  return null;
}

function loadLanguageFiles() {
  return fs
    .readdirSync(LANGUAGES_DIR)
    .filter((entry) => {
      const fullPath = path.join(LANGUAGES_DIR, entry);
      return fs.statSync(fullPath).isDirectory();
    })
    .map((lang) => {
      const filePath = path.join(LANGUAGES_DIR, lang, `${lang}.json`);

      if (!fs.existsSync(filePath)) {
        throw new Error(`Missing translation file: ${filePath}`);
      }

      const content = JSON.parse(fs.readFileSync(filePath, "utf8"));

      return {
        filePath,
        keys: flattenKeys(content),
        lang,
      };
    });
}

function compareKeys(baseKeys, languageKeys, code) {
  const missing = [];
  const extra = [];

  const pluralBases = new Set();
  const plainKeys = new Set();

  for (const key of Object.keys(baseKeys)) {
    if (PLURAL_SUFFIX.test(key)) {
      pluralBases.add(key.replace(PLURAL_SUFFIX, ""));
    } else {
      plainKeys.add(key);
    }
  }

  for (const key of plainKeys) {
    if (!(key in languageKeys)) {
      missing.push(key);
    }
  }

  for (const base of pluralBases) {
    for (const category of pluralCategories(code)) {
      const key = `${base}_${category}`;

      if (!(key in languageKeys)) {
        missing.push(key);
      }
    }
  }

  for (const key of Object.keys(languageKeys)) {
    const base = key.replace(PLURAL_SUFFIX, "");

    if (!(plainKeys.has(base) || pluralBases.has(base))) {
      extra.push(key);
    }
  }

  return {
    extra,
    missing,
  };
}

function printList(title, items, filePath) {
  if (!items.length) {
    return;
  }

  console.log(`\n${title} (${items.length}):`);

  for (const item of items) {
    const line = findKeyLine(filePath, item);

    if (line) {
      console.log(`  - ${item} (line ${line})`);
    } else {
      console.log(`  - ${item}`);
    }
  }
}

const AI_COMMANDS = path.resolve(__dirname, "../src-tauri/src/commands/ai.rs");

const RUST_LANGUAGES_TABLE = /const LANGUAGES:[^=]*=\s*\[([\s\S]*?)\];/;
const RUST_LANGUAGE_CODE = /\("(\w+)",/g;

/**
 * The language codes the Rust side can name to a model.
 *
 * A catalogue is only half of a translation. Prompts are built in Rust, which
 * tells the model what to answer in by *English name* - and a code missing from
 * that table does not fail anywhere, it silently falls back to English. That is
 * how a fully translated Greek interface handed back English suggestions on the
 * home screen and in the editor.
 */
function rustLanguageCodes() {
  const source = fs.readFileSync(AI_COMMANDS, "utf8");
  const table = source.match(RUST_LANGUAGES_TABLE);

  if (!table) {
    throw new Error(`Could not find the LANGUAGES table in ${AI_COMMANDS}`);
  }

  return new Set(
    [...table[1].matchAll(RUST_LANGUAGE_CODE)].map((match) => match[1])
  );
}

function main() {
  const languages = loadLanguageFiles();

  const baseLanguage = languages.find((lang) => lang.lang === DEFAULT_LANGUAGE);

  if (!baseLanguage) {
    throw new Error(`Base language "${DEFAULT_LANGUAGE}" not found`);
  }

  let hasErrors = false;

  const checkedLanguages = languages.filter(
    (language) => language.lang !== DEFAULT_LANGUAGE
  );

  console.log(
    `Checking ${checkedLanguages.length} languages with "${DEFAULT_LANGUAGE}" as the reference...\n`
  );

  for (const language of languages) {
    if (language.lang === DEFAULT_LANGUAGE) {
      continue;
    }

    const code = LANGUAGE_CODES[language.lang] ?? language.lang;

    const result = compareKeys(baseLanguage.keys, language.keys, code);

    if (result.missing.length || result.extra.length) {
      hasErrors = true;

      console.log(`\n❌ ${language.lang}.json`);

      printList("Missing keys", result.missing, baseLanguage.filePath);
      printList("Extra keys", result.extra, language.filePath);
    } else {
      console.error(`✅ ${language.lang}.json`);
    }
  }

  const known = rustLanguageCodes();
  const unnamed = languages
    .map((language) => LANGUAGE_CODES[language.lang] ?? language.lang)
    .filter((code) => !known.has(code));

  if (unnamed.length) {
    hasErrors = true;
    console.error(
      `\n❌ commands/ai.rs does not name: ${unnamed.join(", ")}`,
      "\n   Prompts for these fall back to English."
    );
  }

  if (hasErrors) {
    console.error("Translation files are not synchronized.");
    process.exit(1);
  }

  console.log("All translation files contain the same keys. ✅");
  console.log("Every language is named for the model in commands/ai.rs. ✅");
}

main();
