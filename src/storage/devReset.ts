import AsyncStorage from "@react-native-async-storage/async-storage";
import { SyncService } from "../cloud/sync/SyncService";
import { deleteCardsForDeck } from "./cards";
import { getDecksAll } from "./decks";
import { cursorKey, decksKey, sessionsKey } from "./keys";
import type { WorkspaceScope } from "./workspaceScope";

async function wipeScope(scope: WorkspaceScope): Promise<void> {
  const decks = await getDecksAll(scope);
  await Promise.all(decks.map((deck) => deleteCardsForDeck(scope, deck.id)));
  await AsyncStorage.removeItem(cursorKey(scope));
  await AsyncStorage.removeItem(decksKey(scope));
  await AsyncStorage.removeItem(sessionsKey(scope));
}

export async function resetLocalData(scope: WorkspaceScope): Promise<void> {
  await wipeScope(scope);
}

// Thrown when Force Resync cannot proceed because local changes could not be confirmed as
// synced — see forceFullResyncPrep below. Callers (dev-tools.tsx) are expected to catch this
// specifically and show a clear, non-destructive explanation rather than a generic failure.
export class ForceResyncUnsyncedChangesError extends Error {
  pendingCount: number;
  constructor(pendingCount: number) {
    super(`Force Resync refused: ${pendingCount} local change(s) could not be confirmed as synced.`);
    this.pendingCount = pendingCount;
  }
}

// Defensive guard: guest data exists only on this device and has no cloud copy to restore
// from, so wiping it here would be permanent data loss. This backstops the UI-level guard in
// dev-tools.tsx in case another caller invokes Force Resync for the guest workspace by mistake.
//
// Force Resync must never silently destroy unsynced local work (see invariant #14 in
// docs/sync-invariants.md). A real sync attempt is required first — that same attempt also
// serializes with any already-in-flight sync via SyncService's own inFlightSync dedup, so the
// wipe below can never run concurrently with another sync's reads/writes to this scope's
// storage. If dirty records remain after the attempt (rejected by the server, offline, or any
// other unresolved failure), this refuses to wipe rather than guessing at "safe enough anyway".
export async function forceFullResyncPrep(scope: WorkspaceScope): Promise<void> {
  if (scope.kind === "guest") {
    throw new Error(
      "Force Resync is not available for the guest workspace: guest data exists only locally " +
        "and has no cloud copy to restore from."
    );
  }

  await SyncService.syncOnce().catch(() => {
    // Already classified into syncState by SyncService itself — the pendingDirtyCount check
    // below, not this catch, is what actually decides whether it's safe to proceed.
  });

  const stillDirty = await SyncService.getPendingDirtyCount(scope);
  if (stillDirty > 0) {
    throw new ForceResyncUnsyncedChangesError(stillDirty);
  }

  await wipeScope(scope);
}
