// One opaque correlation ID per user-facing run; each provider request gets a separate ID.
// Native Expo already exposes its OS-backed UUID generator (expo-modules-core), while Node/
// browsers expose Web Crypto. No Math.random fallback: missing secure randomness fails closed.
export function generateAttemptId(): string {
  const native = (globalThis as typeof globalThis & { expo?: { uuidv4?: () => string } }).expo?.uuidv4;
  const id = native ? native() : globalThis.crypto?.randomUUID?.();
  if (!id) throw new Error("Secure request identity is unavailable.");
  return id.toLowerCase();
}
export const generateProviderRequestId = generateAttemptId;
