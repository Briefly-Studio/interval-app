import type { WorkspaceScope } from "./workspaceScope";
import { scopedKey } from "./workspaceScope";

// New Interval-prefixed key — same "genuinely new feature, no legacy briefly.* shape to
// preserve" reasoning as src/storage/libraryKeys.ts. See CLAUDE.md's "Legacy Briefly
// identifiers" section for why decks/cards/sessions keep the old prefix; Deck Collections is a
// new, separate entity and does not need to.
export const DECK_COLLECTIONS_KEY = "interval.deckCollections.v1";

// Scoped through the same guest-vs-`user:<sub>` local partitioning decks/cards/sessions and
// Library metadata already use (see src/storage/workspaceScope.ts) — this is what keeps one
// signed-in account's local Deck Collections from blending with another's on sign-out/account
// switch, without needing any collection-specific isolation logic of its own.
export const deckCollectionsKey = (scope: WorkspaceScope) => scopedKey(scope, DECK_COLLECTIONS_KEY);
