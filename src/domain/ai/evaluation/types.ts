import type { SourceType } from "../../../models/librarySource";
import type { NormalizedSourceContent } from "../../normalization/types";
import type { CardCountOption, DifficultyOption, GenerationStatus, TokenUsage } from "../types";

// Shared types for the AI generation evaluation harness (docs/ai-evaluation.md). Two layers live
// under src/domain/ai/evaluation/ — a controlled, reproducible OFFLINE evaluation harness
// (fixtures.ts/matrix.ts/scoring.ts/runner.ts/report.ts, this file) — and are deliberately kept
// separate from RUNTIME quality telemetry (../generationTelemetry.ts), which describes real
// user/founder sessions, never a fixture. Do not conflate the two — see that doc's "Two
// concepts" section.

/** Only the real, text-bearing source types this harness can meaningfully evaluate — excludes
 * "image"/"audio"/"pptx" (no real text extraction exists for those; see
 * docs/ai-multiformat-generation.md). */
export type EvaluationSourceType = Extract<SourceType, "text" | "pdf" | "docx" | "xlsx">;

export type EvaluationScope = "bounded" | "wholeSource";

/**
 * One fixture — a small, repo-owned, auditable synthetic document plus the deterministic
 * expectations an evaluation run can score against. `buildNormalizedContent()` is a function
 * (not a pre-built object) so each fixture controls exactly how its content is produced; every
 * fixture in fixtures.ts calls the REAL normalization adapter for its format
 * (normalizeTextSource/normalizePdfTextSource/normalizeStructuredBlocks, or
 * buildSpreadsheetText+segmentText for XLSX — see that file's own header comment for why XLSX
 * has no "skip the ZIP" adapter entry point of its own) — never a hand-rolled fake
 * NormalizedSourceContent shape, so this harness genuinely exercises the same chunk ids/
 * provenance/contentKind every real source of that format would produce.
 */
export type EvaluationFixture = {
  id: string;
  sourceType: EvaluationSourceType;
  /** BCP-47-ish language tag — "en" for every fixture except the one deliberately non-English
   * fixture (see docs/ai-evaluation.md's "Multilingual foundation" section). */
  language: string;
  description: string;
  /** True when this fixture is DELIBERATELY too sparse/thin to reach ANY tier's target minimum —
   * scoring.ts treats "insufficient-distinct-content" as a PASS for such a fixture (a valid,
   * honest outcome), never a flagged regression. */
  designedForInsufficiency?: boolean;
  /** True when this fixture's total content exceeds one bounded generation context, so
   * matrix.ts's "wholeSource" scope case for it will genuinely require multiple batches — used
   * only to decide which fixtures a "wholeSource" case is meaningful for; harness.ts/runner.ts
   * do not themselves force batching. */
  designedForMultiBatch?: boolean;
  /** Concepts a correctly-functioning generation should surface in at least one card's
   * front+back text — deliberately checked by simple case-insensitive substring match, never
   * semantic/NLP matching (see scoring.ts's own doc comment for why). Omitted for a fixture not
   * designed for deterministic concept scoring (e.g. the deliberately sparse/ambiguous ones). */
  expectedConcepts?: string[];
  /** Minimum acceptable `expectedConceptCoverage` fraction for a regression check (report.ts) to
   * pass — defaults to 1 (full coverage expected) when `expectedConcepts` is set and this is
   * omitted. Only meaningful alongside `expectedConcepts`; ignored otherwise. */
  conceptCoverageThreshold?: number;
  /** Concepts that must NEVER appear in generated card text for this fixture — the one case
   * where `unsupportedClaimCount` (GenerationEvaluationResult) is deterministically checkable.
   * Omitted for every fixture that has no safely-checkable forbidden concept. */
  forbiddenConcepts?: string[];
  buildNormalizedContent(): NormalizedSourceContent;
};

export type EvaluationCase = {
  fixtureId: string;
  difficulty: DifficultyOption;
  tier: CardCountOption;
  scope: EvaluationScope;
};

