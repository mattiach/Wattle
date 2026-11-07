// @ts-check
/**
 * Turns everything in `themes/` into the palettes the application offers.
 *
 *   pnpm generate:themes
 *
 * Drop a tweakcn-style export into `themes/` and run it. **The file name is the
 * theme**: `themes/sage.css` becomes the palette `sage`, the attribute
 * `data-wattle-palette="sage"` and, until somebody writes it a proper name in
 * the catalogues, the label "Sage". Renaming a theme is renaming its file and
 * running this again.
 *
 * An export is a whole stylesheet: it imports Tailwind, declares `:root` and
 * `.dark`, and repeats the token list under `@theme inline`. Only the two
 * variable blocks are of any use here - everything else already exists in
 * `globals.css`, and importing a second copy of it would be importing a second
 * Tailwind.
 *
 * Three files come out, and none of them is edited by hand:
 *
 *   src/styles/themes/<id>.css      one per export, the two blocks rescoped
 *   src/styles/themes/index.css     the fonts they ask for, then the palettes
 *   src/theme/palettes.generated.ts the list the picker and the type read
 *
 * Which leaves exactly one thing for a person to do, and this prints it: a name
 * per language. Everything else - the imports, the union type, the order in the
 * menu - follows the folder.
 *
 * **It only ever adds.** A palette already generated stays generated, whether
 * or not its export is still in `themes/`: somebody may be reading in it, and
 * generating a new theme is no reason to take theirs away. Removing one is
 * deleting `src/styles/themes/<id>.css` - a thing done deliberately, never a
 * side effect of adding something else.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";

/** Where the exports are dropped, and where their palettes are written. */
const SOURCE_DIR = "themes";
const OUTPUT_DIR = "src/styles/themes";
const LIST_FILE = "src/theme/palettes.generated.ts";
const CATALOGUES = ["src/languages/en/en.json", "src/languages/it/it.json"];

/**
 * The palette that is not a file: Wattle's own paper and ink, written into
 * `globals.css` itself. It leads the menu and it is what an unknown name falls
 * back to, so it is first in the list whatever the folder holds.
 */
const DEFAULT_PALETTE = "wattle";

/**
 * Redefining this rescales every margin, padding and gap in the application at
 * once. An export declares it at Tailwind's own default, so dropping it costs
 * nothing today and stops a future export from quietly resizing the app.
 */
const DROPPED = [/^\s*--spacing:/];

/**
 * The five tokens Wattle has that shadcn does not, expressed in terms of the
 * palette rather than restated by it - so a new theme gets them for free.
 *
 * `--wattle` is the journal's own accent: focus, the active tab, the spark
 * rail, today on the calendar. In an imported theme the brand colour lives in
 * `--primary`, so that is where it comes from.
 *
 * `--assist` is the machine talking, and it must never be mistaken for the
 * journal's accent - see the note in `globals.css`. Rotating the hue of the
 * primary keeps it in the theme's own family while guaranteeing it can never
 * collide with it, whatever palette turns up next. A browser too old for
 * relative colour syntax drops the declaration and inherits the default, which
 * is the right thing to fall back to.
 */
const APP_TOKENS = `
  /* What this application adds on top of shadcn's set, in the palette's own
     terms: a hairline is the faintest border it has, and the surface a memory
     is laid on is its quietest one. */
  --wattle: var(--primary);
  --assist: oklch(from var(--primary) l c calc(h + 150));
  --memory: var(--muted-foreground);
  --hairline: var(--border);
  --memory-surface: var(--muted);`;

