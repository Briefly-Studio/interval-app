// Pure sync-state model: a flat, serializable snapshot of "what is the sync system doing right
// now", plus a module-level singleton store and a tiny pub/sub, mirroring the exact pattern
// already used by src/auth/authSignal.ts (signal) and src/i18n/index.ts (singleton + listeners).
// Deliberately has no React, no AsyncStorage, no NetInfo, and no import of SyncService/http.ts —
// this file only holds state and pure transition functions, so it can be unit-tested directly in
// a plain Node harness. The React hook + native network-listener wiring lives in
// ./useSyncState.ts, the same split this codebase already uses for i18n
// (translate.ts vs index.ts).

export type SyncStatus = "unknown" | "syncing" | "synced" | "offline" | "needsAttention";

export type SyncState = {
  status: SyncStatus;
  lastSuccessfulSyncAt?: string;
  lastAttemptAt?: string;
  diagnosticCode?: string;
  pendingDirtyCount: number;
  isOnline: boolean;
};

// Pre-first-evidence: the app must not claim "synced" before any sync attempt has actually
// happened (or, for a guest, before there's even a cloud identity to sync with). "unknown" is
// the honest, non-alarming resting state the UI renders as calm/neutral rather than as an error.
// isOnline starts optimistic (true) since most sessions do start online and this flag is never
// itself used to claim a successful sync — only initSyncState()'s NetInfo listener updates it
// with real evidence going forward.
const INITIAL_STATE: SyncState = {
  status: "unknown",
  pendingDirtyCount: 0,
  isOnline: true,
};

let state: SyncState = { ...INITIAL_STATE };

const listeners = new Set<(state: SyncState) => void>();

function emit(): void {
  for (const cb of listeners) {
    try {
      cb(state);
    } catch {
      // ignore — a broken listener must not break the sync-state store itself.
    }
  }
}

function patchState(patch: Partial<SyncState>): void {
  state = { ...state, ...patch };
  emit();
}

export function getSyncState(): SyncState {
  return state;
}

export function onSyncStateChanged(cb: (state: SyncState) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// --- Transitions — each corresponds 1:1 to a state change in the product spec ---

/** A sync attempt (push or pull actively running, including a retry) has begun. */
export function markSyncStarted(): void {
  patchState({ status: "syncing", lastAttemptAt: new Date().toISOString(), diagnosticCode: undefined });
}

/** The attempt completed successfully — matches today's emitSyncComplete() success path. */
export function markSyncSucceeded(): void {
  patchState({ status: "synced", lastSuccessfulSyncAt: new Date().toISOString(), diagnosticCode: undefined });
}

/**
 * The attempt failed because the device/network couldn't reach the server at all (or we already
 * know we're offline before even trying). This is expected/normal, not an error — never carries
 * a diagnosticCode.
 */
export function markSyncOffline(): void {
  patchState({ status: "offline", diagnosticCode: undefined });
}

/**
 * The attempt failed for a reason that is NOT ordinary offline — a server-side rejection, an
 * auth-refresh failure, or any other unexpected throw. `diagnosticCode` must already be a SAFE
 * value (status number, error class name, or a short fixed string) — never a raw error message,
 * stack, token, or claim. Callers are responsible for that sanitization (see http.ts's
 * getSyncDiagnosticCode).
 */
export function markSyncNeedsAttention(diagnosticCode: string): void {
  patchState({ status: "needsAttention", diagnosticCode });
}

/**
 * Recomputes only when a caller has fresh evidence (a sync attempt starting/completing, or an
 * explicit on-demand check) — never wire this to a render-triggered effect that would rescan
 * storage on every render.
 */
export function setPendingDirtyCount(count: number): void {
  patchState({ pendingDirtyCount: count });
}

/** Updated by the NetInfo subscription in useSyncState.ts — never by polling. */
export function setOnline(isOnline: boolean): void {
  patchState({ isOnline });
}

/**
 * Guest workspace and sign-out both mean "no cloud identity to report a meaningful sync status
 * for" — this is normal per this app's offline-first design (see CLAUDE.md's Core Product
 * Rule), not an error and not "offline" in the connectivity sense. Resets to the same shape as
 * the pre-first-evidence state so a previous account's status/diagnostics/pending-count can never
 * leak into a guest view or a different signed-in account after a workspace switch. The UI layer
 * additionally chooses not to render any sync-status text at all while signed out (see
 * app/index.tsx and app/settings.tsx), so this is primarily a safety net against stale reads
 * rather than something a user ever sees rendered directly.
 */
export function resetSyncState(): void {
  state = { ...INITIAL_STATE, isOnline: state.isOnline };
  emit();
}
