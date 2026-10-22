import AsyncStorage from "@react-native-async-storage/async-storage";

import type { CardSchedulingState } from "../domain/scheduling/types";
import type { CardSchedulingRecord } from "../models/cardScheduling";
import { upgradeCardSchedulingRecord } from "../models/cardScheduling";
import { cardSchedulingKeyForDeck } from "./keys";
import type { WorkspaceScope } from "./workspaceScope";

// Mirrors src/storage/cards.ts's own shape exactly (same per-deck keying, same
// read-upgrades-and-writes-back self-healing pattern) — see
// docs/spaced-repetition-foundation.md's "Storage" section for why this is its own store rather
// than a field on CardRecord.

export async function getCardSchedulingAll(scope: WorkspaceScope, deckId: string): Promise<CardSchedulingRecord[]> {
  if (!deckId) return [];
  try {
    const raw = await AsyncStorage.getItem(cardSchedulingKeyForDeck(scope, deckId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const upgraded = parsed.map(upgradeCardSchedulingRecord).filter((r): r is CardSchedulingRecord => r !== null);
    try {
      await setCardSchedulingAll(scope, deckId, upgraded);
    } catch {
      // ignore
    }
    return upgraded;
  } catch {
    return [];
  }
}

/** Keyed by `cardId` → its scheduling record, for a single O(1) lookup during review instead of
 * every caller re-scanning the array. */
export async function getCardSchedulingMap(scope: WorkspaceScope, deckId: string): Promise<Record<string, CardSchedulingRecord>> {
  const all = await getCardSchedulingAll(scope, deckId);
  const map: Record<string, CardSchedulingRecord> = {};
  for (const record of all) map[record.cardId] = record;
  return map;
}

export async function setCardSchedulingAll(scope: WorkspaceScope, deckId: string, records: CardSchedulingRecord[]): Promise<void> {
  if (!deckId) return;
  await AsyncStorage.setItem(cardSchedulingKeyForDeck(scope, deckId), JSON.stringify(records));
}

/** Upserts one card's scheduling state — the single write path every review goes through (see
 * applyCardReview.ts's caller in the review screen). Takes the pure domain `CardSchedulingState`
 * — `rev`/`updatedAt`/`dirty` are this function's own concern, never the caller's, mirroring
 * cards.ts's own invariant: a real mutation never sets `dirty` without bumping `rev`. */
export async function upsertCardScheduling(scope: WorkspaceScope, deckId: string, state: CardSchedulingState): Promise<void> {
  const existing = await getCardSchedulingAll(scope, deckId);
  const now = new Date().toISOString();
  const index = existing.findIndex((r) => r.cardId === state.cardId);
  const nextRev = index === -1 ? 1 : existing[index].rev + 1;
  const upserted: CardSchedulingRecord = { ...state, rev: nextRev, updatedAt: now, dirty: true };
  const next = index === -1 ? [...existing, upserted] : existing.map((r, i) => (i === index ? upserted : r));
  await setCardSchedulingAll(scope, deckId, next);
}

/** Used when a deck is deleted (cascade delete its cards' scheduling state along with it) —
 * mirrors cards.ts's deleteCardsForDeck exactly: a hard removal of the whole per-deck key. */
export async function deleteCardSchedulingForDeck(scope: WorkspaceScope, deckId: string): Promise<void> {
  if (!deckId) return;
  try {
    await AsyncStorage.removeItem(cardSchedulingKeyForDeck(scope, deckId));
  } catch {
    // ignore
  }
}
