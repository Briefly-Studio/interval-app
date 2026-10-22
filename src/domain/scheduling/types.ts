// Spaced-repetition scheduling foundation — scheduler-neutral domain types. Nothing in this file
// (or anywhere in src/domain/scheduling/ outside fsrsScheduler.ts) imports or names an FSRS
// library type directly; the mapping to/from a specific engine's own shapes happens ONLY at
// fsrsScheduler.ts's narrow boundary (see scheduler.ts). This is deliberate: the algorithm may be
// replaced or upgraded later without this type set — or anything that consumes it (storage, UI,
// future sync) — having to change. See docs/spaced-repetition-foundation.md.
//
// NAMING: this file's `schedulingDifficulty` is the FSRS algorithm's own internal difficulty
// estimate (a continuous number, roughly 1-10) for how hard a card has been to recall over time —
// it is NEVER the same thing as `CardRecord.difficulty` (src/models/card.ts), the user-chosen,
// permanent "easy"/"medium"/"hard" CONTENT label that only drives smartShuffle ordering. The two
// deliberately live on different types with different shapes (string enum vs. number) so they can
// never be silently confused or accidentally overloaded onto the same field.

/** FSRS-standard card states. A card progresses new → learning → review, and can fall back to
 * relearning after a lapse ("Again") from review. */
export type CardLearningState = "new" | "learning" | "review" | "relearning";

/** The four review outcomes a user can report. Deliberately lowercase string literals, not magic
 * integers — any numeric rating an underlying algorithm needs is mapped at that algorithm's own
 * narrow boundary (fsrsScheduler.ts), never carried as a bare number anywhere else in the app.
 * "hard" here is a REVIEW OUTCOME ("how hard did recalling this feel just now") — a different
 * concept from CardRecord.difficulty's "hard" CONTENT label ("how hard is this card in general"),
 * despite the shared English word. Never conflate the two when reading/writing UI copy. */
export type ReviewRating = "again" | "hard" | "good" | "easy";

export const REVIEW_RATINGS: readonly ReviewRating[] = ["again", "hard", "good", "easy"];

export function isReviewRating(value: unknown): value is ReviewRating {
  return value === "again" || value === "hard" || value === "good" || value === "easy";
}

/**
 * The CURRENT, derived/operational scheduling state for one card — "what does the scheduler
 * currently believe about this card's memory." This is NOT historical fact (see `ReviewEvent`
 * below for that) — it is expected to be recomputed/overwritten by every review, and could in
 * principle be fully reconstructed by replaying a card's `ReviewEvent` history through the
 * scheduler again (not implemented in this batch, but the data shape deliberately supports it —
 * see docs/spaced-repetition-foundation.md's "Algorithm/version strategy" section).
 */
export type CardSchedulingState = {
  cardId: string;
  state: CardLearningState;
  /** ISO 8601 UTC — when this card is next eligible for review. For a never-reviewed card this is
   * the moment scheduling state was first created (immediately due), never a fabricated future or
   * past time. */
  dueAt: string;
  /** ISO 8601 UTC — undefined only for a card that has never been reviewed under this system. */
  lastReviewedAt?: string;
  /** FSRS "stability" (S) — estimated days until recall probability decays to the configured
   * desired-retention threshold. Undefined only for a card in the "new" state that has never been
   * scheduled at all. */
  stability?: number;
  /** FSRS "difficulty" (D) — the algorithm's own internal difficulty estimate, roughly 1-10.
   * Deliberately NOT named `difficulty` — see this file's header comment. Undefined only for a
   * never-scheduled "new" card. */
  schedulingDifficulty?: number;
  /** The interval, in days, chosen by the most recent scheduling decision. 0 for a card that has
   * never been scheduled. */
  scheduledDays: number;
  /** Real elapsed days between the previous review (or the card's first scheduling) and the
   * review that produced this state. 0 for a card that has never been reviewed. */
  elapsedDays: number;
  /** Total number of completed reviews (any rating) that advanced this card past "new"/learning
   * steps and into a real scheduling decision. */
  reps: number;
  /** Total number of "Again" ratings that caused a review → relearning transition (a genuine
   * lapse, not every "Again" — rating "Again" while still in "learning" does not count). */
  lapses: number;
  /** Which scheduling engine produced this state — e.g. "fsrs". Never silently reinterpreted by a
   * different engine without an explicit migration. */
  schedulerAlgorithm: string;
  /** The engine's own version/model string (e.g. "v5.4.2 using FSRS-6.0", read directly from the
   * library, never hand-typed) — see docs/spaced-repetition-foundation.md's "Algorithm/version
   * strategy" section for why this is preserved per-state rather than assumed. */
  schedulerVersion: string;
  /** Opaque, engine-owned bookkeeping this neutral type deliberately does not name or interpret
   * — e.g. FSRS's own short-term learning-step counter. Storage/UI persist and round-trip this
   * blob without reading it; only the matching `schedulerAlgorithm`'s own scheduler file
   * (fsrsScheduler.ts today) ever looks inside it. Naming a field like `learningSteps` directly
   * on this type would bake one engine's internal model into the "scheduler-neutral" contract —
   * exactly what this foundation exists to avoid (see this file's header comment). Absent for a
   * brand-new/never-scheduled state. */
  engineState?: Record<string, unknown>;
};

/**
 * What a review decision changed, in scheduler-neutral terms — the shape `applyCardReview`
 * (applyCardReview.ts) uses to build a durable `ReviewEvent`. Carries both the "before" and
 * "after" of every scheduling-relevant field so a `ReviewEvent` built from it can reconstruct or
 * reason about the change later without re-deriving it from two separate state snapshots.
 */
export type SchedulerReviewOutcome = {
  nextState: CardSchedulingState;
  previousState: CardLearningState;
  resultingState: CardLearningState;
  previousDueAt: string;
  nextDueAt: string;
  previousStability?: number;
  nextStability?: number;
  previousSchedulingDifficulty?: number;
  nextSchedulingDifficulty?: number;
  elapsedDays: number;
  scheduledDays: number;
};

/** One rating's previewed (not-yet-applied) outcome — used by the review UI to show "Good · in 3
 * days" style captions before the user commits to a rating. Never persisted. */
export type SchedulerPreviewEntry = {
  rating: ReviewRating;
  nextState: CardSchedulingState;
  scheduledDays: number;
};

/**
 * An immutable record of one real review — see docs/spaced-repetition-foundation.md's "Review
 * event model" section. REVIEW HISTORY IS DURABLE SOURCE OF TRUTH: a `ReviewEvent`, once created,
 * is never mutated or deleted by normal app behavior — see reviewEvent.ts.
 */
export type ReviewEvent = {
  id: string;
  cardId: string;
  deckId: string;
  sessionId?: string;
  /** ISO 8601 UTC — when the review actually happened. Always caller-supplied (never computed
   * with `Date.now()` inside pure scheduling logic — see applyCardReview.ts). */
  reviewedAt: string;
  rating: ReviewRating;
  previousState: CardLearningState;
  resultingState: CardLearningState;
  previousDueAt: string;
  nextDueAt: string;
  elapsedDays: number;
  scheduledDays: number;
  previousStability?: number;
  nextStability?: number;
  previousSchedulingDifficulty?: number;
  nextSchedulingDifficulty?: number;
  /** Milliseconds from this card becoming visible to the rating being submitted — only ever set
   * when genuinely, directly measured by the caller (the review screen); never estimated or
   * backfilled. Undefined when not available. */
  responseTimeMs?: number;
  schedulerAlgorithm: string;
  schedulerVersion: string;
};
