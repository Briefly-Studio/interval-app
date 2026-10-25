import { AuthService } from "../../auth/AuthService";
import { getEnvironmentConfig } from "../../config/environment";
import type { ModelProvider } from "./aiService";
import { createBackendProvider } from "./backendProvider";
import { createMockProvider } from "./mockProvider";

// The ONE place that decides which ModelProvider a generation attempt actually uses. Deliberately
// kept outside aiService.ts / types.ts / responseValidation.ts (which stay fully provider-
// neutral) and outside backendProvider.ts / mockProvider.ts themselves (each only implements
// ModelProvider; neither decides when it runs). generateDeckFlow.ts calls this instead of
// instantiating a provider directly — see that file for the single call site.
//
// This file (not backendProvider.ts) is the one place that imports AuthService and
// getEnvironmentConfig for the AI domain — both native-module-backed import chains that only
// resolve inside the real React Native app, never under the plain `node --test` runner this
// repository's AI suite uses. That's deliberate: this file has no dedicated test (same as
// generateStudyDeckCapability.ts's isGenerateStudyDeckEnabled() and app/dev-tools.tsx's
// isDevToolsEnabled(), neither of which has one either — a two-branch, fail-closed selector is
// exercised by direct code review here, the same way those are); backendProvider.ts's own real
// generate() logic IS fully covered by backendProvider.test.ts, via injected fakes for exactly
// the two functions this file supplies for real below.
//
// No multi-provider routing exists here — this is intentionally a two-way choice (mock vs. the
// one backend provider), not a router. A future batch that adds model/task routing (e.g. a
// second Bedrock model, or a non-Bedrock provider) replaces createBackendProvider()'s own
// internals, or adds a genuine router behind this same seam — neither requires touching
// aiService.ts, generateDeckFlow.ts, or any domain contract type.
//
// USE_BACKEND_PROVIDER was false through Phase A/Phase B (no live endpoint existed yet to call).
// The Development backend is now deployed and has been smoke-tested end to end — mobile-shaped
// request → Development Lambda → Bedrock Converse → Amazon Nova 2 Lite → a validated study deck
// response — so this is now flipped to true, the deliberate, founder-reviewed step this constant
// was always meant to gate (see its own original comment history). It remains a single, explicit,
// obvious constant, never an automatic runtime toggle: flipping it back to false instantly reverts
// every environment to the mock provider, with zero other code change, which is exactly why this
// stayed a one-line seam rather than a feature-flag framework. The function below still only ever
// activates the backend provider in the Development environment regardless of this constant's
// value — Staging and Production are unaffected by this change.
const USE_BACKEND_PROVIDER = true;

/**
 * Even when USE_BACKEND_PROVIDER is true, the backend provider is only ever selected in the
 * Development environment — fails closed to the mock provider for Staging, Production, or an
 * unreadable/misconfigured environment. This is defense-in-depth: isGenerateStudyDeckEnabled()
 * (generateStudyDeckCapability.ts, unchanged by this batch) already keeps the entire Generate
 * Study Deck UX out of Production, so this seam should never actually be reached there — but
 * this function does not rely on that other gate being correct, and never activates the real
 * backend provider outside Development regardless.
 */
export function selectModelProvider(): ModelProvider {
  if (!USE_BACKEND_PROVIDER) return createMockProvider();

  try {
    const { isDevelopment, apiBaseUrl } = getEnvironmentConfig();
    if (!isDevelopment) return createMockProvider();
    return createBackendProvider({
      getAccessToken: () => AuthService.getAccessToken(),
      getBaseUrl: () => apiBaseUrl,
    });
  } catch {
    return createMockProvider();
  }
}

/**
 * Whether a generation attempt right now would actually reach the real backend provider (true)
 * or the mock (false) — the exact same two-branch decision selectModelProvider() makes above,
 * restated as a boolean a caller can check BEFORE generating, without constructing a provider at
 * all. This is the single source of truth the first-use AI consent gate
 * (src/domain/ai/aiConsent.ts's needsAiConsent, called from the Generate screen) is built on, so
 * that gate tracks this decision automatically if Staging/Production are ever flipped to real AI
 * later — no redesign, no second place that has to be kept in sync with this one.
 */
export function isRealProviderActive(): boolean {
  if (!USE_BACKEND_PROVIDER) return false;
  try {
    return getEnvironmentConfig().isDevelopment;
  } catch {
    return false;
  }
}
