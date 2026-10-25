import type { Difficulty } from "../../models/card";

// Format-neutral import boundary — every format-specific parser (today: CSV/TSV; a future Anki
// parser would plug in here too, see docs/flashcard-import.md's "Anki support" section for why
// that one is blocked for now) produces ONE of these shapes. Nothing here touches storage —
// parsing and persistence are deliberately separate (see importDeckSave.ts for the only place
// that writes anything).

export type ImportedCardDraft = {
  front: string;
  back: string;
  /** Only ever set when the source format carries an explicit, trustworthy difficulty signal.
   * CSV/TSV never sets this today (there is no standard column for it) — reserved for a future
   * format that genuinely has one. Never fabricated. */
  sourceDifficulty?: Difficulty;
};

/**
 * Structured, user-safe warning — never a raw parser error, filesystem path, or stack trace (see
 * "Warnings" in the mission this was built from). `count` is present for every code that can
 * legitimately fire more than once per import.
 */
export type ImportWarningCode =
  | "header-row-skipped"
  | "rows-skipped-empty"
  | "rows-skipped-too-long"
  | "duplicates-found"
  | "cards-truncated-at-limit"
  | "rows-skipped-malformed";

export type ImportWarning = {
  code: ImportWarningCode;
  count?: number;
};

export type ImportedDeckDraft = {
  name: string;
  cards: ImportedCardDraft[];
  warnings: ImportWarning[];
  metadata?: {
    /** Where this draft came from — UI-facing only (e.g. "this looks like a CSV/TSV import" vs
     * a future Anki source), never persisted onto the resulting DeckRecord/CardRecord (see
     * CLAUDE.md: DeckRecord/CardRecord must never carry a source-origin field — same rule that
     * applies to Generate Study Deck). */
    sourceFormat: "csv" | "tsv";
    originalFileName?: string;
  };
};

/** A parse attempt that never produced an importable draft at all — distinct from a draft that
 * parsed successfully but contains zero usable cards (that case is still an `ImportedDeckDraft`
 * with an empty `cards` array plus explanatory warnings, so the preview screen can show exactly
 * what happened). */
export type ImportParseFailure = {
  code:
    | "empty-file"
    | "file-too-large"
    | "no-readable-rows"
    | "unreadable-encoding";
};

export type ImportParseResult =
  | { status: "ok"; draft: ImportedDeckDraft }
  | { status: "failed"; failure: ImportParseFailure };