/** An id is what goes in the attribute, so it lives under the same rules. */
const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/** A font declaration, and the quotes a family name may be wearing. */
const FONT_DECLARATION = /--(?:font-)?(?:sans|serif|mono):\s*([^;]+);/;
const SURROUNDING_QUOTES = /^["']|["']$/g;
const NON_SLUG = /[^a-z0-9]+/g;

/** Families the browser already has, which no package can add to. */
const GENERIC_FAMILY =
  /^(?:serif|sans-serif|monospace|system-ui|-apple-system|BlinkMacSystemFont|Segoe UI|Roboto|Helvetica Neue|Arial|Noto Sans|Apple Color Emoji|Segoe UI Emoji|Segoe UI Symbol|Noto Color Emoji|Georgia|Cambria|Times New Roman|Times|SFMono-Regular|Menlo|Monaco|Consolas|Liberation Mono|Courier New|Helvetica|Verdana|Tahoma|Courier)$/i;

/**
 * The three families, renamed to what `globals.css` reads.
 *
 * Tailwind's `--font-*` keys are declared `inline` there, which bakes the value
 * into the utility and puts it beyond a palette's reach. The indirection those
 * keys point at is what a theme actually moves.
 *
 * @type {[RegExp, string][]}
 */
const FONT_RENAMES = [
  [/^(\s*)--font-sans:/, "$1--sans:"],
  [/^(\s*)--font-serif:/, "$1--serif:"],
  [/^(\s*)--font-mono:/, "$1--mono:"],
];

/**
 * The declarations inside a rule, found by matching braces rather than by
 * regex: a shadow value spans several lines and holds commas of its own.
 *
 * @param {string} sheet
 * @param {string} selector
 * @returns {string}
 */
const blockOf = (sheet, selector) => {
  const start = sheet.indexOf(`${selector} {`);
  if (start === -1) {
    throw new Error(`no \`${selector}\` block`);
  }
  const open = sheet.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < sheet.length; index += 1) {
    if (sheet[index] === "{") {
      depth += 1;
    } else if (sheet[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return sheet.slice(open + 1, index);
      }
    }
  }
  throw new Error(`unbalanced braces after \`${selector}\``);
};

/**
 * @param {string} line
 * @returns {string}
 */
const rename = (line) => {
  for (const [pattern, replacement] of FONT_RENAMES) {
    if (pattern.test(line)) {
      return line.replace(pattern, replacement);
    }
  }
  return line;
};

/**
 * @param {string} block
 * @returns {string}
 */
const clean = (block) =>
  block
    .split("\n")
    .filter((line) => line.trim() !== "")
    .filter((line) => !DROPPED.some((pattern) => pattern.test(line)))
    .map(rename)
    .join("\n");

/**
 * Every font family a palette asks for that the machine does not already have.
 *
 * @param {string} block
 * @returns {string[]}
 */
const familiesIn = (block) => {
  /** @type {Set<string>} */
  const families = new Set();
  for (const line of block.split("\n")) {
    const match = line.match(FONT_DECLARATION);
    if (!match) {
      continue;
    }
    for (const family of match[1].split(",")) {
      const name = family.trim().replace(SURROUNDING_QUOTES, "");
      if (name && !(name.startsWith("ui-") || GENERIC_FAMILY.test(name))) {
        families.add(name);
      }
    }
  }
  return [...families];
};

/**
 * "IBM Plex Mono" is `@fontsource/ibm-plex-mono`, and so on.
 *
 * @param {string} family
 * @returns {string}
 */
const packageFor = (family) =>
  `@fontsource/${family.toLowerCase().replace(NON_SLUG, "-")}`;

/**
 * One export, rescoped as the palette it becomes.
 *
 * @param {string} id
 * @param {string} source
 * @returns {string}
 */
