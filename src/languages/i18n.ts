import i18nextInstance from "i18next";
import { initReactI18next } from "react-i18next";

let initialized = false;

/**
 * Every catalogue, keyed by language code, behind the import that fetches it.
 *
 * The keys are the codes `LANGUAGES` in `languages.tsx` offers, not the folder
 * names: four of them differ, because a folder is named after the flag it
 * carries (`cz`, `gr`, `se`, `ua`) while the code is the language (`cs`, `el`,
 * `sv`, `uk`). Getting that pairing wrong is a language that silently falls
 * back to English, so the two lists are worth reading side by side.
 *
 * Shipped rather than fetched, like the fonts: this application works with the
 * network switched off, and a catalogue that arrived over the wire would be a
 * translation that only exists online. `import()` does not change that - every
 * catalogue is built into a file beside the one running, on the same disk. It
 * changes only *when* it is read: one language is in use at a time, and the
 * other fifteen were three quarters of a megabyte the first frame waited on.
 */
const CATALOGUES: Record<string, () => Promise<{ default: object }>> = {
  cs: () => import("./cz/cz.json"),
  de: () => import("./de/de.json"),
  el: () => import("./gr/gr.json"),
  en: () => import("./en/en.json"),
  es: () => import("./es/es.json"),
  fi: () => import("./fi/fi.json"),
  fr: () => import("./fr/fr.json"),
  hu: () => import("./hu/hu.json"),
  it: () => import("./it/it.json"),
  nl: () => import("./nl/nl.json"),
  pl: () => import("./pl/pl.json"),
  pt: () => import("./pt/pt.json"),
  ru: () => import("./ru/ru.json"),
  sv: () => import("./se/se.json"),
  tr: () => import("./tr/tr.json"),
  uk: () => import("./ua/ua.json"),
};

const loaded = new Set<string>();

/**
 * Puts one catalogue within i18next's reach, once.
 *
 * A language with no entry here is not an error: i18next falls back to English
 * for every key it cannot find, which is the same thing that happens when a
 * catalogue is missing a key.
 */
const loadCatalogue = async (lang: string): Promise<void> => {
  const load = CATALOGUES[lang];

  if (loaded.has(lang) || load === undefined) {
    return;
  }

  const { default: translation } = await load();
  i18nextInstance.addResourceBundle(lang, "translation", translation);
  loaded.add(lang);
};

export const initializeI18n = async (lang: string): Promise<void> => {
  if (initialized) {
    return;
  }

  // English too, and always: it is the fallback every other catalogue leans on
  // for a key it has not been given yet, so it has to be there before the first
  // `t()` rather than after the language it is standing in for.
  await i18nextInstance.use(initReactI18next).init({
    fallbackLng: "en",
    interpolation: {
      escapeValue: false,
    },
    lng: lang,
    resources: {},
  });

  await Promise.all([loadCatalogue("en"), loadCatalogue(lang)]);

  initialized = true;
};

/**
 * Switches language, with its words already in hand.
 *
 * The catalogue is fetched before `changeLanguage`, not alongside it: the other
 * order re-renders the interface against a language i18next knows the name of
 * and none of the words for, and English shows through for a frame.
 */
export const changeAppLanguage = async (lang: string): Promise<void> => {
  await loadCatalogue(lang);
  await i18nextInstance.changeLanguage(lang);
};

export { default } from "i18next";
