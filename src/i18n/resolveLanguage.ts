import { isSupportedLocale, type LanguagePreference, type Locale } from "./types";

const FALLBACK_LOCALE: Locale = "en";

/**
 * Priority: explicit user preference > first supported device language > English.
 * Device tags are full BCP-47 tags (e.g. "es-MX"); only the primary language subtag is
 * matched against SUPPORTED_LOCALES, since region does not affect which strings we show.
 */
export function resolveLanguage(preference: LanguagePreference, deviceLanguageTags: string[]): Locale {
  if (preference !== "system") return preference;

  for (const tag of deviceLanguageTags) {
    const primarySubtag = tag.split("-")[0]?.toLowerCase();
    if (primarySubtag && isSupportedLocale(primarySubtag)) return primarySubtag;
  }

  return FALLBACK_LOCALE;
}
