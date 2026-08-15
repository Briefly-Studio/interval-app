import { AuthService } from "../auth/AuthService";
import type { TranslateFn } from "../i18n/translateFn";
import { type CardRecord, type Difficulty, upgradeCard } from "../models/card";
import { type DeckRecord, makeId, upgradeDeck } from "../models/deck";
import { getCards, setCards } from "../storage/cards";
import { addDeck, getDeckById } from "../storage/decks";

type ExportCard = {
  front: string;
  back: string;
  difficulty: Difficulty;
  createdAt: number;
};

type ExportPayload = {
  version: 1;
  deck: { title: string; createdAt: string };
  cards: ExportCard[];
};

const DEFAULT_DIFFICULTY: Difficulty = "medium";

export async function exportDeckToJson(deckId: string): Promise<string> {
  if (!deckId) {
    throw new Error("Deck id is required.");
  }

  const scope = await AuthService.getActiveScope();
  const deck = await getDeckById(scope, deckId);
  if (!deck) {
    throw new Error("Deck not found.");
  }

  const cards = await getCards(scope, deckId);
  const payload: ExportPayload = {
    version: 1,
    deck: { title: deck.title, createdAt: deck.createdAt },
    cards: cards.map((card) => ({
      front: card.front,
      back: card.back,
      difficulty: card.difficulty ?? DEFAULT_DIFFICULTY,
      createdAt: card.createdAt,
    })),
  };

  return JSON.stringify(payload);
}

export async function importDeckFromJson(payload: string, t: TranslateFn): Promise<string> {
  const scope = await AuthService.getActiveScope();

  let data: unknown;
  try {
    data = JSON.parse(payload);
  } catch {
    throw new Error(t("importDeck.errors.invalidJson"));
  }

  if (!data || typeof data !== "object") {
    throw new Error(t("importDeck.errors.invalidPayload"));
  }

  const parsed = data as {
    version?: number;
    deck?: { title?: unknown; createdAt?: unknown };
    cards?: {
      front?: unknown;
      back?: unknown;
      difficulty?: unknown;
      createdAt?: unknown;
    }[];
  };

  if (parsed.version !== 1) {
    throw new Error(t("importDeck.errors.unsupportedVersion"));
  }

  const title = parsed.deck?.title;
  const createdAt = parsed.deck?.createdAt;
  if (
    typeof title !== "string" ||
    (typeof createdAt !== "string" && typeof createdAt !== "number")
  ) {
    throw new Error(t("importDeck.errors.invalidDeckMetadata"));
  }

  if (!Array.isArray(parsed.cards)) {
    throw new Error(t("importDeck.errors.invalidCardsList"));
  }

  const deckId = makeId();
  const createdAtIso =
    typeof createdAt === "number" ? new Date(createdAt).toISOString() : createdAt;
  const nowIso = new Date().toISOString();
  const newDeck: DeckRecord = {
    ...upgradeDeck({ id: deckId, title, createdAt: createdAtIso }),
    rev: 1,
    updatedAt: nowIso,
    dirty: true,
  };
  await addDeck(scope, newDeck);

  const newCards: CardRecord[] = parsed.cards.map((card) => {
    if (typeof card.front !== "string" || typeof card.back !== "string") {
      throw new Error(t("importDeck.errors.invalidCardData"));
    }

    const difficulty =
      card.difficulty === "easy" || card.difficulty === "medium" || card.difficulty === "hard"
        ? card.difficulty
        : DEFAULT_DIFFICULTY;

    const createdAtValue =
      typeof card.createdAt === "number" ? card.createdAt : Date.now();

    return {
      ...upgradeCard({
        id: makeId(),
        deckId,
        front: card.front,
        back: card.back,
        difficulty,
        createdAt: createdAtValue,
      }),
      rev: 1,
      updatedAt: nowIso,
      dirty: true,
    };
  });

  await setCards(scope, deckId, newCards);
  return deckId;
}
