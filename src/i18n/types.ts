// Every member here has a real resource file under ./locales and a corresponding entry in
// ./localeRegistry.ts (display name, enabled state, direction) — adding a language later means
// adding all three together, and `Record<Locale, ...>` usages elsewhere (localeRegistry.ts,
// translate.ts's RESOURCES, src/accessibility/speech.ts) force every one of those sites to be
// updated at compile time, not just remembered by convention. "pt-BR" (not bare "pt") is
// deliberate — see src/i18n/locales/pt-BR.ts's header comment. "zh-Hans" (not bare "zh" or
// "zh-CN") is the same kind of deliberate choice — see src/i18n/locales/zh-Hans.ts's header
// comment and resolveLanguage.ts's device-tag mapping for why.
export type Locale = "en" | "es" | "fr" | "pt-BR" | "it" | "de" | "nl" | "ru" | "zh-Hans" | "ja" | "ko" | "hi";

export const SUPPORTED_LOCALES: readonly Locale[] = [
  "en",
  "es",
  "fr",
  "pt-BR",
  "it",
  "de",
  "nl",
  "ru",
  "zh-Hans",
  "ja",
  "ko",
  "hi",
];

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

// Structural drift-protection for non-English translation resources: `en.ts`'s `as const` gives
// every leaf its own exact string-literal type (e.g. the type "Back", not string), so checking a
// translation resource directly `satisfies typeof en` would wrongly demand every other locale
// contain the literal English words. WidenLeaves recursively widens every leaf back to `string`
// (or `PluralForms`, for a plural entry — matched by structural compatibility, not by an exact
// literal) while preserving the exact key structure — every key `en.ts` has, every locale using
// `... as const satisfies WidenLeaves<typeof en>` must have too, or it's a compile-time error,
// not a silent runtime gap papered over by resolveLeaf's English fallback.
export type WidenLeaves<T> = T extends string
  ? string
  : T extends PluralForms
    ? PluralForms
    : { [K in keyof T]: WidenLeaves<T[K]> };
