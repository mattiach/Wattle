import bgFlag from "@/assets/bg.svg";
import cnFlag from "@/assets/cn.svg";
import czFlag from "@/assets/cz.svg";
import deFlag from "@/assets/de.svg";
import dkFlag from "@/assets/dk.svg";
import eeFlag from "@/assets/ee.svg";
import enFlag from "@/assets/en.svg";
import esFlag from "@/assets/es.svg";
import fiFlag from "@/assets/fi.svg";
import frFlag from "@/assets/fr.svg";
import grFlag from "@/assets/gr.svg";
import hrFlag from "@/assets/hr.svg";
import huFlag from "@/assets/hu.svg";
import itFlag from "@/assets/it.svg";
import jpFlag from "@/assets/jp.svg";
import krFlag from "@/assets/kr.svg";
import ltFlag from "@/assets/lt.svg";
import lvFlag from "@/assets/lv.svg";
import nlFlag from "@/assets/nl.svg";
import noFlag from "@/assets/no.svg";
import plFlag from "@/assets/pl.svg";
import ptFlag from "@/assets/pt.svg";
import roFlag from "@/assets/ro.svg";
import rsFlag from "@/assets/rs.svg";
import ruFlag from "@/assets/ru.svg";
import seFlag from "@/assets/se.svg";
import siFlag from "@/assets/si.svg";
import skFlag from "@/assets/sk.svg";
import thFlag from "@/assets/th.svg";
import trFlag from "@/assets/tr.svg";
import twFlag from "@/assets/tw.svg";
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
  bg: { flag: bgFlag, label: "Български" },
  cs: { flag: czFlag, label: "Čeština" },
  da: { flag: dkFlag, label: "Dansk" },
  de: { flag: deFlag, label: "Deutsch" },
  el: { flag: grFlag, label: "Ελληνικά" },
  en: { flag: enFlag, label: "English" },
  es: { flag: esFlag, label: "Español" },
  et: { flag: eeFlag, label: "Eesti" },
  fi: { flag: fiFlag, label: "Suomi" },
  fr: { flag: frFlag, label: "Français" },
  hr: { flag: hrFlag, label: "Hrvatski" },
  hu: { flag: huFlag, label: "Magyar" },
  it: { flag: itFlag, label: "Italiano" },
  ja: { flag: jpFlag, label: "日本語" },
  ko: { flag: krFlag, label: "한국어" },
  lt: { flag: ltFlag, label: "Lietuvių" },
  lv: { flag: lvFlag, label: "Latviešu" },
  nl: { flag: nlFlag, label: "Nederlands" },
  no: { flag: noFlag, label: "Norsk" },
  pl: { flag: plFlag, label: "Polski" },
  pt: { flag: ptFlag, label: "Português" },
  ro: { flag: roFlag, label: "Română" },
  ru: { flag: ruFlag, label: "Русский" },
  sk: { flag: skFlag, label: "Slovenčina" },
  sl: { flag: siFlag, label: "Slovenščina" },
  sr: { flag: rsFlag, label: "Srpski" },
  sv: { flag: seFlag, label: "Svenska" },
  th: { flag: thFlag, label: "ไทย" },
  tr: { flag: trFlag, label: "Türkçe" },
  uk: { flag: uaFlag, label: "Українська" },
  "zh-CN": { flag: cnFlag, label: "简体中文" },
  "zh-TW": { flag: twFlag, label: "繁體中文" },
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
