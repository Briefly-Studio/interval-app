// "en" and "es" have real resources. Adding a language later means adding both a Locale entry
// and a locales/<code>.ts file.
export type Locale = "en" | "es";

export const SUPPORTED_LOCALES: readonly Locale[] = ["en", "es"];

export function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

// "system" defers to device-locale detection (falling back to English for anything
// unsupported); a specific Locale is an explicit user override.
export type LanguagePreference = "system" | Locale;

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === "system" || (typeof value === "string" && isSupportedLocale(value));
}

// Full CLDR plural category set (https://cldr.unicode.org/index/cldr-spec/plural-rules) —
// exactly the categories `Intl.PluralRules#select` can return. `other` is the only universally
// required category (every locale's plural rules define it); the rest are optional because most
// locales don't use all of them — English/Spanish only ever populate `one`/`other`, and existing
// entries stay exactly as they are. A future locale that needs `few`/`many` (Russian) or the full
// set including `zero`/`two` (Arabic) can supply only the categories its own plural rules require.
export type PluralForms = {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
};

type TranslationValue = string | PluralForms;

export type TranslationTree = {
  [key: string]: TranslationValue | TranslationTree;
};

const PLURAL_CATEGORY_KEYS = ["zero", "one", "two", "few", "many", "other"] as const;

function isTranslationValue(node: TranslationValue | TranslationTree): node is TranslationValue {
  return typeof node === "string" || (typeof node === "object" && PLURAL_CATEGORY_KEYS.some((key) => key in node));
}

export { isTranslationValue };

// Recursively builds every dot-joined path in T that resolves to a leaf value (string or
// PluralForms), so t()/plural() call sites are checked against real keys at compile time
// instead of accepting arbitrary strings.
export type TranslationPath<T> = {
  [K in keyof T & string]: T[K] extends TranslationValue
    ? K
    : T[K] extends TranslationTree
      ? `${K}.${TranslationPath<T[K]>}`
      : never;
}[keyof T & string];
