import type { GenerateDeckSession } from "./generateDeckSession";

// Privacy-safe RUNTIME quality telemetry for one generation attempt's review outcome — distinct
// from the offline evaluation harness (src/domain/ai/evaluation/**): this file only ever
// describes what actually happened during a REAL user/founder session, never a fixture. See
// docs/ai-evaluation.md's "Runtime telemetry" section for the full design and the reasoning this
// file's own narrow shape follows.
//
// Hard rule, enforced by construction rather than merely by convention: `emitGenerationReviewOutcome`
// rebuilds its log payload field-by-field from `GenerationReviewOutcome`'s own five fields —
// never `...outcome`, never `JSON.stringify(outcome)` on a caller-supplied object — so a future
// caller that accidentally widens the object literal it builds (e.g. tacks on a stray `cardText`
// field while refactoring) can never leak it through this function. No source text, card
// front/back, filenames, prompts, or auth tokens are ever representable here — the type itself
// has no slot for any of them.
//
// No telemetry backend exists anywhere in this repository and none is created here (see
// CLAUDE.md's "Hard out of scope" for this batch) — this is a dev-only, category-level console
// log (same `typeof __DEV__` guard convention multiBatchGeneration.ts's own logAggregateOutcome
// already uses, for the same reason: this function is exercised directly by plain `node --test`,
// where no bundler ever defines the global) plus the typed domain contract a future real
// telemetry pipeline could consume without this file changing shape.

export type GenerationReviewOutcome = {
  /** Correlates this outcome back to the generation attempt that produced the reviewed draft —
   * see generationAttemptId.ts. Opaque, random, carries no source/account information. */
  attemptId: string;
  /** The count generation itself produced, before any review-screen edits/deletes — mirrors
   * GenerateDeckSession.generatedCardCount, never recomputed from the post-edit card list. */
  generatedCount: number;
  /** How many distinct cards were edited at least once before save/abandon (see
   * generateDeckSession.ts's updateDraftCard) — a count, never the edited content itself. */
  editedCount: number;
  /** How many cards were deleted before save/abandon (generateDeckSession.ts's deleteDraftCard). */
  deletedCount: number;
  /** How many cards actually ended up persisted — 0 when `abandoned` is true. */
  savedCount: number;
  /** True when the draft was discarded/navigated away from instead of saved. */
  abandoned: boolean;
  /** Which SourceGenerationScope kind this generation used (sourceGenerationScope.ts) — a
   * category string like "automatic" or "structureNode", never a nodeId, page/section number,
   * or any other value derived from this source's own content. */
  scopeType: GenerateDeckSession["scopeType"];
  /** Only present when `scopeType === "structureNode"` — "heading" or "worksheet", never the
   * selected node's own id or title (see GenerateDeckSession.structureNodeType). */
  structureNodeType?: GenerateDeckSession["structureNodeType"];
};

export function emitGenerationReviewOutcome(outcome: GenerationReviewOutcome): void {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  console.log("[ai-review-outcome]", {
    attemptId: outcome.attemptId,
    generatedCount: outcome.generatedCount,
    editedCount: outcome.editedCount,
    deletedCount: outcome.deletedCount,
    savedCount: outcome.savedCount,
    abandoned: outcome.abandoned,
    scopeType: outcome.scopeType,
    structureNodeType: outcome.structureNodeType,
  });
}
