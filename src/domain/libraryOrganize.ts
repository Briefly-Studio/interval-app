import type { LibrarySourceRecord, SourceType } from "../models/librarySource";
import type { SourceCollectionRecord } from "../models/sourceCollection";

// Pure, side-effect-free helpers for Library search/sort/filter — deliberately separate from
// storage so screens can compose them freely (e.g. "PDF + Calculus + Recently used") against a
// single loaded array, per docs/library-and-source-architecture.md §2's "filters compose, not
// exclusive views" requirement. No duplicate per-view datasets are created — every view in
// app/library/index.tsx runs these functions against the same loaded source list.

export type SortOption = "recentlyUsed" | "recentlyAdded" | "alphabetical" | "newest" | "oldest";

function timeValue(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortLibrarySources(sources: LibrarySourceRecord[], sort: SortOption): LibrarySourceRecord[] {
  const copy = [...sources];
  switch (sort) {
    case "recentlyUsed":
      // Falls back to createdAt when lastUsedAt has never been set (no real usage signal exists
      // yet in this foundation — see src/storage/librarySources.ts#updateLibrarySource) so this
      // still produces a stable, sensible order rather than treating every never-used source as
      // tied at zero.
      return copy.sort((a, b) => (timeValue(a.lastUsedAt) || timeValue(a.createdAt)) < (timeValue(b.lastUsedAt) || timeValue(b.createdAt)) ? 1 : -1);
    case "recentlyAdded":
    case "newest":
      return copy.sort((a, b) => (timeValue(a.createdAt) < timeValue(b.createdAt) ? 1 : -1));
    case "oldest":
      return copy.sort((a, b) => (timeValue(a.createdAt) > timeValue(b.createdAt) ? 1 : -1));
    case "alphabetical":
      return copy.sort((a, b) => a.displayTitle.localeCompare(b.displayTitle));
  }
}

// ROOT LIBRARY ORGANIZATION RULE (see docs/library-and-source-architecture.md's "Root Library
// rule") — mirrors src/domain/deckCollectionMembership.ts's getUnfiledDecks precedent for the
// analogous Deck Collections feature. Unlike decks (whose membership lives on the collection's
// own deckIds, requiring a two-direction reconciliation), a Library source owns its own
// membership directly via collectionIds, so this is a simpler one-direction filter — but it still
// intersects against the CURRENTLY ACTIVE collection set rather than just checking
// `collectionIds.length === 0`, for the same defensive reason getAssignedDeckIds does: a stale
// collectionId should never be able to keep a source hidden from root once its collection is gone
// (in practice src/storage/sourceCollections.ts#softDeleteSourceCollection already reconciles
// this synchronously via unassignCollectionFromAllSources, so a source should never actually carry
// a dangling id — this is defense in depth, not a workaround for a known gap).
//
// Callers pass an ACTIVE source list only (see getActiveLibrarySources) — this function does not
// itself filter out archived/deleted sources, matching filterLibrarySources/searchLibrarySources'
// existing convention of operating on whatever list the caller already scoped.
export function getUnfiledLibrarySources(
  sources: LibrarySourceRecord[],
  activeCollections: SourceCollectionRecord[]
): LibrarySourceRecord[] {
  const activeCollectionIds = new Set(activeCollections.map((c) => c.id));
  return sources.filter((source) => !source.collectionIds.some((id) => activeCollectionIds.has(id)));
}

export type LibraryFilters = {
  sourceType?: SourceType;
  collectionId?: string;
  course?: string;
  semester?: string;
};

export function filterLibrarySources(sources: LibrarySourceRecord[], filters: LibraryFilters): LibrarySourceRecord[] {
  return sources.filter((source) => {
    if (filters.sourceType && source.sourceType !== filters.sourceType) return false;
    if (filters.collectionId && !source.collectionIds.includes(filters.collectionId)) return false;
    if (filters.course && source.course !== filters.course) return false;
    if (filters.semester && source.semester !== filters.semester) return false;
    return true;
  });
}

// Strips combining diacritical marks after Unicode NFD decomposition — plain ECMAScript String
// methods, not Intl (no ICU/locale-data dependency), so this is safe under Hermes. Without this,
// searching "calculo" would not match a source titled "Cálculo" (or vice versa) — a real gap for
// a Spanish-supported app, not a hypothetical one (caught by this batch's deterministic checks).
export function foldForSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// Searches display title, original filename, tags, course, and semester — per
// docs/library-and-source-architecture.md §2's metadata/filters list. Case-insensitive,
// accent-insensitive, whitespace-trimmed, substring match — no fuzzy matching or ranking, kept
// intentionally simple for a local metadata foundation.
export function searchLibrarySources(sources: LibrarySourceRecord[], query: string): LibrarySourceRecord[] {
  const needle = foldForSearch(query.trim());
  if (!needle) return sources;
  return sources.filter((source) => {
    const haystacks = [source.displayTitle, source.originalName, source.course, source.semester, ...source.tags];
    return haystacks.some((value) => typeof value === "string" && foldForSearch(value).includes(needle));
  });
}

// Distinct, non-empty values already present in a source list — used to populate course/semester
// filter options without hardcoding a list or requiring a separate lookup table.
export function distinctCourses(sources: LibrarySourceRecord[]): string[] {
  return Array.from(new Set(sources.map((s) => s.course).filter((v): v is string => !!v))).sort();
}

export function distinctSemesters(sources: LibrarySourceRecord[]): string[] {
  return Array.from(new Set(sources.map((s) => s.semester).filter((v): v is string => !!v))).sort();
}

// Searches collection name only — collections have no other searchable metadata today. Reuses
// foldForSearch (above) so collection search stays case-insensitive and accent-insensitive using
// the exact same normalization as source search, rather than a second implementation.
export function searchSourceCollections(
  collections: SourceCollectionRecord[],
  query: string
): SourceCollectionRecord[] {
  const needle = foldForSearch(query.trim());
  if (!needle) return collections;
  return collections.filter((collection) => foldForSearch(collection.name).includes(needle));
}