const palette = (id, source) => {
  const exported = readFileSync(`${SOURCE_DIR}/${source}`, "utf8");
  const light = clean(blockOf(exported, ":root"));
  const dark = clean(blockOf(exported, ".dark"));
  const name = id[0].toUpperCase() + id.slice(1);

  return `/* ${name} - generated from ${source} by scripts/generate-themes.js.
   Regenerate rather than edit: the export is the source.

   Two blocks, both complete. The dark one repeats every token the light one
   declares, and it must: a token it left out would keep the light value.

   Two selectors each, on purpose. The \`:root\` one is what dresses the
   application: it has to outweigh the \`:root\` and \`.dark\` blocks in
   \`globals.css\`, which a bare attribute would only do by coming later in the
   file - and an \`@import\` may only sit at the top of one. The bare one is what
   lets a swatch in Settings carry the attribute and paint itself with this very
   rule instead of with a copy of the colour that can drift from it. */
:root[data-wattle-palette="${id}"],
[data-wattle-palette="${id}"] {
${light}
${APP_TOKENS}
}

:root[data-wattle-palette="${id}"].dark,
.dark [data-wattle-palette="${id}"] {
${dark}
${APP_TOKENS}
}
`;
};

/** @param {string} line */
const say = (line) => process.stdout.write(`${line}\n`);

// ---------------------------------------------------------------- the run

const exports_ = existsSync(SOURCE_DIR)
  ? readdirSync(SOURCE_DIR)
      .filter((entry) => extname(entry) === ".css")
      .sort()
  : [];

if (exports_.length === 0) {
  // Not a reason to stop: the palettes already generated are still palettes,
  // and their index and their list are rebuilt from them either way.
  say(`Nothing new in ${SOURCE_DIR}/.`);
}

/** The palettes this run wrote, and the exports it could not read. */
/** @type {string[]} */
const written = [];
/** @type {string[]} */
const skipped = [];

for (const source of exports_) {
  const id = basename(source, ".css");
  if (!ID_PATTERN.test(id)) {
    skipped.push(
      `${source} - the file name becomes the id: lowercase, no spaces`
    );
    continue;
  }
  try {
    writeFileSync(`${OUTPUT_DIR}/${id}.css`, palette(id, source), "utf8");
    written.push(id);
  } catch (error) {
    skipped.push(
      `${source} - ${error instanceof Error ? error.message : error}`
    );
  }
}

// Every palette there is, not only the ones this run touched.
//
// Nothing is swept up here. An export that is no longer in `themes/` has
// already been turned into a palette, and that palette is a real one: somebody
// may be reading in it. Removing a theme is deleting its file in this folder,
// which is a thing done on purpose rather than a side effect of generating
// something else.
const palettes = readdirSync(OUTPUT_DIR)
  .filter((entry) => extname(entry) === ".css" && entry !== "index.css")
  .map((entry) => basename(entry, ".css"))
  .sort();

// Read back out of the palettes rather than out of the exports, so the families
// of one whose export has gone are imported too.
/** @type {Set<string>} */
const families = new Set();
for (const id of palettes) {
  for (const family of familiesIn(
    readFileSync(`${OUTPUT_DIR}/${id}.css`, "utf8")
  )) {
    families.add(family);
  }
}

const fontPackages = [...families]
  .map(packageFor)
  .filter((name, index, all) => all.indexOf(name) === index)
  .sort();

/**
 * The alphabets the interface can be read in, and nothing else.
 *
 * A Fontsource package ships every script the face covers, one file per subset
 * per weight per style, and its `index.css` imports the lot: for a Korean face
 * that is a hundred and twenty subsets of a font this application will only
 * ever set English, Italian or Polish in. So the subsets are named here, and
 * the ones a package does not have are simply not asked for.
 *
 * Latin and its extension cover thirteen of the sixteen languages the interface
 * speaks. Greek, Russian and Ukrainian are read in Inter and Literata instead,
 * which carry those scripts and are bundled whole: a theme's own face is a
 * flourish, and a flourish is not worth a megabyte and a half of alphabets it
 * cannot letter for the other thirteen. Adding "greek" and "cyrillic" here is
 * all it would take to change that.
 */
const SUBSETS = ["latin", "latin-ext"];

/**
 * The weights the interface can actually set, and no others.
 *
 * Tailwind gives this application four: normal, medium, semibold and bold -
 * `font-medium` on a heading, `font-semibold` on today's date, whatever the
 * editor marks as strong. A family shipping 200 through 800 is shipping four
 * faces per subset that nothing can ask for, and `font-synthesis-weight: none`
 * in `globals.css` means the browser will not invent them either way.
 */
