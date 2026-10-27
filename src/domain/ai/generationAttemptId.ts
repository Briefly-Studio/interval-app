// A per-generation-attempt correlation id — introduced because none existed anywhere in the
// generation pipeline (confirmed by preflight audit: not in aiService.ts, generateDeckFlow.ts,
// generateDeckSession.ts, multiBatchGeneration.ts, the backend Lambda, or either review/options
// screen). Purely a correlation token for the evaluation harness and the review-outcome
// telemetry (generationTelemetry.ts) — never a security token, never persisted, never sent to
// any backend, never part of the generation CONTRACT (types.ts is untouched by this file).
//
// Deliberately NOT `crypto.randomUUID()` — that API's availability differs between the React
// Native/Hermes runtime this ships on and the plain Node runtime the evaluation CLI/tests run
// under, and this file must work identically in both with no polyfill. A non-cryptographic,
// Math.random()-seeded v4-shaped string is adequate: nothing security-sensitive ever depends on
// this id being unguessable, only on two different attempts almost certainly not colliding.

function randomHex(digitCount: number): string {
  let out = "";
  for (let i = 0; i < digitCount; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

/** RFC4122-v4-*shaped* (not a real UUIDv4 — no cryptographic guarantee), e.g. "a1b2c3d4-...". */
export function generateAttemptId(): string {
  return `${randomHex(8)}-${randomHex(4)}-4${randomHex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${randomHex(3)}-${randomHex(12)}`;
}
