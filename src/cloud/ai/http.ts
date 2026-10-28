import type { GenerateStudyDeckRequest, GenerationContext } from "../../domain/ai/types";

// Mirrors src/cloud/sync/http.ts's and src/cloud/librarySourceStorage/http.ts's *NetworkError/
// *HttpError split exactly, for the same reason: callers need to tell "couldn't reach the server
// at all" apart from "the server rejected this request" (see src/domain/ai/backendProvider.ts,
// the only caller of this module).
//
// Deliberately does NOT import getEnvironmentConfig (src/config/environment.ts) the way
// src/cloud/sync/http.ts does — that import chain pulls in expo-constants, which cannot be
// loaded under the plain `node --test` runner this repository's AI test suite uses (confirmed
// directly: it fails at module load with a native-module/type-stripping error, long before any
// test body runs). `baseUrl` is therefore a plain parameter the caller supplies (backendProvider.ts
// reads it from getEnvironmentConfig() once, at the one place in the chain that's only ever
// exercised from the real app, never from a Node test) — keeping this module fully testable with
// zero RN/Expo imports, same spirit as src/domain/ai/aiService.ts staying provider-neutral.

export class AiNetworkError extends Error {}

export class AiHttpError extends Error {
  status: number;
  /** Parsed JSON response body, if the server returned a JSON body — callers use this for
   * precise error-code mapping (see backendProvider.ts). Never assumed to be present or
   * well-formed; `undefined` when the response had no body or wasn't valid JSON. */
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// Conceptual backend route — not yet wired into API Gateway/CDK in this batch (see
// docs/ai-generation-foundation.md's "Backend architecture" section; Phase B wires this). Kept
// isolated in exactly one place so updating it later (if the real route path ever differs) never
// touches the request-building or error-handling logic below.
const GENERATE_STUDY_DECK_PATH = "/ai/generate-study-deck";

/**
 * Calls the (not yet deployed) backend Generate Study Deck endpoint. `raw` is deliberately
 * `unknown` — this module never gives the response any structure; only
 * src/domain/ai/responseValidation.ts's validateGeneratedDeckResponse is trusted to do that (see
 * backendProvider.ts). No provider name, model id, or AWS credential appears anywhere in this
 * file — it only knows "call Interval's backend generation endpoint," never which provider that
 * endpoint happens to use server-side.
 */
export async function generateStudyDeckRemote(
  baseUrl: string,
  accessToken: string,
  request: GenerateStudyDeckRequest,
  context: GenerationContext,
  onExecutionInfo?: (info: { providerExecutionCount?: number; idempotencyReplay?: boolean }) => void
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${GENERATE_STUDY_DECK_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ request, context }),
    });
  } catch (error) {
    throw new AiNetworkError(error instanceof Error ? error.message : "Network request failed");
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    // No body, or a non-JSON body — leave body undefined; callers must not assume it's present.
  }

  if (!res.ok) {
    throw new AiHttpError(res.status, `generate-study-deck failed: ${res.status}`, body);
  }

  if (body === undefined) throw new AiNetworkError("Generation response could not be confirmed.");
  const executions = res.headers?.get?.("x-interval-provider-executions");
  const replay = res.headers?.get?.("x-interval-idempotency-replay");
  onExecutionInfo?.({ ...(executions === "0" || executions === "1" ? { providerExecutionCount: Number(executions) } : {}),
    ...(replay === "true" || replay === "false" ? { idempotencyReplay: replay === "true" } : {}) });
  return body;
}

/** True when the error represents "couldn't reach the server at all" rather than a server-side rejection. */
export function isAiNetworkError(error: unknown): boolean {
  return error instanceof AiNetworkError;
}

/** The server's numeric HTTP status, if this error came from a non-ok response. */
export function getAiHttpStatus(error: unknown): number | undefined {
  return error instanceof AiHttpError ? error.status : undefined;
}

/** The server's parsed JSON response body, if this error came from a non-ok response that returned one. */
export function getAiHttpBody(error: unknown): unknown {
  return error instanceof AiHttpError ? error.body : undefined;
}
