import * as Localization from "expo-localization";
import { useEffect, useMemo, useState } from "react";

import { getLanguagePreference, setLanguagePreference as persistLanguagePreference } from "./languagePreference";
import { resolveLanguage } from "./resolveLanguage";
import { pluralize, translate, type TranslateParams, type TranslationKey } from "./translate";
import type { LanguagePreference, Locale } from "./types";

export type { Locale, LanguagePreference } from "./types";
export type { TranslationKey, TranslateParams } from "./translate";

const FALLBACK_LOCALE: Locale = "en";

type I18nState = {
  language: Locale;
  preference: LanguagePreference;
};

// English is the only supported language in this batch, so the very first render is already
// correct — initI18n() below only needs to reconcile the *stored preference* (for Settings'
// selection UI) in the background; nothing here can block or flash incorrect content on
// startup.
let state: I18nState = { language: FALLBACK_LOCALE, preference: "system" };
let initialized = false;

const listeners = new Set<(state: I18nState) => void>();

function emit() {
  listeners.forEach((listener) => listener(state));
}

export function onLanguageChanged(cb: (state: I18nState) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getI18nState(): I18nState {
  return state;
}

function deviceLanguageTags(): string[] {
  try {
    return Localization.getLocales().map((l) => l.languageTag);
  } catch {
    return [];
  }
}

/** Call once at app startup. Safe to call multiple times; safe to never await. */
export async function initI18n(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const preference = await getLanguagePreference();
  const language = resolveLanguage(preference, deviceLanguageTags());
  state = { language, preference };
  emit();
}

export async function setLanguagePreference(preference: LanguagePreference): Promise<void> {
  await persistLanguagePreference(preference);
  const language = resolveLanguage(preference, deviceLanguageTags());
  state = { language, preference };
  emit();
}

export type UseTranslation = {
  t: (key: TranslationKey, params?: TranslateParams) => string;
  plural: (key: TranslationKey, count: number, params?: TranslateParams) => string;
  language: Locale;
  preference: LanguagePreference;
  setLanguagePreference: typeof setLanguagePreference;
};

export function useTranslation(): UseTranslation {
  const [current, setCurrent] = useState<I18nState>(state);

  useEffect(() => onLanguageChanged(setCurrent), []);

  // Memoized per language (not per render): t/plural are commonly placed in useEffect/useMemo
  // dependency arrays by consumers (see app/index.tsx's greeting, sign-in-transition.tsx), so a
  // new function identity on every render would cause those to re-run constantly.
  return useMemo(
    () => ({
      t: (key: TranslationKey, params?: TranslateParams) => translate(current.language, key, params),
      plural: (key: TranslationKey, count: number, params?: TranslateParams) =>
        pluralize(current.language, key, count, params),
      language: current.language,
      preference: current.preference,
      setLanguagePreference,
    }),
    [current.language, current.preference]
  );
}
