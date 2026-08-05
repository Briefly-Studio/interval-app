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
  markSyncSucceededWithWarnings,
  resetSyncState,
  setPendingDirtyCount,
} from "./syncState";
import { emitSyncComplete } from "./syncSignal";
import { validateChange, type RejectedChange } from "./validateChange";

const toTime = (value: string | undefined) => {
  const t = value ? Date.parse(value) : NaN;
  return Number.isFinite(t) ? t : 0;
};

const toRev = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

// A pull response's `cursor` is optional/empty-able in practice (see invariant #11 — the client
// only ever persists a non-empty value) but when present must be a string. Checked separately
// from, and before, per-record validation (partitionChanges/validateChange.ts) — an invalid
// cursor type calls the whole response envelope into question, not just one record, so it is
// treated as a hard pull failure rather than something to individually skip.
function isValidPullCursor(cursor: unknown): cursor is string | undefined {
  return cursor === undefined || cursor === null || typeof cursor === "string";
}

// The core conflict rule for every entity type: an incoming change is applied only if its
// revision is strictly newer, or (equal revision) its updatedAt is not older. A strictly lower
// incoming revision is never applied regardless of timestamp — this is what makes the model
// revision-based rather than wall-clock-based, and is what protects against client clock skew.
// See docs/sync-invariants.md for the full rationale. Deletes are not special-cased: a tombstone
// is just another mutation that bumped rev, so it naturally wins or loses on the same terms as
// any live edit.
function incomingWins(existing: { rev?: number; updatedAt: string } | undefined, incomingRev: number, incomingTs: string): boolean {
  if (!existing) return true;
  const existingRev = toRev(existing.rev);
  if (incomingRev !== existingRev) return incomingRev > existingRev;
  return toTime(incomingTs) >= toTime(existing.updatedAt);
}

// Validates every raw pulled item before any of it touches local storage. A malformed item is
// skipped (never applied, never written) rather than allowed to throw mid-batch — one corrupted
// record must never block every other valid record in the same page, and must never permanently
// stick the account's sync (see runSync: the cursor still advances past a page that contained
// only skipped items, exactly as it would if that page had been empty). The tradeoff this
// accepts: a skipped record's change is not reflected locally until/unless the server later
// resends it in valid form — sync availability is preserved at the cost of that one change.
function partitionChanges(rawChanges: unknown[]): { changes: Change[]; rejected: RejectedChange[] } {
  const changes: Change[] = [];
  const rejected: RejectedChange[] = [];

  for (const raw of rawChanges) {
    const result = validateChange(raw);
    if (result.ok) {
      changes.push(result.change);
    } else {
      rejected.push(result.rejected);
      // Concise, safe diagnostic only — entity type, change id, and a fixed reason string.
      // Never the record itself: no card front/back, no deck title, no tokens, no other
      // personal data ever reaches this log line.
      console.warn("[sync] skipping malformed pulled record:", result.rejected);
    }
  }

  return { changes, rejected };
}

