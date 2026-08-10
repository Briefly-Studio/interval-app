import type { DeckRecord } from "../models/deck";

// Canonical, deterministic deck ordering — see docs/deck-ordering.md for the full rationale.
// Pure, side-effect-free, no storage/network access — the same input records always produce the
// same order on every device, regardless of AsyncStorage insertion order or the order records
// happened to arrive in from a sync pull.

function timeValue(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Same accent/case-folding technique as src/domain/libraryOrganize.ts's foldForSearch — NFD
// decomposition + strip combining marks + lowercase — duplicated locally (2 lines) rather than
// imported, since deck ordering and Library search are unrelated features that shouldn't share a
// cross-domain dependency for a utility this small.
function normalizedTitle(title: string): string {
  return title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// Deliberately NOT localeCompare(): its collation behavior can vary by JS engine/ICU
// availability (Hermes on iOS vs. Android vs. web), which risks two devices disagreeing on tie
// order for the exact same records — the one thing this comparator must never allow. Plain
// UTF-16 code-unit comparison on the normalized string is slower to read as "alphabetical" but is
// byte-identical on every engine.
function compareNormalizedTitle(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Canonical deck comparator: most-recently-updated first, with deterministic tie-breakers so
 * every device with the same deck records produces the same order.
 *
 * 1. updatedAt descending (most recently updated first)
 * 2. normalized (accent/case-insensitive) title ascending
 * 3. id ascending
 *
 * Assumes callers have already excluded tombstoned (deletedAt) records — this function only
 * orders whatever array it's given, matching src/domain/libraryOrganize.ts's sort/filter split.
 */
export function compareDecksCanonical(a: DeckRecord, b: DeckRecord): number {
  const timeDiff = timeValue(b.updatedAt) - timeValue(a.updatedAt);
  if (timeDiff !== 0) return timeDiff;

  const titleDiff = compareNormalizedTitle(normalizedTitle(a.title), normalizedTitle(b.title));
  if (titleDiff !== 0) return titleDiff;

  return compareNormalizedTitle(a.id, b.id);
}

/** Returns a new, canonically-ordered array — never mutates the input array. */
export function sortDecksCanonical(decks: DeckRecord[]): DeckRecord[] {
  return [...decks].sort(compareDecksCanonical);
}
