import type { CardRecord } from "../../models/card";
import type { DeckRecord } from "../../models/deck";
import type { SessionRecord } from "../../models/session";
import type { Change, EntityType } from "./types";

import { AuthService } from "../../auth/AuthService";
import { getCardsAll, setCards } from "../../storage/cards";
import { getDecksAll, setDecks } from "../../storage/decks";
import { getDeviceId } from "../../storage/device";
import { getSessions, setSessions } from "../../storage/sessions";
import { getSyncCursor, setSyncCursor } from "../../storage/sync";
import type { WorkspaceScope } from "../../storage/workspaceScope";
import { sameScope } from "../../storage/workspaceScope";
import { getSyncDiagnosticCode, isSyncNetworkError, pullChanges, pushChanges } from "./http";
import {
  getSyncState,
  markSyncNeedsAttention,
  markSyncOffline,
  markSyncStarted,
  markSyncSucceeded,
  resetSyncState,
  setPendingDirtyCount,
} from "./syncState";
import { emitSyncComplete } from "./syncSignal";

const toTime = (value: string | undefined) => {
  const t = value ? Date.parse(value) : NaN;
  return Number.isFinite(t) ? t : 0;
};

async function applyChanges(scope: WorkspaceScope, changes: Change[]): Promise<void> {
  if (changes.length === 0) return;

  const now = new Date().toISOString();
  const ordered = [...changes].sort((a, b) => toTime(a.ts) - toTime(b.ts));

  const deckChanges = ordered.filter((c) => c.entity === "deck");
  const cardChanges = ordered.filter((c) => c.entity === "card");
  const sessionChanges = ordered.filter((c) => c.entity === "session");

  if (deckChanges.length) {
    const decks = await getDecksAll(scope);
    const byId = new Map(decks.map((d) => [d.id, d]));

    for (const ch of deckChanges) {
      const incoming = ch.record as DeckRecord;
      const existing = byId.get(ch.id);
      if (existing && toTime(existing.updatedAt) >= toTime(ch.ts)) continue;

      if (ch.op === "delete") {
        const deletedAt = incoming.deletedAt ?? ch.ts;
        byId.set(ch.id, {
          ...incoming,
          deletedAt,
          updatedAt: ch.ts,
          dirty: false,
          lastSyncedAt: now,
        });
        continue;
      }

      byId.set(ch.id, {
        ...incoming,
        deletedAt: undefined,
        dirty: false,
        lastSyncedAt: now,
      });
    }

    await setDecks(scope, Array.from(byId.values()));
  }

  if (cardChanges.length) {
    const byDeckId = new Map<string, Change[]>();
    for (const ch of cardChanges) {
      const incoming = ch.record as CardRecord;
      if (!incoming.deckId) continue;
      if (!byDeckId.has(incoming.deckId)) byDeckId.set(incoming.deckId, []);
      byDeckId.get(incoming.deckId)!.push(ch);
    }

    for (const [deckId, deckCardChanges] of byDeckId.entries()) {
      const cards = await getCardsAll(scope, deckId);
      const byId = new Map(cards.map((c) => [c.id, c]));

      for (const ch of deckCardChanges) {
        const incoming = ch.record as CardRecord;
        const existing = byId.get(ch.id);
        if (existing && toTime(existing.updatedAt) >= toTime(ch.ts)) continue;

        if (ch.op === "delete") {
          const deletedAt = incoming.deletedAt ?? ch.ts;
          byId.set(ch.id, {
            ...incoming,
            deletedAt,
            updatedAt: ch.ts,
            dirty: false,
            lastSyncedAt: now,
          });
          continue;
        }

        byId.set(ch.id, {
          ...incoming,
          deletedAt: undefined,
          dirty: false,
          lastSyncedAt: now,
        });
      }

      await setCards(scope, deckId, Array.from(byId.values()));
    }
  }

  if (sessionChanges.length) {
    const sessions = await getSessions(scope);
    const byId = new Map(sessions.map((s) => [s.id, s]));

    for (const ch of sessionChanges) {
      const incoming = ch.record as SessionRecord;
      const existing = byId.get(ch.id);
      if (existing && toTime(existing.updatedAt) >= toTime(ch.ts)) continue;

      if (ch.op === "delete") {
        const deletedAt = incoming.deletedAt ?? ch.ts;
        byId.set(ch.id, {
          ...incoming,
          deletedAt,
          updatedAt: ch.ts,
          dirty: false,
          lastSyncedAt: now,
        });
        continue;
      }

      byId.set(ch.id, {
        ...incoming,
        deletedAt: undefined,
        dirty: false,
        lastSyncedAt: now,
      });
    }

    await setSessions(scope, Array.from(byId.values()));
  }
}

