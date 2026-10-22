import AsyncStorage from "@react-native-async-storage/async-storage";

import type { ReviewEvent } from "../domain/scheduling/types";
import type { ReviewEventRecord } from "../models/reviewEvent";
import { upgradeReviewEventRecord } from "../models/reviewEvent";
import { reviewEventsKeyForDeck } from "./keys";
import type { WorkspaceScope } from "./workspaceScope";

// Append-only, mirroring sessions.ts's own shape (prepend-on-add, no update-by-id function at
// all — there is no `updateReviewEvent`, deliberately: see
// src/domain/scheduling/reviewEvent.ts's header comment). Per-deck keyed, like cards.ts/
// cardScheduling.ts. A card's (or even a whole deck's) review history is NEVER deleted by
// anything in this batch, including deck cascade-delete — see `deleteCardSchedulingForDeck` in
// cardScheduling.ts for the contrasting, deliberate choice there, and
// docs/spaced-repetition-foundation.md's "Storage" section for the full reasoning: review events
// are historical fact about what the user actually did, independent of whether the card/deck
// they were reviewing still exists.

export async function getReviewEventsForDeck(scope: WorkspaceScope, deckId: string): Promise<ReviewEventRecord[]> {
  if (!deckId) return [];
  try {
    const raw = await AsyncStorage.getItem(reviewEventsKeyForDeck(scope, deckId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const upgraded = parsed.map(upgradeReviewEventRecord).filter((r): r is ReviewEventRecord => r !== null);
    try {
      await setReviewEventsForDeck(scope, deckId, upgraded);
    } catch {
      // ignore
    }
    return upgraded;
  } catch {
    return [];
  }
}

export async function setReviewEventsForDeck(scope: WorkspaceScope, deckId: string, events: ReviewEventRecord[]): Promise<void> {
  if (!deckId) return;
  await AsyncStorage.setItem(reviewEventsKeyForDeck(scope, deckId), JSON.stringify(events));
}

/** The one write path for review history — always prepends, never updates or removes an existing
 * event. Takes the pure domain `ReviewEvent` — `rev`/`updatedAt`/`dirty` are this function's own
 * concern, never the caller's; `rev` is always 1 (an event is written exactly once, never
 * revised). Idempotent against a genuine exact-duplicate id (same cardId/reviewedAt/rating — see
 * computeReviewEventId) by skipping the append rather than storing a second copy, so a caller
 * that accidentally calls this twice for the exact same review never duplicates history. */
export async function addReviewEvent(scope: WorkspaceScope, deckId: string, event: ReviewEvent): Promise<void> {
  const existing = await getReviewEventsForDeck(scope, deckId);
  if (existing.some((e) => e.id === event.id)) return;
  const record: ReviewEventRecord = { ...event, rev: 1, updatedAt: event.reviewedAt, dirty: true };
  await setReviewEventsForDeck(scope, deckId, [record, ...existing]);
}

/** Used ONLY by the dev-only full local wipe (devReset.ts) — never by normal deck/card
 * deletion, which deliberately leaves review history untouched (see this file's header
 * comment). A hard removal, same shape as cardScheduling.ts's deleteCardSchedulingForDeck. */
export async function deleteReviewEventsForDeck(scope: WorkspaceScope, deckId: string): Promise<void> {
  if (!deckId) return;
  try {
    await AsyncStorage.removeItem(reviewEventsKeyForDeck(scope, deckId));
  } catch {
    // ignore
  }
}
