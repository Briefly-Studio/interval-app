import AsyncStorage from "@react-native-async-storage/async-storage";

import { isLanguagePreference, type LanguagePreference } from "./types";

// Deliberately a plain, unscoped AsyncStorage key — NOT run through storage/workspaceScope's
// scopedKey(). Language is a device/app preference, not workspace ownership data: it must stay
// identical across guest/User A/User B and survive sign-out, so it must never be prefixed with
// a Cognito sub the way deck/card/session/cursor keys are.
const LANGUAGE_PREFERENCE_KEY = "briefly.languagePreference.v1";

const DEFAULT_PREFERENCE: LanguagePreference = "system";

/** Falls back to "system" for anything missing, corrupted, or no longer a supported value —
 * never throws, since a bad stored preference must not block app startup. */
export async function getLanguagePreference(): Promise<LanguagePreference> {
  try {
    const raw = await AsyncStorage.getItem(LANGUAGE_PREFERENCE_KEY);
    if (raw && isLanguagePreference(raw)) return raw;
    return DEFAULT_PREFERENCE;
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

/** Never throws — a storage write failure must not produce an unhandled rejection or block the
 * in-memory language state (see src/i18n/index.ts) from updating for the current session. */
export async function setLanguagePreference(preference: LanguagePreference): Promise<void> {
  try {
    await AsyncStorage.setItem(LANGUAGE_PREFERENCE_KEY, preference);
  } catch (error) {
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.warn("[i18n] failed to persist language preference:", error);
    }
  }
}
