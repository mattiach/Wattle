import czFlag from "@/assets/cz.svg";
import deFlag from "@/assets/de.svg";
import enFlag from "@/assets/en.svg";
import esFlag from "@/assets/es.svg";
import fiFlag from "@/assets/fi.svg";
import frFlag from "@/assets/fr.svg";
import grFlag from "@/assets/gr.svg";
import huFlag from "@/assets/hu.svg";
import itFlag from "@/assets/it.svg";
import nlFlag from "@/assets/nl.svg";
import plFlag from "@/assets/pl.svg";
import ptFlag from "@/assets/pt.svg";
import ruFlag from "@/assets/ru.svg";
import seFlag from "@/assets/se.svg";
import trFlag from "@/assets/tr.svg";
import uaFlag from "@/assets/ua.svg";

/**
 * The languages Wattle offers, each with the flag it is picked by.
 *
 * One table, in one place: every picker reads its options, its labels and its
 * flags from here, so adding a language is an entry here plus its catalogue
 * file in `i18n.ts` - and never a second list to keep in step.
 *
 * Keyed by language code, not by country: the flag file happens to be named
 * after a country (`cz`, `gr`, `se`, `ua`) while the code is the language
 * (`cs`, `el`, `sv`, `uk`). Mapping the two here is the whole reason this table
 * exists.
 *
 * A language with no catalogue yet is still offered: i18next falls back to
 * English for every key it cannot find, so the interface stays readable while
 * the translation is being written.
 *
 * Labels are never translated - a reader looking for their language reads it
 * the way they write it, not the way the current interface would render it.
 */
export const LANGUAGES = {
  cs: { flag: czFlag, label: "Čeština" },
  de: { flag: deFlag, label: "Deutsch" },
  el: { flag: grFlag, label: "Ελληνικά" },
  en: { flag: enFlag, label: "English" },
  es: { flag: esFlag, label: "Español" },
  fi: { flag: fiFlag, label: "Suomi" },
  fr: { flag: frFlag, label: "Français" },
  hu: { flag: huFlag, label: "Magyar" },
  it: { flag: itFlag, label: "Italiano" },
  nl: { flag: nlFlag, label: "Nederlands" },
  pl: { flag: plFlag, label: "Polski" },
  pt: { flag: ptFlag, label: "Português" },
  ru: { flag: ruFlag, label: "Русский" },
  sv: { flag: seFlag, label: "Svenska" },
  tr: { flag: trFlag, label: "Türkçe" },
  uk: { flag: uaFlag, label: "Українська" },
} as const;

export type LanguageCode = keyof typeof LANGUAGES;

export const LANGUAGE_CODES = Object.keys(LANGUAGES) as LanguageCode[];

/**
 * Code to label, which is the shape Base UI's `Select` wants for `items` - it
 * renders the current value from this, not from the item that is open.
 */
export const LANGUAGE_LABELS = Object.fromEntries(
  LANGUAGE_CODES.map((code) => [code, LANGUAGES[code].label])
) as Record<LanguageCode, string>;

/**
 * A flag beside a language name.
 *
 * Decorative on purpose: the name it sits next to already says which language
 * this is, and a flag read aloud would only repeat it - badly, since a flag is
 * a country and a language is not.
 */
export const LanguageFlag = ({ code }: { code: LanguageCode }) => (
  <img
    alt=""
    aria-hidden="true"
    className="h-3.5 w-5 shrink-0 rounded-[2px] object-cover ring-1 ring-foreground/10"
    height={14}
    src={LANGUAGES[code].flag}
    width={20}
  />
);
