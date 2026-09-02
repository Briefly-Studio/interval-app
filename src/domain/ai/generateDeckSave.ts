import { type CardRecord, type Difficulty, upgradeCard } from "../../models/card";
import { type DeckRecord, makeId, upgradeDeck } from "../../models/deck";
import { deleteCardsForDeck, setCards } from "../../storage/cards";
import { addDeck, getDecksAll, setDecks } from "../../storage/decks";
import type { WorkspaceScope } from "../../storage/workspaceScope";
import { validateDraftCardBack, validateDraftCardFront } from "./draftCardEditing";
import type { GenerateDeckSession } from "./generateDeckSession";
import type { DifficultyOption } from "./types";

// Turns an accepted draft session into a real Interval deck + cards using the existing storage
// layer (addDeck, then setCards with a fully-formed CardRecord[]), so a generated deck is
// indistinguishable from a hand-created one afterwards: same id conventions (makeId), same
// per-record rev/updatedAt/dirty/deletedAt shape that addCard/create-deck.tsx produce (rev 1,
// dirty true, no tombstone), same workspace scoping, same offline-first sync semantics. Nothing
// here writes a bespoke field or a new storage key, and no raw AsyncStorage key is touched
// directly — only the established decks.ts / cards.ts APIs. setCards (rather than N sequential
// addCard calls) is used only to avoid N AsyncStorage round-trips for an up-to-40-card deck — the
// records written are identical to what addCard would have produced.
//
// Source relationship: a DeckRecord has no field for an originating source, and CLAUDE.md
// explicitly forbids adding one (DeckRecord is on the live Production sync path). So this batch
// deliberately does NOT persist a deck→source or card→chunk link — provenance stays a
// review-time affordance only. See docs/generate-study-deck-ux.md's "Source relationship &
// provenance persistence" section for the future local-only link-store design.

const DIFFICULTY_BY_OPTION: Record<DifficultyOption, Difficulty> = {
  basic: "easy",
  balanced: "medium",
  advanced: "hard",
};

export type SaveDraftErrorCode =
  // A save is already running for this draft — the reentrant call was ignored (audit CRITICAL-2).
  | "in-progress"
  // Final revalidation of the in-memory draft failed (audit MEDIUM-3): empty title, zero cards,
  // an empty/overlong front or back, or a duplicate draft-card id. Nothing was written.
  | "invalid-draft"
  // The deck row was written but the card write failed; the deck was successfully rolled back
  // (audit HIGH-1). No partial persistent state remains — the draft is preserved for retry.
  | "card-write-failed"
  // The card write failed AND rolling the deck back also failed — a dirty orphan deck may remain.
  // Distinct code so the UI can tell the user to check their decks before retrying.
  | "rollback-failed"
  // The deck write itself failed — nothing was persisted, the draft is intact, retry is safe.
  | "deck-write-failed";

export type SaveDraftOutcome =
  | { status: "saved"; deckId: string; cardCount: number }
  | { status: "error"; code: SaveDraftErrorCode };

/**
 * Final, independent revalidation of a draft session immediately before persistence — the domain
 * boundary must not trust the review screen's own field validation as the only gate (audit
 * MEDIUM-3). Pure; returns `null` when the draft is safe to save.
 */
export function validateDraftForSave(session: Pick<GenerateDeckSession, "deckTitle" | "cards">): "invalid-draft" | null {
  if (session.deckTitle.trim().length === 0) return "invalid-draft";
  if (session.cards.length === 0) return "invalid-draft";

  const seenIds = new Set<string>();
  for (const card of session.cards) {
    if (!card.id || seenIds.has(card.id)) return "invalid-draft";
    seenIds.add(card.id);
    if (validateDraftCardFront(card.front) !== null) return "invalid-draft";
    if (validateDraftCardBack(card.back) !== null) return "invalid-draft";
  }
  return null;
}

// Synchronous, module-level in-flight guard. The review screen also has its own synchronous ref
// guard; this is the defensive domain-level backstop so two overlapping save attempts can never
// both reach addDeck() even if a caller forgets the screen guard.
let saveInFlight = false;

/**
 * Hard-removes a just-created deck (and any partially-written cards) after a failed card write.
 * Uses only decks.ts / cards.ts APIs. A hard removal (filter it out of the array) is correct
 * here — not a soft-delete tombstone — because this deck was created moments ago, has never been
 * pushed to sync, and must leave behind no tombstone/sync garbage. Returns false if the removal
 * itself failed.
 */
async function rollbackDeck(scope: WorkspaceScope, deckId: string): Promise<boolean> {
  try {
    const all = await getDecksAll(scope);
    await setDecks(
      scope,
      all.filter((deck) => deck.id !== deckId)
    );
    await deleteCardsForDeck(scope, deckId).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/**
 * Persists the draft as a real deck + cards under the supplied scope (which the caller must have
 * already confirmed matches `session.sourceScope` — audit CRITICAL-1). Non-throwing: every
 * failure mode is a typed `SaveDraftOutcome` error the review screen maps to friendly copy.
 */
export async function saveDraftDeck(scope: WorkspaceScope, session: GenerateDeckSession): Promise<SaveDraftOutcome> {
  if (saveInFlight) return { status: "error", code: "in-progress" };

  const validationError = validateDraftForSave(session);
  if (validationError) return { status: "error", code: validationError };

  saveInFlight = true;
  try {
    const title = session.deckTitle.trim();
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
      // Nothing persisted (addDeck reads then writes the decks array in one shot) — safe to retry.
      return { status: "error", code: "deck-write-failed" };
    }

    const difficulty = DIFFICULTY_BY_OPTION[session.options.difficulty] ?? "medium";
    const createdAtBase = Date.now();

    // Stored top-to-bottom in the order the user reviewed them.
    const cards: CardRecord[] = session.cards.map((draftCard, i) => {
      const createdAt = createdAtBase + i;
      return {
        ...upgradeCard({
          id: `${deckId}-${i}-${createdAt}`,
          deckId,
          front: draftCard.front.trim(),
          back: draftCard.back.trim(),
          createdAt,
          difficulty,
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
