import AsyncStorage from "@react-native-async-storage/async-storage";

import { isAppearanceMode, type AppearanceMode } from "./types";

// Deliberately a plain, unscoped AsyncStorage key — NOT run through storage/workspaceScope's
// scopedKey(), mirroring src/i18n/languagePreference.ts exactly: appearance is a device/app
// preference, not workspace ownership data, so it must stay identical across guest/User A/User B
// and survive sign-out. Not SecureStore — this is not sensitive data, and AsyncStorage is the
// established convention for this exact class of preference in this app.
const APPEARANCE_PREFERENCE_KEY = "briefly.appearancePreference.v1";

const DEFAULT_MODE: AppearanceMode = "system";

/** Falls back to "system" for anything missing, corrupted, or no longer a supported value —
 * never throws, since a bad stored preference must not block app startup. */
export async function getAppearancePreference(): Promise<AppearanceMode> {
  try {
    const raw = await AsyncStorage.getItem(APPEARANCE_PREFERENCE_KEY);
    if (raw && isAppearanceMode(raw)) return raw;
    return DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

/** Never throws — a storage write failure must not produce an unhandled rejection or block the
 * in-memory appearance state (see src/theme/index.ts) from updating for the current session. */
export async function setAppearancePreference(mode: AppearanceMode): Promise<void> {
  try {
    await AsyncStorage.setItem(APPEARANCE_PREFERENCE_KEY, mode);
  } catch (error) {
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.warn("[theme] failed to persist appearance preference:", error);
    }
  }
}
