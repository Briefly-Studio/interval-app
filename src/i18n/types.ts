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

export type PluralForms = {
  one: string;
  other: string;
};

type TranslationValue = string | PluralForms;

export type TranslationTree = {
  [key: string]: TranslationValue | TranslationTree;
};

function isTranslationValue(node: TranslationValue | TranslationTree): node is TranslationValue {
  return typeof node === "string" || (typeof node === "object" && ("one" in node || "other" in node));
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
