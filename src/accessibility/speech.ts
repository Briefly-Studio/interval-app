import * as Speech from "expo-speech";

import type { Locale } from "../i18n";

// Maps Interval's own resolved UI language (never card content, which this app has no reliable
// way to detect — see useSpeech.ts's doc comment) to a concrete speech language tag.
// Record<Locale, ...> forces an entry for every locale in src/i18n/types.ts's Locale union —
// adding a locale there without a speech tag here is a compile-time error.
const SPEECH_LANGUAGE_TAGS: Record<Locale, string> = {
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  "pt-BR": "pt-BR",
  it: "it-IT",
  de: "de-DE",
  nl: "nl-NL",
  ru: "ru-RU",
  "zh-Hans": "zh-CN",
  ja: "ja-JP",
  ko: "ko-KR",
  hi: "hi-IN",
  ar: "ar-SA",
};

export function speechLanguageTag(locale: Locale): string {
  return SPEECH_LANGUAGE_TAGS[locale];
}

// The only file in the app allowed to import expo-speech directly — every study screen goes
// through src/accessibility/useSpeech.ts instead, which layers preference-awareness and
// screen-lifecycle cleanup on top of this thin wrapper.
//
// expo-speech's Speech.speak/Speech.stop drive the OS's own on-device text-to-speech engine
// (AVSpeechSynthesizer on iOS, TextToSpeech on Android) — no network request is made and no
// cloud service is involved. The spoken text itself is never logged here or anywhere in this
// module; only fixed, content-free diagnostic strings would ever be safe to log, and this
// module doesn't log anything at all in the normal path.

export type SpeakOptions = {
  language?: string;
  rate?: number;
  onDone?: () => void;
  onStopped?: () => void;
  onError?: () => void;
};

/**
 * Speaks `text` aloud, stopping any Interval speech already in progress first. That stop-first
 * ordering is what guarantees at most one utterance is ever in flight — it's what makes both
 * "starting new speech stops existing speech" and "rapid repeated taps never overlap" true by
 * construction, not by separately tracked state. Never throws: a platform-level speech failure
 * (no TTS voice installed, engine error, etc.) is routed to `onError` instead, so a speech
 * problem can never crash or block studying.
 */
export function speak(text: string, options: SpeakOptions = {}): void {
  const trimmed = text.trim();
  if (!trimmed) return;

  try {
    Speech.stop();
    Speech.speak(trimmed, {
      language: options.language,
      rate: options.rate,
      onDone: options.onDone,
      onStopped: options.onStopped,
      onError: () => options.onError?.(),
    });
  } catch {
    options.onError?.();
  }
}

/** Never throws. Safe to call even when nothing is currently speaking. */
export function stopSpeech(): void {
  try {
    Speech.stop();
  } catch {
    // Nothing meaningful to recover — there is no further action that would help here.
  }
}
