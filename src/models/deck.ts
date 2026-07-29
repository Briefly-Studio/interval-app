
export type Deck = {
  id: string;
  title: string;
  createdAt: string; // ISO string
};

export type DeckRecord = Deck & {
  rev: number;
  updatedAt: string;
  deletedAt?: string;
  dirty?: boolean;
  lastSyncedAt?: string;
  // Marks the single auto-created "Recovered Cards" deck used as a landing spot when an
  // individually-deleted card's original deck no longer exists. Deliberately a stable marker
  // rather than matching on title: the user can rename this deck like any other, and a
  // user-created deck that happens to share the same title must never be mistaken for it (or
  // vice versa) — see getOrCreateRecoveryDeck in src/storage/recovery.ts.
  isRecoveryDeck?: boolean;
};

export function upgradeDeck(d: any): DeckRecord {
  if (d && typeof d.rev === "number" && typeof d.updatedAt === "string") {
    return { ...d, dirty: d.dirty ?? false };
  }

  const createdAt =
    typeof d?.createdAt === "string" && d.createdAt
      ? d.createdAt
      : new Date().toISOString();

  return {
    id: typeof d?.id === "string" ? d.id : "",
    title: typeof d?.title === "string" ? d.title : "",
    createdAt,
    rev: 0,
    updatedAt: createdAt,
    dirty: false,
  };
}

export function makeId() {
  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}
