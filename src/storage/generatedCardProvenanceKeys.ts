import type { WorkspaceScope } from "./workspaceScope";
import { scopedKey } from "./workspaceScope";

// New Interval-prefixed key — same "genuinely new feature, no legacy briefly.* shape to
// preserve" reasoning as src/storage/libraryKeys.ts / src/storage/deckCollectionKeys.ts.
export const GENERATED_CARD_PROVENANCE_KEY = "interval.generatedCardProvenance.v1";

// Scoped through the same guest-vs-`user:<sub>` local partitioning decks/cards/Library/Deck
// Collections already use (see src/storage/workspaceScope.ts).
export const generatedCardProvenanceKey = (scope: WorkspaceScope) => scopedKey(scope, GENERATED_CARD_PROVENANCE_KEY);
