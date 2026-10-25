import AsyncStorage from "@react-native-async-storage/async-storage";

import { isValidAiConsentRecord, type AiConsentRecord } from "../domain/ai/aiConsent";
import type { WorkspaceScope } from "./workspaceScope";
import { scopedKey } from "./workspaceScope";

// First-use AI generation consent — mirrors src/storage/discover.ts's exact shape (same
// scopedKey per-account local storage, same read-upgrades-and-falls-back-safely posture). User-
// scoped, not device-scoped: real AI generation is only ever reachable by a signed-in account
// (a guest has no access token, so backendProvider.ts's generate() refuses before any network
// call), so scoping this per-account is the correct fit. Local-only — this does NOT sync across
// a signed-in user's own multiple devices; a second device re-prompts once, exactly like a fresh
// install would. No backend table was added for this, deliberately (see
// docs/ai-generation-foundation.md's "First-use consent" section).

export const AI_CONSENT_KEY = "interval.aiGenerationConsent.v1";

export const aiConsentKey = (scope: WorkspaceScope) => scopedKey(scope, AI_CONSENT_KEY);

/** Returns null for anything missing, corrupted, or structurally invalid — never throws, never
 * coerces. A null return is exactly what needsAiConsent() (src/domain/ai/aiConsent.ts) treats as
 * "consent required," so a corrupted record fails safely back to asking again. */
export async function getAiConsent(scope: WorkspaceScope): Promise<AiConsentRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(aiConsentKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidAiConsentRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The only write path — called once, immediately after the user taps Continue on the consent
 * prompt (see src/ui/aiConsentDialog.ts's caller in the Generate screen). Never called for
 * Cancel. */
export async function setAiConsent(scope: WorkspaceScope, record: AiConsentRecord): Promise<void> {
  await AsyncStorage.setItem(aiConsentKey(scope), JSON.stringify(record));
}
