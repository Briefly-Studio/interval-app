import { Platform } from "react-native";
import * as ExpoSecureStore from "expo-secure-store";

// expo-secure-store's web target (node_modules/expo-secure-store/src/ExpoSecureStore.web.ts) is
// an unimplemented stub — none of getValueWithKeyAsync/setValueWithKeyAsync/
// deleteValueWithKeyAsync exist there, so calling SecureStore.getItemAsync/setItemAsync/
// deleteItemAsync directly on web throws. This module is the ONLY place in the app allowed to
// import "expo-secure-store" directly (see src/auth/AuthService.ts and src/storage/device.ts,
// both of which import from here instead) — platform-safety is enforced in exactly one place
// rather than re-checked at every call site.
//
// Native (iOS/Android) behavior is completely unchanged: every call passes straight through to
// the real expo-secure-store. On web, every call resolves to a safe no-op instead of throwing —
// get resolves null (as if nothing were ever stored), set/delete resolve without persisting
// anything. This app's V3 beta scope is iOS-first with web access gated behind a dedicated
// unsupported-state screen (see app/_layout.tsx) before any of these calls would normally be
// reached, but this wrapper exists independently of that gate as defense in depth — nothing here
// depends on the gate being present or correctly wired to stay safe.
const isWeb = Platform.OS === "web";

export async function getItemAsync(key: string): Promise<string | null> {
  if (isWeb) return null;
  return ExpoSecureStore.getItemAsync(key);
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  if (isWeb) return;
  await ExpoSecureStore.setItemAsync(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  if (isWeb) return;
  await ExpoSecureStore.deleteItemAsync(key);
}
