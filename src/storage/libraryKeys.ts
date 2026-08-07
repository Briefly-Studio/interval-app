import type { WorkspaceScope } from "./workspaceScope";
import { scopedKey } from "./workspaceScope";

// New Interval-prefixed keys — this is a genuinely new post-rebrand feature with no legacy
// `briefly.*` data to preserve, so no legacy-name/migration concern applies here (see
// CLAUDE.md's "Legacy Briefly identifiers" section for why decks/cards/sessions keep the old
// prefix; Library does not need to).
export const LIBRARY_SOURCES_KEY = "interval.librarySources.v1";
export const SOURCE_COLLECTIONS_KEY = "interval.sourceCollections.v1";

// Scoped through the same guest-vs-`user:<sub>` local partitioning decks/cards/sessions already
// use (see src/storage/workspaceScope.ts) — this is what keeps one signed-in account's local
// Library metadata from blending with another's on sign-out/account-switch, without needing any
// Library-specific isolation logic of its own.
export const librarySourcesKey = (scope: WorkspaceScope) => scopedKey(scope, LIBRARY_SOURCES_KEY);
export const sourceCollectionsKey = (scope: WorkspaceScope) => scopedKey(scope, SOURCE_COLLECTIONS_KEY);
