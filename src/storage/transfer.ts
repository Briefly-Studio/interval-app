import { AuthService } from "../auth/AuthService";
import { type CardRecord, upgradeCard } from "../models/card";
import { type DeckRecord, upgradeDeck } from "../models/deck";
import { buildExportPayload, validatePayload } from "../domain/deckTransfer";
import { getCards, setCards } from "./cards";
import { getDeckById, addDeck } from "./decks";
import { getSessionsForDeck } from "./sessions";

export async function exportDeckToJson(deckId: string): Promise<string> {
  const scope = await AuthService.getActiveScope();
  const deck = await getDeckById(scope, deckId);
  if (!deck) {
    throw new Error("Deck not found");
  }

  const cards = await getCards(scope, deckId);
  const sessions = await getSessionsForDeck(scope, deckId);

  const payload = buildExportPayload(deck, cards);
  return JSON.stringify({ ...payload, sessions }, null, 2);
}

export async function importDeckFromJson(raw: string): Promise<{ newDeckId: string }> {
  const scope = await AuthService.getActiveScope();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid export data");
  }

  if (!validatePayload(parsed)) {
    throw new Error("Invalid export data");
  }

  const payload = parsed;
  const newDeckId = String(Date.now());

  const nowIso = new Date().toISOString();
  const deck: DeckRecord = {
    ...upgradeDeck({
      id: newDeckId,
      title: payload.deck.title,
      createdAt: nowIso,
    }),
    rev: 1,
    updatedAt: nowIso,
    dirty: true,
  };

  await addDeck(scope, deck);

  const timestamp = Date.now();
  const newCards: CardRecord[] = payload.cards.map((card, index) => ({
    ...upgradeCard({
      id: `${timestamp}_${index}`,
      deckId: newDeckId,
      front: card.front,
      back: card.back,
      createdAt: card.createdAt,
      difficulty: card.difficulty ?? "medium",
    }),
    rev: 1,
    updatedAt: nowIso,
    dirty: true,
  }));

  await setCards(scope, newDeckId, newCards);

  return { newDeckId };
}
