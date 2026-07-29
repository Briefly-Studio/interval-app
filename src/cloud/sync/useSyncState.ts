import NetInfo from "@react-native-community/netinfo";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AuthService } from "../../auth/AuthService";
import { onWorkspaceChanged } from "../../auth/authSignal";
import { SyncService } from "./SyncService";
import {
  getSyncState,
  onSyncStateChanged,
  resetSyncState,
  setOnline,
  setPendingDirtyCount,
  type SyncState,
} from "./syncState";

// This is the React/native-API glue layer for src/cloud/sync/syncState.ts's pure store — same
// split this codebase already uses for i18n (translate.ts vs index.ts). Everything here is
// wired up exactly once via initSyncState(), never per-hook-call, so remounts/Fast Refresh never
// accumulate duplicate NetInfo or workspace-change listeners.

let initialized = false;

// Tracks only the offline->online edge (not every NetInfo event) so a reconnect triggers at most
// one opportunistic sync attempt — never a retry loop, backoff spam, or polling.
let wasOffline = false;

async function refreshPendingDirtyCount(): Promise<void> {
  const scope = await AuthService.getActiveScope();
  if (scope.kind === "guest") {
    setPendingDirtyCount(0);
    return;
  }
  const count = await SyncService.getPendingDirtyCount(scope);
  setPendingDirtyCount(count);
}

/**
 * Call once at app startup (see app/_layout.tsx, alongside initI18n()). Safe to call multiple
 * times — only the first call does anything.
 */
export function initSyncState(): void {
  if (initialized) return;
  initialized = true;

  NetInfo.addEventListener((netState) => {
    const isOnline = netState.isConnected === true && netState.isInternetReachable !== false;
    setOnline(isOnline);

    if (isOnline && wasOffline) {
      // "Returning online should trigger or permit normal sync" — a single opportunistic
      // attempt only. SyncService.syncOnce() itself no-ops for guests and dedupes concurrent
      // calls, so this can never stack with an already-running sync or run for a signed-out
      // workspace.
      AuthService.getActiveScope().then((scope) => {
        if (scope.kind === "user") {
          SyncService.syncOnce().catch(() => {
            // Already classified and recorded onto syncState by SyncService itself.
          });
        }
      });
    }
    wasOffline = !isOnline;
  });

  // Account/workspace switches must not let one scope's status, diagnostics, or pending count
  // linger under a different scope's session (or under the guest view, which shows no sync
  // status UI at all — see app/index.tsx / app/settings.tsx).
  onWorkspaceChanged((scope) => {
    resetSyncState();
    if (scope.kind === "user") {
      refreshPendingDirtyCount();
    }
  });
}

export type UseSyncState = SyncState & { retrySync: () => void };

export function useSyncState(): UseSyncState {
  const [state, setState] = useState<SyncState>(getSyncState());

  useEffect(() => onSyncStateChanged(setState), []);

  // A single user-initiated (or reconnect-triggered) attempt — never a loop. syncOnce()'s own
  // in-flight dedup means a retry while already syncing just attaches to the run in progress
  // rather than starting a second one.
  const retrySync = useCallback(() => {
    SyncService.syncOnce().catch(() => {
      // Errors are already reflected into syncState by SyncService; nothing further to do here.
    });
  }, []);

  // Memoized per meaningful field (not per render) — same rationale as useTranslation() in
  // src/i18n/index.ts: consumers may put this hook's return value in effect/memo dependency
  // arrays, so a new object/function identity on every render would cause those to re-run
  // constantly.
  return useMemo(
    () => ({
      status: state.status,
      lastSuccessfulSyncAt: state.lastSuccessfulSyncAt,
      lastAttemptAt: state.lastAttemptAt,
      diagnosticCode: state.diagnosticCode,
      pendingDirtyCount: state.pendingDirtyCount,
      isOnline: state.isOnline,
      retrySync,
    }),
    [
      state.status,
      state.lastSuccessfulSyncAt,
      state.lastAttemptAt,
      state.diagnosticCode,
      state.pendingDirtyCount,
      state.isOnline,
      retrySync,
    ]
  );
}
