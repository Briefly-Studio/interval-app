import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

// Canonical accessibility preference store — same useSyncExternalStore pattern already proven by
// src/theme/index.ts, so every consumer (Settings, Review, Quiz) reads one consistent, reactive
// snapshot instead of each re-implementing its own subscription.
//
// Deliberately a small, flat model — every field here has a concrete, already-wired
// implementation (see src/accessibility/useSpeech.ts for speech, src/ui/BrandStartup.tsx and
// app/sign-in-transition.tsx for reduceMotionOverride). No field exists here that doesn't
// actually change app behavior.

export type SpeechRate = "slower" | "standard" | "faster";

export type AccessibilityPreferences = {
  /** Whether the text-to-speech controls appear on study screens at all. Off by user choice
   * only — never auto-disabled, and speech itself never plays without an explicit tap regardless
   * of this setting. */
  speechEnabled: boolean;
  speechRate: SpeechRate;
  /** Forces the same reduced-motion behavior the app already applies when the OS-level Reduce
   * Motion setting is on, even when that OS setting is off. Interval follows the system
   * preference by default (see src/ui/BrandStartup.tsx / app/sign-in-transition.tsx); this is an
   * explicit, reversible, app-level opt-in for users who want calmer motion without changing a
   * device-wide OS setting. */
  reduceMotionOverride: boolean;
};

// A new, compatibility-safe key — this is new preference data with no prior "Briefly" naming to
// preserve, so it intentionally uses the current "interval." prefix rather than "briefly." (see
// CLAUDE.md's "Legacy Briefly identifiers" section for why existing briefly.* keys are never
// renamed; this is a genuinely new key, not a rename).
const STORAGE_KEY = "interval.accessibilityPreferences.v1";

export const SPEECH_RATES: readonly SpeechRate[] = ["slower", "standard", "faster"];

// Maps a SpeechRate to expo-speech's numeric `rate` option (1.0 = the platform's normal rate).
export const SPEECH_RATE_VALUES: Record<SpeechRate, number> = {
  slower: 0.75,
  standard: 1.0,
  faster: 1.25,
};

const DEFAULT_PREFERENCES: AccessibilityPreferences = {
  speechEnabled: true,
  speechRate: "standard",
  reduceMotionOverride: false,
};

function isSpeechRate(value: unknown): value is SpeechRate {
  return value === "slower" || value === "standard" || value === "faster";
}

/** Never throws — any missing/corrupted/legacy-shaped stored value falls back field-by-field to
 * the default rather than discarding the whole record. */
function normalize(raw: unknown): AccessibilityPreferences {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PREFERENCES };
  const r = raw as Partial<AccessibilityPreferences>;
  return {
    speechEnabled: typeof r.speechEnabled === "boolean" ? r.speechEnabled : DEFAULT_PREFERENCES.speechEnabled,
    speechRate: isSpeechRate(r.speechRate) ? r.speechRate : DEFAULT_PREFERENCES.speechRate,
    reduceMotionOverride:
      typeof r.reduceMotionOverride === "boolean" ? r.reduceMotionOverride : DEFAULT_PREFERENCES.reduceMotionOverride,
  };
}

let state: AccessibilityPreferences = { ...DEFAULT_PREFERENCES };

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): AccessibilityPreferences {
  return state;
}

let initPromise: Promise<void> | null = null;

/** Safe to call more than once — concurrent/repeated calls share the same in-flight promise,
 * matching the same pattern as src/theme/index.ts's initTheme(). */
export function initAccessibilityPreferences(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        state = normalize(JSON.parse(raw));
        emit();
      }
    } catch {
      // Keep the in-memory defaults — a corrupted or unreadable stored preference must never
      // block startup or crash.
    }
  })();
  return initPromise;
}

async function persist(next: AccessibilityPreferences): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.warn("[accessibility] failed to persist preferences:", error);
    }
  }
}

export async function setSpeechEnabled(enabled: boolean): Promise<void> {
  state = { ...state, speechEnabled: enabled };
  emit();
  await persist(state);
}

export async function setSpeechRate(rate: SpeechRate): Promise<void> {
  state = { ...state, speechRate: rate };
  emit();
  await persist(state);
}

export async function setReduceMotionOverride(value: boolean): Promise<void> {
  state = { ...state, reduceMotionOverride: value };
  emit();
  await persist(state);
}

/** Synchronous snapshot for non-React call sites (e.g. BrandStartup's own reduced-motion check,
 * which already runs outside a component's render). */
export function getAccessibilityPreferences(): AccessibilityPreferences {
  return state;
}

export function useAccessibilityPreferences(): AccessibilityPreferences {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
