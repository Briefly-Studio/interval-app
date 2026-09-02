import { MAX_BACK_LENGTH, MAX_FRONT_LENGTH } from "./responseValidation";
import type { DraftProvenanceEntry } from "./generateDeckSession";

// Pure helpers for the draft review / edit-card screens: field validation (reusing the exact
// length ceilings responseValidation.ts enforces on generated output, so a user edit can never
// push a card past what a generated card is allowed to be) and provenance-label formatting.

export { MAX_BACK_LENGTH, MAX_FRONT_LENGTH };

export type DraftCardFieldError = "empty" | "too-long" | null;

export function validateDraftCardFront(value: string): DraftCardFieldError {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "empty";
  if (trimmed.length > MAX_FRONT_LENGTH) return "too-long";
  return null;
}

export function validateDraftCardBack(value: string): DraftCardFieldError {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "empty";
  if (trimmed.length > MAX_BACK_LENGTH) return "too-long";
  return null;
}

export function isDraftCardValid(front: string, back: string): boolean {
  return validateDraftCardFront(front) === null && validateDraftCardBack(back) === null;
}

export type ProvenanceRange = { start: number; end: number };

export type ProvenanceLabel =
  | { kind: "none" }
  /** One or more line ranges, sorted and with only truly adjacent/overlapping ranges merged.
   * Discontiguous ranges (e.g. lines 10–15 and 40–45) are kept SEPARATE — never collapsed into a
   * fake continuous span (audit MEDIUM-1). A single line renders as start === end. */
  | { kind: "lines"; ranges: ProvenanceRange[] }
  /** One or more distinct page numbers, sorted and de-duplicated. Future page-aware adapters
   * populate this; nothing in this batch does. */
  | { kind: "pages"; pages: number[] };

/**
 * Merges a list of line ranges: sorts by start, then joins two ranges only when they overlap or
 * are directly adjacent (`next.start <= current.end + 1`). Separated ranges stay separated.
 * Pure and deterministic.
 */
export function mergeLineRanges(ranges: ProvenanceRange[]): ProvenanceRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges]
    .map((r) => ({ start: Math.min(r.start, r.end), end: Math.max(r.start, r.end) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: ProvenanceRange[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end + 1) {
      last.end = Math.max(last.end, cur.end);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

/**
 * Resolves the honest provenance citation for a card from the chunks it cites. Never fabricates
 * continuity: multiple discontiguous source sections are reported as multiple ranges, not one
 * span. Returns `{ kind: "none" }` when no cited chunk carries real location data, which the UI
 * renders by omitting the citation.
 */
export function resolveProvenanceLabel(
  sourceChunkIds: string[],
  provenanceByChunkId: Record<string, DraftProvenanceEntry>
): ProvenanceLabel {
  const entries = sourceChunkIds
    .map((id) => provenanceByChunkId[id])
    .filter((entry): entry is DraftProvenanceEntry => !!entry);

  if (entries.length === 0) return { kind: "none" };

  const lineRanges = entries
    .map((entry) => entry.lineRange)
    .filter((range): range is { start: number; end: number } => !!range);

  if (lineRanges.length > 0) {
    return { kind: "lines", ranges: mergeLineRanges(lineRanges) };
  }

  const pages = Array.from(
    new Set(entries.map((entry) => entry.page).filter((page): page is number => typeof page === "number"))
  ).sort((a, b) => a - b);
  if (pages.length > 0) return { kind: "pages", pages };

  return { kind: "none" };
}
