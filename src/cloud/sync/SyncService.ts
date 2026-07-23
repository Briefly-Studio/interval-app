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
import { pullChanges, pushChanges } from "./http";
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
    // TEMP DEBUG
    console.log("[sync] decks written:", Array.from(byId.values()).length);
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
    console.log("[sync] skipped: guest workspace has no cloud identity to sync with");
    return;
  }

  const accessToken = await AuthService.getAccessToken();
  if (!accessToken) {
    console.log("[sync] skipped: no access token available for", scope.sub.slice(0, 8) + "…");
    return;
  }

  console.log("[sync] start", scope.sub.slice(0, 8) + "…");
  const deviceId = await getDeviceId();

  // 1) PUSH
  const outgoing = await collectDirty(scope);
  console.log("[sync] outgoing dirty:", outgoing.length);

  if (outgoing.length > 0) {
    const pushJson = await pushChanges(accessToken, { deviceId, changes: outgoing });
    const accepted = Array.isArray(pushJson.accepted) ? pushJson.accepted : [];
    console.log("[sync] push accepted:", accepted.length);

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
  console.log("[sync] cursor before pull:", cursor ?? "none");

  const pullJson = await pullChanges(accessToken, { deviceId, cursor });
  console.log("[sync] pulled changes:", pullJson.changes?.length ?? 0);
  console.log("[sync] new cursor:", pullJson.cursor);

  // 3) Abort safely if the active workspace changed while push/pull were in flight — never
  // apply another account's (or guest's) pulled changes into this scope's local storage.
  const scopeAfterNetwork = await AuthService.getActiveScope();
  if (!sameScope(scopeAfterNetwork, scope)) {
    console.warn("[sync] aborting apply: active workspace changed mid-sync");
    return;
  }

  // 4) APPLY + persist cursor
  await applyChanges(scope, pullJson.changes ?? []);
  if (pullJson.cursor) await setSyncCursor(scope, pullJson.cursor);
  emitSyncComplete();

  console.log("SYNC OK");
}

let inFlightSync: Promise<void> | null = null;

export const SyncService = {
  async syncOnce(): Promise<void> {
    if (inFlightSync) return inFlightSync;
    inFlightSync = runSync()
      .catch((err) => {
        console.error("SYNC FAILED", err);
        throw err;
      })
      .finally(() => {
        inFlightSync = null;
      });
    return inFlightSync;
  },
};
