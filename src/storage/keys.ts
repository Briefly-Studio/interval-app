import type { WorkspaceScope } from "./workspaceScope";
import { scopedKey } from "./workspaceScope";

export const DECKS_KEY = "briefly.decks.v1";
export const CARDS_PREFIX = "briefly.cards.v1";
export const SESSIONS_KEY = "briefly.sessions.v1";
export const CURSOR_KEY = "sync.cursor";
// "interval." (not "briefly.") is deliberate — these are new in the spaced-repetition
// scheduling foundation, with no legacy Briefly-era data to stay compatible with, so there is no
// reason to adopt the legacy prefix the way decks/cards/sessions must (see CLAUDE.md's "Legacy
// Briefly identifiers" section).
export const CARD_SCHEDULING_PREFIX = "interval.cardScheduling.v1";
export const REVIEW_EVENTS_PREFIX = "interval.reviewEvents.v1";

export const decksKey = (scope: WorkspaceScope) => scopedKey(scope, DECKS_KEY);
export const sessionsKey = (scope: WorkspaceScope) => scopedKey(scope, SESSIONS_KEY);
export const cursorKey = (scope: WorkspaceScope) => scopedKey(scope, CURSOR_KEY);

export const cardsKeyForDeck = (scope: WorkspaceScope, deckId: string) =>
  `${scopedKey(scope, CARDS_PREFIX)}.${deckId}`;

// Per-deck, mirroring cardsKeyForDeck exactly — scheduling state and review history are 1:1 with
// a deck's own cards, same partitioning rationale as cards themselves (see
// docs/spaced-repetition-foundation.md's "Storage" section).
export const cardSchedulingKeyForDeck = (scope: WorkspaceScope, deckId: string) =>
  `${scopedKey(scope, CARD_SCHEDULING_PREFIX)}.${deckId}`;
export const reviewEventsKeyForDeck = (scope: WorkspaceScope, deckId: string) =>
  `${scopedKey(scope, REVIEW_EVENTS_PREFIX)}.${deckId}`;
