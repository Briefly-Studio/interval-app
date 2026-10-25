import { type CardRecord, upgradeCard } from "../../models/card";
import { type DeckRecord, makeId, upgradeDeck } from "../../models/deck";
import { deleteCardsForDeck, setCards } from "../../storage/cards";
import { addDeck, getDecksAll, setDecks } from "../../storage/decks";
import type { WorkspaceScope } from "../../storage/workspaceScope";
import type { ImportedDeckDraft } from "./types";

// Turns an accepted import draft into a real Interval deck + cards, via the exact same
// addDeck/setCards contract generateDeckSave.ts uses for AI-generated decks — so an imported deck
// is indistinguishable from a hand-created one afterward: same id conventions, same rev/updatedAt/
// dirty shape, same workspace scoping, same offline-first sync semantics. Deliberately NOT a new
// "importedCard" type and NOT a source-origin field on DeckRecord/CardRecord — see CLAUDE.md's
// rule against adding fields to DeckRecord (the live sync path) and docs/flashcard-import.md's
// "Scheduling" section.
//
// SCHEDULING: nothing here ever creates a ReviewEvent or CardSchedulingState. A freshly imported
// card simply has no scheduling record yet, which `resolveCardSchedulingState`
// (src/domain/scheduling/migration.ts) already treats identically to a brand-new hand-created
// card — "New", immediately due, zero fabricated history. No scheduling-domain import is needed
// at all for this to be correct.

export type SaveImportErrorCode =
  | "in-progress"
  | "invalid-draft"
  | "card-write-failed"
  | "rollback-failed"
  | "deck-write-failed";

export type SaveImportOutcome =
  | { status: "saved"; deckId: string; cardCount: number }
  | { status: "error"; code: SaveImportErrorCode };

/** Final, independent revalidation immediately before persistence — mirrors
 * generateDeckSave.ts's validateDraftForSave. Pure; returns `null` when the draft is safe to
 * save. */
export function validateImportDraftForSave(draft: Pick<ImportedDeckDraft, "name" | "cards">): "invalid-draft" | null {
  if (draft.name.trim().length === 0) return "invalid-draft";
  if (draft.cards.length === 0) return "invalid-draft";
  for (const card of draft.cards) {
    if (card.front.trim().length === 0 || card.back.trim().length === 0) return "invalid-draft";
  }
  return null;
}

let saveInFlight = false;

async function rollbackDeck(scope: WorkspaceScope, deckId: string): Promise<boolean> {
  try {
    const all = await getDecksAll(scope);
    await setDecks(scope, all.filter((deck) => deck.id !== deckId));
    await deleteCardsForDeck(scope, deckId).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/**
 * Persists an accepted import draft as a real deck + cards under the supplied scope.
 * Non-throwing: every failure mode is a typed `SaveImportOutcome`.
 */
export async function saveImportedDeck(scope: WorkspaceScope, draft: ImportedDeckDraft): Promise<SaveImportOutcome> {
  if (saveInFlight) return { status: "error", code: "in-progress" };

  const validationError = validateImportDraftForSave(draft);
  if (validationError) return { status: "error", code: validationError };

  saveInFlight = true;
  try {
    const title = draft.name.trim();
    const now = new Date().toISOString();
    const deckId = makeId();

    const deck: DeckRecord = {
      ...upgradeDeck({ id: deckId, title, createdAt: now }),
      rev: 1,
      updatedAt: now,
      dirty: true,
    };
    try {
      await addDeck(scope, deck);
    } catch {
      return { status: "error", code: "deck-write-failed" };
    }

    const createdAtBase = Date.now();
    // Stored top-to-bottom in the order the file listed them.
    const cards: CardRecord[] = draft.cards.map((draftCard, i) => {
      const createdAt = createdAtBase + i;
      return {
        ...upgradeCard({
          id: makeId(),
          deckId,
          front: draftCard.front.trim(),
          back: draftCard.back.trim(),
          difficulty: draftCard.sourceDifficulty ?? "medium",
          createdAt,
        }),
        rev: 1,
        updatedAt: new Date(createdAt).toISOString(),
        dirty: true,
      };
    });

    try {
      await setCards(scope, deckId, cards);
    } catch {
      const rolledBack = await rollbackDeck(scope, deckId);
      return { status: "error", code: rolledBack ? "card-write-failed" : "rollback-failed" };
    }

    return { status: "saved", deckId, cardCount: cards.length };
  } finally {
    saveInFlight = false;
  }
}
