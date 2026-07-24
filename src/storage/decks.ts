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
  // TEMP DEBUG
  console.log("[deleteDeck] cards before:", cards.length);
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
  // TEMP DEBUG
  console.log(
    "[deleteDeck] cards tombstoned:",
    updatedCards.filter((c) => c.deletedAt).length
  );
  await setCards(scope, id, updatedCards);

  // 3) cascade delete sessions for this deck
  try {
    await deleteSessionsForDeck(scope, id);
  } catch {
    // ignore (best-effort)
  }

  return updated;
}
