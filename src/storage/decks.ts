import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DeckRecord } from "../models/deck";
import { upgradeDeck } from "../models/deck";
import { getCardsAll, setCards } from "./cards";
import { decksKey } from "./keys";
import { deleteSessionsForDeck } from "./sessions";
import type { WorkspaceScope } from "./workspaceScope";

export async function getDecksAll(scope: WorkspaceScope): Promise<DeckRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(decksKey(scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const upgraded = parsed.map((deck) => upgradeDeck(deck));
    try {
      await setDecks(scope, upgraded);
    } catch {
      // ignore
    }
    return upgraded;
  } catch {
    return [];
  }
}

export async function getDecks(scope: WorkspaceScope): Promise<DeckRecord[]> {
  const decks = await getDecksAll(scope);
  return decks.filter((deck) => !deck.deletedAt);
}

export async function setDecks(scope: WorkspaceScope, decks: DeckRecord[]) {
  await AsyncStorage.setItem(decksKey(scope), JSON.stringify(decks));
}

export async function addDeck(
  scope: WorkspaceScope,
  deck: DeckRecord
): Promise<DeckRecord[]> {
  const decks = await getDecksAll(scope);
  const now = new Date().toISOString();
  const updated = [
    { ...deck, updatedAt: now, dirty: true, deletedAt: undefined },
    ...decks,
  ];
  await setDecks(scope, updated);
  return updated;
}

export async function getDeckById(
  scope: WorkspaceScope,
  id: string
): Promise<DeckRecord | null> {
  const decks = await getDecks(scope);
  return decks.find((d) => d.id === id) ?? null;
}

// Unlike getDeckById (active-only, via getDecks), this resolves a deck id in ANY state —
// active or soft-deleted. Needed by card-restore flows, which must be able to tell "this
// card's parent deck still exists but is in the trash" apart from "this deck is gone entirely".
export async function getDeckByIdAny(
  scope: WorkspaceScope,
  id: string
): Promise<DeckRecord | null> {
  const decks = await getDecksAll(scope);
  return decks.find((d) => d.id === id) ?? null;
}

export async function deleteDeckById(
  scope: WorkspaceScope,
  id: string
): Promise<DeckRecord[]> {
  const decks = await getDecksAll(scope);
  const now = new Date().toISOString();
  const updated = decks.map((deck) => {
    if (deck.id !== id) return deck;
    if (deck.deletedAt) return deck;
    return {
      ...deck,
      deletedAt: now,
      updatedAt: now,
      rev: deck.rev + 1,
      dirty: true,
    };
  });
  await setDecks(scope, updated);

  const cards = await getCardsAll(scope, id);
  const updatedCards = cards.map((card) => {
    if (card.deletedAt) return card;
    return {
      ...card,
      deletedAt: now,
      updatedAt: now,
      rev: card.rev + 1,
      dirty: true,
      // Marks this tombstone as a side effect of the deck deletion, not an individual
      // deleteCard() call — see CardRecord.deletedByDeckCascade for why this can't just be
      // inferred from deletedAt matching the deck's own timestamp.
      deletedByDeckCascade: true,
    };
  });
  await setCards(scope, id, updatedCards);

  // 3) cascade delete sessions for this deck
  try {
    await deleteSessionsForDeck(scope, id);
  } catch {
    // ignore (best-effort)
  }

  return updated;
}

// Same invariant as updateAllCardsDifficulty in src/storage/cards.ts: only a deck whose title
// actually changes bumps `rev`/`updatedAt`/`dirty` — calling this with the deck's current title
// (a no-op save) must never manufacture a dirty write. Trimming/non-empty validation is the
// caller's responsibility (see app/deck/[id]/edit.tsx), matching how updateCard leaves its own
// callers responsible for field validation.
export async function renameDeck(
  scope: WorkspaceScope,
  deckId: string,
  title: string
): Promise<DeckRecord[]> {
  const decks = await getDecksAll(scope);
  const now = new Date().toISOString();
  const updated = decks.map((deck) => {
    if (deck.id !== deckId) return deck;
    if (deck.title === title) return deck;
    return {
      ...deck,
      title,
      updatedAt: now,
      rev: deck.rev + 1,
      dirty: true,
    };
  });
  await setDecks(scope, updated);
  return updated;
}
