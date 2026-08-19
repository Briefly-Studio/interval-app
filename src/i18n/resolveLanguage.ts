import { isSupportedLocale, type LanguagePreference, type Locale } from "./types";

const FALLBACK_LOCALE: Locale = "en";

// Most supported locales are matched by their bare primary subtag (e.g. device "es-MX" -> "es"),
// since region doesn't affect which strings we show. Portuguese is the one exception: our only
// Portuguese resource is Brazilian ("pt-BR" — see locales/pt-BR.ts's header comment for why no
// bare "pt"/"pt-PT" exists), so a device reporting ANY Portuguese variant (Brazilian or European)
// falls back to it rather than to English — the closest available match, not a mismatch.
const PRIMARY_SUBTAG_LOCALE: Partial<Record<string, Locale>> = {
  pt: "pt-BR",
};

/**
 * Priority: explicit user preference > first supported device language > English.
 * Device tags are full BCP-47 tags (e.g. "es-MX", "pt-PT"); only the primary language subtag is
 * matched, since region does not affect which strings we show (Portuguese is the one deliberate
 * exception — see PRIMARY_SUBTAG_LOCALE above).
 */
export function resolveLanguage(preference: LanguagePreference, deviceLanguageTags: string[]): Locale {
  if (preference !== "system") return preference;

  for (const tag of deviceLanguageTags) {
    const primarySubtag = tag.split("-")[0]?.toLowerCase();
    if (!primarySubtag) continue;
    if (isSupportedLocale(primarySubtag)) return primarySubtag;
    const mapped = PRIMARY_SUBTAG_LOCALE[primarySubtag];
    if (mapped) return mapped;
  }

  return FALLBACK_LOCALE;
}