const WEIGHTS = ["400", "500", "600", "700"];

/**
 * Upright at every weight, italic only where the application sets one.
 *
 * A spark is written in italic and so is a quotation, both at the weight the
 * text around them uses; nothing in Wattle asks for italic semibold. The slant
 * matters enough to carry the real letterforms rather than let the browser
 * shear the upright ones, but not at four weights.
 *
 * @param {string} weight
 * @returns {string[]}
 */
const stylesFor = (weight) =>
  weight === "400" || weight === "700" ? ["", "-italic"] : [""];

/**
 * What to import for one family: the subsets it has that the interface speaks.
 *
 * A package with none of them - or one not installed yet, which the build will
 * say plainly - falls back to its own `index.css`, so a font is never silently
 * left out.
 *
 * @param {string} name
 * @returns {string[]}
 */
const subsetImports = (name) => {
  const directory = `node_modules/${name}`;
  if (!existsSync(directory)) {
    return [name];
  }
  const files = readdirSync(directory);
  const wanted = SUBSETS.flatMap((subset) =>
    WEIGHTS.flatMap((weight) =>
      stylesFor(weight).map((style) => `${subset}-${weight}${style}.css`)
    )
  ).filter((file) => files.includes(file));
  return wanted.length > 0 ? wanted.map((file) => `${name}/${file}`) : [name];
};

const fontImports = fontPackages.flatMap(subsetImports);

writeFileSync(
  `${OUTPUT_DIR}/index.css`,
  `/* Generated by scripts/generate-themes.js - do not edit.

   The families the themes ask for, then the themes. Bundled rather than
   fetched: this application works with the network switched off, and a theme
   that quietly fell back to Georgia would be a theme that only works online. A
   \`@font-face\` nothing uses costs nothing to draw - only room on disk.

   Imported by \`globals.css\` as one line, so adding a theme never touches it. */
${fontImports.map((name) => `@import "${name}";`).join("\n")}

${palettes.map((id) => `@import "./${id}.css";`).join("\n")}
`,
  "utf8"
);

writeFileSync(
  LIST_FILE,
  `/**
 * Generated by scripts/generate-themes.js - do not edit.
 *
 * Every palette the stylesheet can draw, in the order the menu offers them.
 * "${DEFAULT_PALETTE}" is not a file: it is the \`:root\` and \`.dark\` blocks of
 * \`globals.css\` itself, which is why it leads and why it is what an unknown
 * name falls back to. The rest are the exports in \`${SOURCE_DIR}/\`, named by
 * their file names.
 */
export const PALETTE_IDS = [
  "${DEFAULT_PALETTE}",
${palettes.map((id) => `  "${id}",`).join("\n")}
] as const;
`,
  "utf8"
);

say(
  `Wrote ${written.length} palette${written.length === 1 ? "" : "s"}: ${written.join(", ")}`
);
const kept = palettes.filter((id) => !written.includes(id));
if (kept.length > 0) {
  say(
    `Left alone (already generated, no export in ${SOURCE_DIR}/): ${kept.join(", ")}`
  );
}
for (const problem of skipped) {
  say(`Skipped ${problem}`);
}

const missingPackages = fontPackages.filter(
  (name) => !existsSync(`node_modules/${name}`)
);
if (missingPackages.length > 0) {
  say(`\nFonts to install:\n  pnpm add ${missingPackages.join(" ")}`);
}

const missingNames = [];
for (const catalogue of CATALOGUES) {
  const strings = JSON.parse(readFileSync(catalogue, "utf8"));
  for (const id of palettes) {
    if (!strings.paletteName?.[id]) {
      missingNames.push(`${basename(catalogue)}  paletteName.${id}`);
    }
  }
}
if (missingNames.length > 0) {
  say(
    `\nNames still to write (the menu shows the id until they are there):\n  ${missingNames.join("\n  ")}`
  );
}