async function collectDirty(scope: WorkspaceScope): Promise<Change[]> {
  const changes: Change[] = [];

  const decks = await getDecksAll(scope);
  for (const deck of decks) {
    if (!deck.dirty) continue;
    changes.push({
      id: deck.id,
      entity: "deck",
      op: deck.deletedAt ? "delete" : "upsert",
      record: deck,
      ts: deck.updatedAt,
    });
  }

  for (const deck of decks) {
    const cards = await getCardsAll(scope, deck.id);
    for (const card of cards) {
      if (!card.dirty) continue;
      changes.push({
        id: card.id,
        entity: "card",
        op: card.deletedAt ? "delete" : "upsert",
        record: card,
        ts: card.updatedAt,
      });
    }
  }

  const sessions = await getSessions(scope);
  for (const session of sessions) {
    if (!session.dirty) continue;
    changes.push({
      id: session.id,
      entity: "session",
      op: session.deletedAt ? "delete" : "upsert",
      record: session,
      ts: session.updatedAt,
    });
  }

  return changes;
}

async function markClean(
  scope: WorkspaceScope,
  entity: EntityType,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  const idSet = new Set(ids);

  if (entity === "deck") {
    const decks = await getDecksAll(scope);
    const updated = decks.map((deck) =>
      idSet.has(deck.id) ? { ...deck, dirty: false, lastSyncedAt: now } : deck
    );
    await setDecks(scope, updated);
    return;
  }

  if (entity === "card") {
    const decks = await getDecksAll(scope);
    for (const deck of decks) {
      const cards = await getCardsAll(scope, deck.id);
      const updated = cards.map((card) =>
        idSet.has(card.id) ? { ...card, dirty: false, lastSyncedAt: now } : card
      );
      await setCards(scope, deck.id, updated);
    }
    return;
  }

  // entity === "session"
  const sessions = await getSessions(scope);
  const updated = sessions.map((session) =>
    idSet.has(session.id) ? { ...session, dirty: false, lastSyncedAt: now } : session
  );
  await setSessions(scope, updated);
}