async function applyChanges(scope: WorkspaceScope, rawChanges: unknown[]): Promise<RejectedChange[]> {
  if (rawChanges.length === 0) return [];

  const { changes, rejected } = partitionChanges(rawChanges);
  if (changes.length === 0) return rejected;

  const now = new Date().toISOString();
  // Sorting by ts first is still useful so that, within one page, multiple changes to the SAME
  // id are considered in a stable, deterministic order before incomingWins' rev comparison makes
  // the final call — it does not by itself decide which change wins.
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
      if (!incomingWins(existing, toRev(incoming.rev), ch.ts)) continue;

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
        if (!incomingWins(existing, toRev(incoming.rev), ch.ts)) continue;

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
      if (!incomingWins(existing, toRev(incoming.rev), ch.ts)) continue;

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

  return rejected;
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

// Keyed by id -> the exact rev that was included in the outgoing push payload for that record.
// A record only becomes clean if its CURRENT stored rev still matches — if the user edited it
// again (bumping rev) while this push was in flight, the stored rev has already moved past what
// was acknowledged, so it must stay dirty and be retried on the next sync. See invariants #9/#10
// in docs/sync-invariants.md.
type AcknowledgedRevs = Map<string, number>;

async function markClean(
  scope: WorkspaceScope,
  entity: EntityType,
  acknowledged: AcknowledgedRevs
): Promise<void> {
  if (acknowledged.size === 0) return;
  const now = new Date().toISOString();

  if (entity === "deck") {
    const decks = await getDecksAll(scope);
    const updated = decks.map((deck) => {
      const ackedRev = acknowledged.get(deck.id);
      if (ackedRev === undefined || toRev(deck.rev) !== ackedRev) return deck;
      return { ...deck, dirty: false, lastSyncedAt: now };
    });
    await setDecks(scope, updated);
    return;
  }

  if (entity === "card") {
    const decks = await getDecksAll(scope);
    for (const deck of decks) {
      const cards = await getCardsAll(scope, deck.id);
      const updated = cards.map((card) => {
        const ackedRev = acknowledged.get(card.id);
        if (ackedRev === undefined || toRev(card.rev) !== ackedRev) return card;
        return { ...card, dirty: false, lastSyncedAt: now };
      });
      await setCards(scope, deck.id, updated);
    }
    return;
  }

  // entity === "session"
  const sessions = await getSessions(scope);
  const updated = sessions.map((session) => {
    const ackedRev = acknowledged.get(session.id);
    if (ackedRev === undefined || toRev(session.rev) !== ackedRev) return session;
    return { ...session, dirty: false, lastSyncedAt: now };
  });
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

  let hasRejectedRecords = false;
  if (outgoing.length > 0) {
    const pushJson = await pushChanges(accessToken, { deviceId, changes: outgoing });

    // Revalidate identity before applying any part of the response — if the workspace changed
    // while the push request was in flight, this run's acknowledgment no longer belongs to the
    // now-inactive scope. The captured `scope` variable still points at the original workspace's
    // storage keys, so this is defense-in-depth (nothing would cross into the new workspace's
    // keys either way) rather than the primary protection, but it keeps push and pull handled
    // consistently and avoids doing pointless writes for a workspace nothing is looking at.
    const scopeAfterPush = await AuthService.getActiveScope();
    if (!sameScope(scopeAfterPush, scope)) {
      console.warn("[sync] aborting markClean: active workspace changed mid-push");
      return;
    }

    const accepted = Array.isArray(pushJson.accepted) ? pushJson.accepted : [];
    const rejected = Array.isArray(pushJson.rejected) ? pushJson.rejected : [];
    hasRejectedRecords = rejected.length > 0;

    if (accepted.length > 0) {
      const acceptedSet = new Set(accepted);

      const acknowledgedFor = (entity: EntityType): AcknowledgedRevs => {
        const revs: AcknowledgedRevs = new Map();
        for (const c of outgoing) {
          if (c.entity === entity && acceptedSet.has(c.id)) {
            revs.set(c.id, toRev((c.record as { rev?: number }).rev));
          }
        }
        return revs;
      };

      await markClean(scope, "deck", acknowledgedFor("deck"));
      await markClean(scope, "card", acknowledgedFor("card"));
      await markClean(scope, "session", acknowledgedFor("session"));
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

  // 4) Validate the response ENVELOPE before touching local storage or the cursor at all.
  // pullJson is only type-asserted, not validated, by http.ts's `as PullResponse` cast, so a
  // missing/non-array `changes` or a non-string `cursor` must be checked here explicitly. This is
  // a different, more severe case than one malformed record inside an otherwise-valid `changes`
  // array (see partitionChanges/validateChange.ts, which still applies every valid sibling and
  // only skips the bad one) — here the envelope itself can't be trusted, so nothing in this page
  // is applied, the cursor is never persisted (the previous cursor is left exactly as it was),
  // and this is reported as a real failure, never as an empty page and never as "Synced" or
  // "Synced, with warnings". Only a concise, fixed schema-error reason is logged — never any
  // field from pullJson itself, which is exactly the untrusted data in question.
  if (!Array.isArray(pullJson.changes) || !isValidPullCursor(pullJson.cursor)) {
    console.warn("[sync] malformed pull response envelope — rejecting this page");
    markSyncNeedsAttention("pull-response-malformed");
    return;
  }

  // 5) APPLY + persist cursor
  const rejectedPullRecords = await applyChanges(scope, pullJson.changes);
  // The cursor is persisted after applying only the valid subset of this page — this is exactly
  // what lets sync advance past a page containing a malformed record instead of re-fetching and
  // re-rejecting that same record on every future attempt (see validateChange.ts for the
  // reject-don't-coerce rationale). The valid changes in the same page are not held back waiting
  // for the invalid one to somehow become valid.
  if (pullJson.cursor) await setSyncCursor(scope, pullJson.cursor);

  // Recomputed by rescanning storage (same scan collectDirty always does) rather than derived
  // from push-response arithmetic — a rejected record can later be superseded by a newer pulled
  // change (applyChanges always writes dirty:false for anything it applies), which would make a
  // fixed "outgoing.length - acceptedCount" subtraction drift from what's actually still dirty.
  // See invariant #15 in docs/sync-invariants.md.
  setPendingDirtyCount((await collectDirty(scope)).length);

  // A non-empty PushResponse.rejected means the server explicitly refused some records — this
  // must never read as "Synced". Rejected records were never added to markClean's id lists
  // above, so they're already left dirty and will be retried on the next ordinary sync trigger
  // (there is no automatic retry loop here — only real events: app launch, workspace change,
  // reconnect, or a manual retry — so this cannot spiral into a retry storm). Only a fixed,
  // sanitized diagnostic code is recorded — never which records, why, or any response content.
  //
  // A push rejection takes priority over pull-side skipped records when both occur in the same
  // run: it means this device's own edits are still stuck dirty and need attention, which is a
  // more actionable problem than a handful of skipped remote records. When push is otherwise
  // clean but some pulled records were skipped as malformed, that is reported as a distinct,
  // calmer "synced with warnings" outcome rather than either silently claiming a full "Synced" or
  // escalating it to the same needsAttention state as an actual rejection.
  if (hasRejectedRecords) {
    markSyncNeedsAttention("push-records-rejected");
  } else if (rejectedPullRecords.length > 0) {
    markSyncSucceededWithWarnings(rejectedPullRecords.length);
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
