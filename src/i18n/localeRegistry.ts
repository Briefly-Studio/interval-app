import type { Locale } from "./types";

// Single authoritative source of per-locale display/presentation metadata — the piece that was
// previously missing, causing every consumer (app/language.tsx's options list, app/settings.tsx's
// language subtitle, and the "english"/"espanol" endonyms duplicated inside BOTH
// locales/en.ts and locales/es.ts) to hand-roll its own EN/ES-specific logic. A locale's own name
// for itself (its endonym, e.g. "Español") is never translated per the active UI language — it
// lives here, not in a translation resource, and is shown identically regardless of which
// language is currently selected.
//
// Adding a future locale means: (1) add its code to the `Locale` union in ./types.ts, (2) add a
// locales/<code>.ts resource file and register it in ./translate.ts's RESOURCES map, (3) add one
// entry here. `Record<Locale, LocaleInfo>` forces every one of those three steps to stay in sync
// at compile time — omitting a registry entry for a `Locale` union member is a type error, not a
// silent runtime gap.

export type LocaleDirection = "ltr" | "rtl";

export type LocaleInfo = {
  code: Locale;
  /** The language's own name for itself, in its own script (its endonym) — e.g. "English",
   * "Español". Always shown as-is, never translated per the active UI language. */
  nativeName: string;
  /** Whether this locale is currently offered to users (Settings language picker, `system`
   * auto-detection). A locale can exist in the `Locale` union and have a real resource file
   * while `enabled: false` — e.g. mid-translation and not yet ready to ship — without any
   * Settings/UI file needing to change once it's ready; only this flag flips. */
  enabled: boolean;
  /** Reading direction this locale's script requires. Metadata only in this batch — nothing
   * reads this to flip layout, invoke `I18nManager`, or otherwise change rendering. Exists so a
   * future RTL batch (e.g. Arabic) has a single place to add that fact rather than inventing a
   * new per-locale lookup at that time. */
  direction: LocaleDirection;
};

export const LOCALE_REGISTRY: Record<Locale, LocaleInfo> = {
  en: { code: "en", nativeName: "English", enabled: true, direction: "ltr" },
  es: { code: "es", nativeName: "Español", enabled: true, direction: "ltr" },
};

/** Locales currently offered in the UI (Settings language picker), in registry declaration
 * order. Derived from LOCALE_REGISTRY rather than hand-listed a second time, so a future locale
 * shipped with `enabled: false` never silently appears here before it's ready. */
export const ENABLED_LOCALES: readonly Locale[] = (Object.keys(LOCALE_REGISTRY) as Locale[]).filter(
  (code) => LOCALE_REGISTRY[code].enabled
);

export function getLocaleInfo(code: Locale): LocaleInfo {
  return LOCALE_REGISTRY[code];
}