async function runSync(): Promise<void> {
  // Captured once for the entire run — nothing below re-derives the active workspace or
  // access token mid-flight, so a sign-out/sign-in that happens while a network call is in
  // flight cannot redirect this run's push/pull onto a different account.
  const scope = await AuthService.getActiveScope();

  if (scope.kind === "guest") {
    // No cloud identity to sync with — this is normal offline-first usage, not an error. Reset
    // rather than leave a previous account's status/pending-count visible under the guest view.
    resetSyncState();
    return;
  }

  const accessToken = await AuthService.getAccessToken();
  if (!accessToken) {
    // Signed in, but no usable access token right now. AuthService.getAccessToken() already
    // swallows network hiccups and Cognito 5xx failures internally (returning null rather than
    // throwing) — by the time we see null here it's most often one of those, so treat it the
    // same way the product spec treats connectivity failures. If NetInfo already told us we're
    // offline, say so plainly; otherwise this is unusual enough to flag as needing attention
    // rather than silently doing nothing.
    if (!getSyncState().isOnline) {
      markSyncOffline();
    } else {
      markSyncNeedsAttention("NoAccessToken");
    }
    return;
  }

  const deviceId = await getDeviceId();

  // 1) PUSH
  const outgoing = await collectDirty(scope);
  setPendingDirtyCount(outgoing.length);
  markSyncStarted();

  let acceptedCount = 0;
  let hasRejectedRecords = false;
  if (outgoing.length > 0) {
    const pushJson = await pushChanges(accessToken, { deviceId, changes: outgoing });
    const accepted = Array.isArray(pushJson.accepted) ? pushJson.accepted : [];
    const rejected = Array.isArray(pushJson.rejected) ? pushJson.rejected : [];
    acceptedCount = accepted.length;
    hasRejectedRecords = rejected.length > 0;

    if (accepted.length > 0) {
      const acceptedSet = new Set(accepted);

      const deckIds = outgoing
        .filter((c) => c.entity === "deck" && acceptedSet.has(c.id))
        .map((c) => c.id);

      const cardIds = outgoing
        .filter((c) => c.entity === "card" && acceptedSet.has(c.id))
        .map((c) => c.id);

      const sessionIds = outgoing
        .filter((c) => c.entity === "session" && acceptedSet.has(c.id))
        .map((c) => c.id);

      await markClean(scope, "deck", deckIds);
      await markClean(scope, "card", cardIds);
      await markClean(scope, "session", sessionIds);
    }
  }

  // 2) PULL
  const cursor = await getSyncCursor(scope);
  const pullJson = await pullChanges(accessToken, { deviceId, cursor });

  // 3) Abort safely if the active workspace changed while push/pull were in flight — never
  // apply another account's (or guest's) pulled changes into this scope's local storage. This
  // run's outcome no longer belongs to the now-inactive scope, so it deliberately leaves
  // sync state untouched rather than reporting success/failure for a workspace nothing is
  // looking at anymore — the newly active scope triggers (and owns) its own sync attempt (see
  // app/_layout.tsx's onWorkspaceChanged handler).
  const scopeAfterNetwork = await AuthService.getActiveScope();
  if (!sameScope(scopeAfterNetwork, scope)) {
    console.warn("[sync] aborting apply: active workspace changed mid-sync");
    return;
  }

  // 4) APPLY + persist cursor
  await applyChanges(scope, pullJson.changes ?? []);
  if (pullJson.cursor) await setSyncCursor(scope, pullJson.cursor);

  // Rejected/not-yet-accepted outgoing changes are still dirty; anything pulled and applied is
  // always written back with dirty:false (see applyChanges above), so this arithmetic reflects
  // the true remaining count without a second full storage scan.
  setPendingDirtyCount(Math.max(0, outgoing.length - acceptedCount));

  // A non-empty PushResponse.rejected means the server explicitly refused some records — this
  // must never read as "Synced". Rejected records were never added to markClean's id lists
  // above, so they're already left dirty and will be retried on the next ordinary sync trigger
  // (there is no automatic retry loop here — only real events: app launch, workspace change,
  // reconnect, or a manual retry — so this cannot spiral into a retry storm). Only a fixed,
  // sanitized diagnostic code is recorded — never which records, why, or any response content.
  if (hasRejectedRecords) {
    markSyncNeedsAttention("push-records-rejected");
  } else {
    markSyncSucceeded();
  }
  emitSyncComplete();
}

let inFlightSync: Promise<void> | null = null;

export const SyncService = {
  async syncOnce(): Promise<void> {
    if (inFlightSync) return inFlightSync;
    inFlightSync = runSync()
      .catch((err) => {
        // Classify once, centrally, regardless of which step (push, pull, or something
        // unexpected) actually threw. isSyncNetworkError/isOnline both point at "couldn't reach
        // the server" — expected/normal, ordinary offline usage, never a user-actionable
        // failure. Anything else (server rejection, unexpected throw) is "needsAttention".
        const isNetworkRelated = isSyncNetworkError(err) || !getSyncState().isOnline;
        // A fixed diagnostic code, never the raw Error object — its message/stack could
        // theoretically embed response or request detail we don't want in logs, and a code is
        // already sufficient to debug from (see getSyncDiagnosticCode). Only genuinely
        // actionable failures use console.error — that's what surfaces React Native's
        // error-level LogBox notification, which must never appear for ordinary connectivity
        // loss (see markSyncOffline below); a quiet console.log is enough there for debugging.
        if (isNetworkRelated) {
          markSyncOffline();
          console.log("[sync] offline:", getSyncDiagnosticCode(err));
        } else {
          markSyncNeedsAttention(getSyncDiagnosticCode(err));
          console.error("SYNC FAILED:", getSyncDiagnosticCode(err));
        }
        throw err;
      })
      .finally(() => {
        inFlightSync = null;
      });
    return inFlightSync;
  },

  // Exposes the same dirty-scan collectDirty() already performs internally, so UI-facing sync
  // state can report "pending changes" without a second, duplicate implementation of the
  // dirty-scanning logic. Callers (see useSyncState.ts) are expected to call this only on
  // demand (workspace switch, opening the Sync Status screen) — never from a render loop.
  async getPendingDirtyCount(scope: WorkspaceScope): Promise<number> {
    return (await collectDirty(scope)).length;
  },
};
