import AsyncStorage from "@react-native-async-storage/async-storage";

import type { GeneratedCardProvenance } from "../models/generatedCardProvenance";
import { upgradeGeneratedCardProvenance } from "../models/generatedCardProvenance";
import { generatedCardProvenanceKey } from "./generatedCardProvenanceKeys";
import type { WorkspaceScope } from "./workspaceScope";

// Local-only storage for GeneratedCardProvenance — see src/models/generatedCardProvenance.ts for
// why this is a separate store rather than a CardRecord field. Deliberately never imported by
// src/cloud/sync/** — entries here must never be pushed/pulled, and src/cloud/sync/types.ts's
// EntityType union intentionally has no member for this.
//
// One array per scope, same shape convention as src/storage/deckCollections.ts — generation
// volume per account is bounded (a handful of saved decks' worth of cards, not every card ever
// reviewed), so a single list is simplest and avoids a second per-card storage key.

export async function getGeneratedCardProvenance(scope: WorkspaceScope): Promise<GeneratedCardProvenance[]> {
  try {
    const raw = await AsyncStorage.getItem(generatedCardProvenanceKey(scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => upgradeGeneratedCardProvenance(item)).filter((item): item is GeneratedCardProvenance => item !== null);
  } catch {
    return [];
  }
}

export async function setGeneratedCardProvenance(scope: WorkspaceScope, entries: GeneratedCardProvenance[]): Promise<void> {
  await AsyncStorage.setItem(generatedCardProvenanceKey(scope), JSON.stringify(entries));
}

/** Appends new provenance entries (e.g. right after a Generate Study Deck save). Best-effort by
 * design — a caller that can't persist this must not fail or roll back the deck/card save that
 * already succeeded; losing a provenance entry only means those cards won't count toward Source
 * Coverage, never a corrupted deck/card. Replaces any existing entry for the same cardId rather
 * than duplicating it (a card can only ever have been generated once). */
export async function recordGeneratedCardProvenance(scope: WorkspaceScope, newEntries: GeneratedCardProvenance[]): Promise<void> {
  if (newEntries.length === 0) return;
  const existing = await getGeneratedCardProvenance(scope);
  const newCardIds = new Set(newEntries.map((entry) => entry.cardId));
  const kept = existing.filter((entry) => !newCardIds.has(entry.cardId));
  await setGeneratedCardProvenance(scope, [...kept, ...newEntries]);
}

/** Every provenance entry currently on record for a given source, regardless of whether the
 * card/deck it points at is still live — liveness is resolved separately (against current
 * CardRecord state) by the coverage domain layer, never assumed here. */
export async function getProvenanceForSource(scope: WorkspaceScope, sourceId: string): Promise<GeneratedCardProvenance[]> {
  const all = await getGeneratedCardProvenance(scope);
  return all.filter((entry) => entry.sourceId === sourceId);
}
