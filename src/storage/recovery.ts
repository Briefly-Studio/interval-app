import type { CardRecord } from "../models/card";
import type { DeckRecord } from "../models/deck";
import { makeId } from "../models/deck";
import { addDeck, getDeckByIdAny, getDecksAll } from "./decks";
import type { WorkspaceScope } from "./workspaceScope";

export type CardRestoreTargetKind = "activeDeck" | "deletedDeck" | "missingDeck" | "corrupted";

// Discriminated on `kind` so callers get real type narrowing: `deck` is only present (and
// non-null) for the two kinds where a deck was actually found.
export type CardRestoreTarget =
  | { kind: "activeDeck"; deck: DeckRecord }
  | { kind: "deletedDeck"; deck: DeckRecord }
  | { kind: "missingDeck" }
  | { kind: "corrupted" };

/**
 * Decides where an individually-deleted card's restore action should land, without mutating
 * anything — the UI layer is responsible for turning this into a confirmation flow.
 *
 * Note on scope: a card's deckId belonging to a DIFFERENT workspace is architecturally
 * indistinguishable from "missing" here — `scope` already fully determines which decks
 * `getDecksAll` can see, so a foreign deckId simply never turns up. There is no separate
 * "otherWorkspace" case to detect; it collapses into "missingDeck" by construction.
 */
export async function resolveCardRestoreTarget(
  scope: WorkspaceScope,
  card: CardRecord
): Promise<CardRestoreTarget> {
  if (!card.deckId || typeof card.deckId !== "string" || !card.deckId.trim()) {
    return { kind: "corrupted" };
  }

  const deck = await getDeckByIdAny(scope, card.deckId);
  if (!deck) {
    return { kind: "missingDeck" };
  }
  if (deck.deletedAt) {
    return { kind: "deletedDeck", deck };
  }
  return { kind: "activeDeck", deck };
}

const RECOVERY_DECK_TITLE = "Recovered Cards";

/**
 * Finds the existing active recovery deck for this scope, or creates exactly one. Must only be
 * called after explicit user confirmation (never eagerly/speculatively) — see
 * app/recently-deleted.tsx's missingDeck restore flow.
 */
export async function getOrCreateRecoveryDeck(scope: WorkspaceScope): Promise<DeckRecord> {
  const decks = await getDecksAll(scope);
  const existing = decks.find((d) => d.isRecoveryDeck && !d.deletedAt);
  if (existing) return existing;

  const now = new Date().toISOString();
  const newDeck: DeckRecord = {
    id: makeId(),
    title: RECOVERY_DECK_TITLE,
    createdAt: now,
    updatedAt: now,
    rev: 0,
    dirty: true,
    isRecoveryDeck: true,
  };
  const updated = await addDeck(scope, newDeck);
  const created = updated.find((d) => d.id === newDeck.id);
  return created ?? newDeck;
}
