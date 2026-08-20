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

// Chinese needs full-tag (not just primary-subtag) matching, because the primary subtag "zh"
// alone can't distinguish Simplified from Traditional — unlike every other locale here, script
// is the deciding factor, not region. Only Simplified Chinese has a resource (zh-Hans.ts); a
// bare "zh" tag (no script/region information at all) is treated as Simplified too, since that's
// resolving genuine ambiguity to the one resource that exists, not silently converting a script.
// Traditional tags are deliberately NOT matched here — see isTraditionalChineseTag below.
const SIMPLIFIED_CHINESE_TAGS = new Set(["zh", "zh-cn", "zh-sg", "zh-hans", "zh-hans-cn", "zh-hans-sg"]);

function isSimplifiedChineseTag(lowerTag: string): boolean {
  return SIMPLIFIED_CHINESE_TAGS.has(lowerTag) || lowerTag.startsWith("zh-hans-");
}

// "zh-TW", "zh-HK", "zh-Hant", "zh-Hant-*" — Traditional Chinese has no resource in this app.
// These must never silently resolve to the Simplified Chinese resource (that would show the
// wrong script to a Traditional-Chinese reader); the existing safe fallback (English, via
// FALLBACK_LOCALE) applies instead, exactly as it would for any other unsupported tag.
function isTraditionalChineseTag(lowerTag: string): boolean {
  return lowerTag === "zh-tw" || lowerTag === "zh-hk" || lowerTag === "zh-mo" || lowerTag === "zh-hant" || lowerTag.startsWith("zh-hant-");
}

/**
 * Priority: explicit user preference > first supported device language > English.
 * Device tags are full BCP-47 tags (e.g. "es-MX", "pt-PT", "zh-Hans-CN"); most locales match on
 * just the primary language subtag, since region does not affect which strings we show (Portuguese
 * is one deliberate exception — see PRIMARY_SUBTAG_LOCALE above; Chinese is the other — see
 * SIMPLIFIED_CHINESE_TAGS/isTraditionalChineseTag above, since script, not region, is what matters
 * there).
 */
export function resolveLanguage(preference: LanguagePreference, deviceLanguageTags: string[]): Locale {
  if (preference !== "system") return preference;

  for (const tag of deviceLanguageTags) {
    const lowerTag = tag.toLowerCase();
    const primarySubtag = lowerTag.split("-")[0];
    if (!primarySubtag) continue;

    if (primarySubtag === "zh") {
      if (isSimplifiedChineseTag(lowerTag)) return "zh-Hans";
      if (isTraditionalChineseTag(lowerTag)) continue;
      continue;
    }

    if (isSupportedLocale(primarySubtag)) return primarySubtag;
    const mapped = PRIMARY_SUBTAG_LOCALE[primarySubtag];
    if (mapped) return mapped;
  }

  return FALLBACK_LOCALE;
}
