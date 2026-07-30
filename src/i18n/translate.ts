import en from "./locales/en";
import es from "./locales/es";
import { isTranslationValue, type Locale, type PluralForms, type TranslationPath, type TranslationTree } from "./types";

// Pure translation logic — deliberately has no React or expo-localization dependency, so it can
// be unit-tested directly (and reused outside a component tree if needed later).

const RESOURCES: Record<Locale, TranslationTree> = { en, es };
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

function selectPluralForm(language: Locale, count: number): keyof PluralForms {
  try {
    const form = new Intl.PluralRules(language).select(count);
    return form === "one" ? "one" : "other";
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
  const template = leaf[form] ?? leaf.other;
  return interpolate(template, { count, ...params });
}
