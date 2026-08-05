import type { Card } from "../models/card";
import type { Deck } from "../models/deck";

export type ExportPayload = {
  version: 1;
  deck: { title: string; createdAt: number };
  cards: {
    front: string;
    back: string;
    difficulty: "easy" | "medium" | "hard";
    createdAt: number;
  }[];
};

export function buildExportPayload(deck: Deck, cards: Card[]): ExportPayload {
  const createdAt = Date.parse(deck.createdAt);

  return {
    version: 1,
    deck: {
      title: deck.title,
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    },
    cards: cards.map((card) => ({
      front: card.front,
      back: card.back,
      difficulty: card.difficulty ?? "medium",
      createdAt: card.createdAt,
    })),
  };
}

export function validatePayload(data: unknown): data is ExportPayload {
  if (!data || typeof data !== "object") return false;

  const payload = data as {
    version?: unknown;
    deck?: { title?: unknown; createdAt?: unknown };
    cards?: {
      front?: unknown;
      back?: unknown;
      difficulty?: unknown;
      createdAt?: unknown;
    }[];
  };

  if (payload.version !== 1) return false;
  if (!payload.deck || typeof payload.deck.title !== "string") return false;
  if (typeof payload.deck.createdAt !== "number") return false;
  if (!Array.isArray(payload.cards)) return false;
  if (
    !payload.cards.every(
      (card) => typeof card.front === "string" && typeof card.back === "string"
    )
  ) {
    return false;
  }
  if (
    !payload.cards.every(
      (card) =>
        card.difficulty === undefined ||
        card.difficulty === "easy" ||
        card.difficulty === "medium" ||
        card.difficulty === "hard"
    )
  ) {
    return false;
  }
  if (!payload.cards.every((card) => typeof card.createdAt === "number")) return false;

  return true;
}
