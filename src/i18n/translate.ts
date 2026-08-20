import de from "./locales/de";
import en from "./locales/en";
import es from "./locales/es";
import fr from "./locales/fr";
import hi from "./locales/hi";
import it from "./locales/it";
import ja from "./locales/ja";
import ko from "./locales/ko";
import nl from "./locales/nl";
import ptBR from "./locales/pt-BR";
import ru from "./locales/ru";
import zhHans from "./locales/zh-Hans";
import { isTranslationValue, type Locale, type PluralForms, type TranslationPath, type TranslationTree } from "./types";

// Pure translation logic — deliberately has no React or expo-localization dependency, so it can
// be unit-tested directly (and reused outside a component tree if needed later).

// Record<Locale, ...> forces this map to have an entry for every Locale union member — adding a
// locale to types.ts without registering its resource here is a compile-time error, not a silent
// runtime gap (same completeness guarantee as ./localeRegistry.ts's LOCALE_REGISTRY).
const RESOURCES: Record<Locale, TranslationTree> = {
  en,
  es,
  fr,
  "pt-BR": ptBR,
  it,
  de,
  nl,
  ru,
  "zh-Hans": zhHans,
  ja,
  ko,
  hi,
};
const FALLBACK_LOCALE: Locale = "en";

export type TranslationKey = TranslationPath<typeof en>;
export type TranslateParams = Record<string, string | number>;

function lookup(tree: TranslationTree, path: string): string | PluralForms | undefined {
  const segments = path.split(".");
  let node: TranslationTree | string | PluralForms = tree;
  for (const segment of segments) {
    if (typeof node !== "object" || node === null || isTranslationValue(node)) return undefined;
    const next: string | PluralForms | TranslationTree | undefined = (node as TranslationTree)[segment];
    if (next === undefined) return undefined;
    node = next;
  }
  return isTranslationValue(node as TranslationTree) ? (node as string | PluralForms) : undefined;
}

function resolveLeaf(language: Locale, path: string): string | PluralForms | undefined {
  const primary = lookup(RESOURCES[language], path);
  if (primary !== undefined) return primary;
  if (language === FALLBACK_LOCALE) return undefined;
  return lookup(RESOURCES[FALLBACK_LOCALE], path);
}

function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, token) => (token in params ? String(params[token]) : match));
}

/** Missing keys never throw and never render blank — they fall back to the key itself, so a
 * broken translation is visibly wrong rather than silently empty. */
export function translate(language: Locale, key: TranslationKey, params?: TranslateParams): string {
  const leaf = resolveLeaf(language, key);
  if (typeof leaf !== "string") {
    if (typeof __DEV__ !== "undefined" && __DEV__) console.warn(`[i18n] missing or non-string translation for key: ${key}`);
    return key;
  }
  return interpolate(leaf, params);
}

// Full CLDR category, not collapsed to one/other — Intl.PluralRules#select already returns
// exactly the category set src/i18n/types.ts's PluralForms models (zero/one/two/few/many/other).
// English and Spanish only ever populate `one`/`other`, so `select` can currently only ever
// return one of those two for them in practice — this function's job is simply to stop discarding
// whatever a future locale's plural rules (Russian's few/many, Arabic's zero/one/two/few/many)
// actually need.
function selectPluralForm(language: Locale, count: number): keyof PluralForms {
  try {
    return new Intl.PluralRules(language).select(count);
  } catch {
    return count === 1 ? "one" : "other";
  }
}

export function pluralize(language: Locale, key: TranslationKey, count: number, params?: TranslateParams): string {
  const leaf = resolveLeaf(language, key);
  if (typeof leaf !== "object" || leaf === null) {
    if (typeof __DEV__ !== "undefined" && __DEV__) console.warn(`[i18n] missing or non-plural translation for key: ${key}`);
    return key;
  }
  const form = selectPluralForm(language, count);
  // A given key's PluralForms entry may not populate every category a locale's rules can select
  // (e.g. an English/Spanish entry only ever has one/other) — `other` is required on every entry
  // and is always a safe, correct fallback for a category that entry didn't need to distinguish.
  const template = leaf[form] ?? leaf.other;
  return interpolate(template, { count, ...params });
}
