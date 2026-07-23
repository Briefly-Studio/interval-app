import type { WorkspaceScope } from "./workspaceScope";
import { scopedKey } from "./workspaceScope";

export const DECKS_KEY = "briefly.decks.v1";
export const CARDS_PREFIX = "briefly.cards.v1";
export const SESSIONS_KEY = "briefly.sessions.v1";
export const CURSOR_KEY = "sync.cursor";

export const decksKey = (scope: WorkspaceScope) => scopedKey(scope, DECKS_KEY);
export const sessionsKey = (scope: WorkspaceScope) => scopedKey(scope, SESSIONS_KEY);
export const cursorKey = (scope: WorkspaceScope) => scopedKey(scope, CURSOR_KEY);

export const cardsKeyForDeck = (scope: WorkspaceScope, deckId: string) =>
  `${scopedKey(scope, CARDS_PREFIX)}.${deckId}`;