/**
 * How this case's `generatedCount` relates to its tier's target-minimum/requested-maximum —
 * `deriveGenerationStatus`-style authoritative derivation at the EVALUATION level, never a
 * blind pass-through of the draft's own `generationStatus` (which this still cross-checks
 * against — see scoring.ts's `deriveCountCheckStatus`).
 */
export type CountCheckStatus =
  | "within-range"
  | "valid-insufficiency"
  | "exceeded-maximum"
  | "unexplained-under-target"
  | "insufficiency-despite-target-met";

/** Distinguishes "what kind of thing happened", for both evaluation (fixture-driven) and future
 * runtime use — see docs/ai-evaluation.md's "Failure taxonomy" section. "insufficient-content" is
 * descriptive, not necessarily a FAILURE — whether it should be treated as a regression depends
 * entirely on the fixture's own `designedForInsufficiency` flag (see report.ts). */
export type EvaluationOutcomeCategory =
  | "ready"
  | "provider-unavailable"
  | "rate-limited"
  | "daily-limit-reached"
  | "malformed-model-response"
  | "validation-failure"
  | "insufficient-content"
  | "multi-batch-partial-failure"
  | "canceled"
  | "harness-config-error";

export type GenerationEvaluationResult = {
  /** New provider executions reported by successful HTTP responses; absent when unknown. */
  providerExecutionCount?: number;
  fixtureId: string;
  sourceType: EvaluationSourceType;
  difficulty: DifficultyOption;
  tier: CardCountOption;
  scope: EvaluationScope;
  outcomeCategory: EvaluationOutcomeCategory;
  generatedCount: number;
  targetMinimum: number;
  requestedMaximum: number;
  countCheckStatus: CountCheckStatus;
  /** 1 when `countCheckStatus` is "within-range" or "valid-insufficiency", 0 otherwise — a plain
   * pass/fail signal for the regression gate, never a graded quality score (see report.ts's
   * REGRESSION_FAILURE_STATUSES for the exact FAIL set). */
  countScore: number;
  /** Fraction (0–1) of generated cards whose EVERY `sourceChunkIds` entry is a real id that was
   * actually in the selected/candidate chunk set for this case. Should always be 1 given
   * responseValidation.ts's own "unknown-chunk-id" rejection already guarantees this at the
   * draft level — this is a confirmatory invariant check, not a new guarantee. */
  groundingScore: number;
  /** True iff groundingScore === 1 AND every card has at least one sourceChunkId. */
  provenanceValidity: boolean;
  /** Fraction (0–1) of `fixture.expectedConcepts` matched by at least one card's front+back text
   * — undefined when the fixture defines no expected concepts (never fabricated/estimated). */
  expectedConceptCoverage?: number;
  /** Count of exact-duplicate (normalizeForDuplicateCheck-equal) card pairs found in the FINAL
   * card list — should always be 0 (validation/multi-batch dedupe already remove these before
   * this result is built); a non-zero value here is itself a regression signal. */
  exactDuplicateCount: number;
  /** Count of generated cards whose front+back text contains at least one of
   * `fixture.forbiddenConcepts` — undefined when the fixture defines none (never guessed). */
  unsupportedClaimCount?: number;
  latencyMs: number;
  tokenUsage?: TokenUsage;
  generationStatus?: GenerationStatus;
  /** Only present for `scope: "wholeSource"` cases that actually ran through multi-batch
   * generation (i.e. the fixture's candidate content needed more than one context budget). */
  batchInfo?: { plannedBatchCount: number; completedBatchCount: number };
  /** Present only when `outcomeCategory` is not "ready" — a short, generic, developer-facing
   * detail (never provider/source/card text). */
  errorDetail?: string;
};

export type MatrixSelection = {
  fixtureIds?: string[];
  difficulties?: DifficultyOption[];
  tiers?: CardCountOption[];
  scopes?: EvaluationScope[];
};
