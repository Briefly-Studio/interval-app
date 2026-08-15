import * as FileSystem from "expo-file-system/legacy";

import { AuthService } from "../auth/AuthService";
import type { TranslateFn } from "../i18n/translateFn";
import { type CardRecord, upgradeCard } from "../models/card";
import { type DeckRecord, makeId, upgradeDeck } from "../models/deck";
import { setCards } from "../storage/cards";
import { addDeck, getDecks } from "../storage/decks";
import { validatePayload } from "./deckTransfer";

export async function handleIncomingFile(uri: string, t: TranslateFn): Promise<string> {
  // Captured once at the start of this operation — the whole import is written into
  // whichever workspace was active when the file was opened.
  const scope = await AuthService.getActiveScope();

  let raw: string;
  try {
    raw = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.UTF8,
    });
  } catch {
    throw new Error(t("importDeck.errors.fileReadFailed"));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(t("importDeck.errors.invalidDeckFile"));
  }

  if (!validatePayload(parsed)) {
    throw new Error(t("importDeck.errors.invalidDeckFile"));
  }

  const payload = parsed;
  const existing = await getDecks(scope);
  const baseTitle = payload.deck.title;
  const titleTaken = existing.some((deck) => deck.title === baseTitle);
  const title = titleTaken ? `${baseTitle} ${t("importDeck.importedTitleSuffix")}` : baseTitle;
  const finalTitle =
    existing.some((deck) => deck.title === title) ? `${title} ${Date.now()}` : title;

  const newDeckId = makeId();
  const nowIso = new Date().toISOString();
  const newDeck: DeckRecord = {
    ...upgradeDeck({
      id: newDeckId,
      title: finalTitle,
      createdAt: nowIso,
    }),
    rev: 1,
    updatedAt: nowIso,
    dirty: true,
  };

  await addDeck(scope, newDeck);

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

  return newDeckId;
}
