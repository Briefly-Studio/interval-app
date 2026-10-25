import { AiHttpError, generateStudyDeckRemote, getAiHttpBody, getAiHttpStatus, isAiNetworkError } from "../../cloud/ai/http";
import type { ModelProvider, ModelProviderInput, ModelProviderOutcome } from "./aiService";
import type { GenerationErrorCode } from "./types";

// The mobile-side real ModelProvider implementation. This file knows exactly one thing: "call
// Interval's own backend generation endpoint." It never names, imports, or references Bedrock,
// Nova, or any other model/provider SDK — that distinction matters for future provider/model
// routing (src/domain/ai/providerSelection.ts is the only file that chooses between this and the
// mock provider; this file never decides when it runs).
//
// Deliberately takes its access-token getter and base URL as injected dependencies rather than
// importing AuthService / getEnvironmentConfig directly — both of those import chains pull in
// native Expo modules that cannot load under the plain `node --test` runner this repository's AI
// test suite uses (confirmed directly). providerSelection.ts (the one real call site, only ever
// exercised from the actual React Native app, never from a Node test) supplies the real
// AuthService.getAccessToken / getEnvironmentConfig().apiBaseUrl; backendProvider.test.ts injects
// fakes, so this entire file — including the real generate() logic — is covered by a fully
// deterministic, network-free, credential-free test.
//
// Architectural rules this file exists to satisfy (see the Bedrock integration mission/audit):
// mobile never calls Bedrock directly, never stores or receives a Bedrock/AWS credential — the
// only credential anywhere in this file is whatever string the injected `getAccessToken` returns,
// exactly the same Cognito access token src/cloud/sync/SyncService.ts and
// src/cloud/librarySourceStorage/index.ts already use for every other authenticated backend call.

export const BACKEND_PROVIDER_ID = "interval-backend-v1";

export type BackendProviderDeps = {
  getAccessToken: () => Promise<string | null>;
  getBaseUrl: () => string;
};

// All known GenerationErrorCode values (src/domain/ai/types.ts) — used below to trust the
// server's own `error` field only when it's actually one of these, rather than assuming any
// string the server sends is safe to forward as-is.
const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set<GenerationErrorCode>([
  "normalization-not-ready",
  "source-empty",
  "source-too-large",
  "unsupported-source",
  "context-too-large",
  "rate-limited",
  "daily-limit-reached",
  "generation-in-progress",
  "generation-timeout",
  "provider-unavailable",
  "malformed-model-output",
  "unsafe-output",
  "validation-failed",
]);

// Fixed, generic, client-owned messages — deliberately never the server's own `message` string
// (defense in depth: even though the backend Lambda is this repository's own code and already
// sanitizes its error messages, this mobile-side mapping never depends on that remaining true).
const MESSAGE_FOR: Partial<Record<GenerationErrorCode, string>> = {
  "rate-limited": "You've reached the generation limit for now — try again later.",
  "daily-limit-reached": "You've reached today's AI generation limit. Try again tomorrow.",
  "generation-in-progress": "Another deck is already being generated. Finish that request before starting another.",
  "generation-timeout": "Generating took too long. Try again.",
  "provider-unavailable": "The generation service is unavailable right now.",
  "malformed-model-output": "The generation service returned an unexpected response.",
  "validation-failed": "The generated response did not pass validation.",
};

function genericMessage(code: GenerationErrorCode): string {
  return MESSAGE_FOR[code] ?? "The generation service could not complete this request.";
}

type BackendErrorBody = {
  error?: unknown;
};

function isKnownErrorCode(value: unknown): value is GenerationErrorCode {
  return typeof value === "string" && KNOWN_ERROR_CODES.has(value);
}

/**
 * Maps an AiHttpError into a ModelProviderOutcome error, trusting the server's own `error` field
 * only when it already matches one of the existing GenerationErrorCode values — never inventing
 * a new one, never forwarding an arbitrary server-sent string as if it were a trusted code.
 * Falls back to the HTTP status code's own closest semantic fit when the body doesn't carry a
 * recognizable code at all (e.g. a 401 before any JSON body is attached).
 */
function mapHttpErrorToOutcome(error: AiHttpError): ModelProviderOutcome {
  const status = getAiHttpStatus(error);
  const body = getAiHttpBody(error) as BackendErrorBody | undefined;

  if (isKnownErrorCode(body?.error)) {
    const code = body.error;
    return { status: "error", error: { code, message: genericMessage(code) } };
  }

  // No recognizable code in the body (e.g. 401 unauthorized, or a body-less/unexpected-shape
  // response) — fall back by status. 429 and 422 have a clean, unambiguous existing-code fit;
  // everything else (401, 400, 500, or anything else) means "the backend/provider couldn't be
  // used for this request," which is exactly what provider-unavailable represents — there is no
  // dedicated "unauthenticated" code in this taxonomy, and inventing one is explicitly out of
  // scope for this batch (see docs/ai-generation-foundation.md's error model).
  const fallbackCode: GenerationErrorCode = status === 429 ? "rate-limited" : status === 422 ? "validation-failed" : "provider-unavailable";
  return { status: "error", error: { code: fallbackCode, message: genericMessage(fallbackCode) } };
}

export function createBackendProvider(deps: BackendProviderDeps): ModelProvider {
  return {
    id: BACKEND_PROVIDER_ID,
    async generate(input: ModelProviderInput): Promise<ModelProviderOutcome> {
      const accessToken = await deps.getAccessToken();
      if (!accessToken) {
        // No dedicated "sign-in required" code exists in this taxonomy — provider-unavailable is
        // the closest honest fit: the real backend generation service is not usable for this
        // caller right now. The mock provider (src/domain/ai/mockProvider.ts) has no such
        // requirement, which is the actual, deliberate behavioral difference between the two —
        // see providerSelection.ts.
        return {
          status: "error",
          error: { code: "provider-unavailable", message: "Sign in to use the generation service." },
        };
      }

      try {
        const raw = await generateStudyDeckRemote(deps.getBaseUrl(), accessToken, input.request, input.context);
        return { status: "ok", raw };
      } catch (error) {
        if (isAiNetworkError(error)) {
          return {
            status: "error",
            error: { code: "provider-unavailable", message: genericMessage("provider-unavailable") },
          };
        }
        if (error instanceof AiHttpError) {
          return mapHttpErrorToOutcome(error);
        }
        // Defensive catch-all — never let an unrecognized thrown value escape as an unhandled
        // rejection; still returns a safe, existing-taxonomy outcome.
        return {
          status: "error",
          error: { code: "provider-unavailable", message: genericMessage("provider-unavailable") },
        };
      }
    },
  };
}
