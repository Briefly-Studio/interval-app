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
// USE_BACKEND_PROVIDER defaults to false because nothing has actually been deployed yet in this
// batch (Phase A has no CDK changes — see docs/ai-generation-foundation.md and the Bedrock
// integration implementation report): flipping it to true today would just make every real
// generation attempt fail with a network error, since there is no live endpoint to call. This is
// the explicit, obvious, one-line way to exercise the backend-calling path locally once a
// Development deployment exists (Phase B+) — a deliberate, founder-reviewed code change, never an
// automatic runtime toggle.
const USE_BACKEND_PROVIDER = false;

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
