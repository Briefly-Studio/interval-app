export type Difficulty = "easy" | "medium" | "hard";

export type Card = {
  id: string;
  deckId: string;
  front: string;
  back: string;
  difficulty: Difficulty;
  createdAt: number;
};

export type CardRecord = Card & {
  rev: number;
  updatedAt: string;
  deletedAt?: string;
  dirty?: boolean;
  lastSyncedAt?: string;
  // Set only by deleteDeckById's cascade (never by deleteCard, the individual-delete path) —
  // distinguishes "tombstoned because the parent deck was deleted" from "the user deleted this
  // one card on its own", so restoring a deck can bring back the former without resurrecting
  // the latter. Deliberately not timestamp-based: two deletes can land in the same millisecond,
  // which would make an exact deletedAt match an unreliable signal.
  deletedByDeckCascade?: boolean;
};

export function upgradeCard(c: any): CardRecord {
  if (c && typeof c.rev === "number" && typeof c.updatedAt === "string") {
    return { ...c, dirty: c.dirty ?? false };
  }

  const updatedAt = new Date().toISOString();

  return {
    id: typeof c?.id === "string" ? c.id : "",
    deckId: typeof c?.deckId === "string" ? c.deckId : "",
    front: typeof c?.front === "string" ? c.front : "",
    back: typeof c?.back === "string" ? c.back : "",
    difficulty:
      c?.difficulty === "easy" || c?.difficulty === "medium" || c?.difficulty === "hard"
        ? c.difficulty
        : "medium",
    createdAt: typeof c?.createdAt === "number" ? c.createdAt : Date.now(),
    rev: 0,
    updatedAt,
    dirty: false,
  };
}
