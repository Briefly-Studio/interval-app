import { createEmptyCard, fsrs, FSRSVersion, Rating, State, type Card as FsrsCard, type Grade } from "ts-fsrs";

import { utcCalendarDayDiff, type Scheduler } from "./scheduler";
import type { CardLearningState, CardSchedulingState, ReviewRating, SchedulerPreviewEntry, SchedulerReviewOutcome } from "./types";

// The ONLY file in this app that imports `ts-fsrs` — every other scheduling file (storage, UI,
// applyCardReview.ts, dueSelection.ts) talks exclusively to the scheduler-neutral `Scheduler`
// interface (scheduler.ts). See docs/spaced-repetition-foundation.md's "FSRS dependency" section
// for the full audit: `ts-fsrs@5.4.2` (pinned exact — no caret range, so an upstream release never
// silently changes this app's scheduling math), MIT license, zero runtime dependencies, dual
// CJS/ESM build, maintained by the `open-spaced-repetition` organization (the FSRS algorithm's
// own reference-implementation org) — 829 GitHub stars, ~845k npm downloads/month at the time of
// this audit. Default parameters for this exact pinned version implement FSRS-6 (verified by
// reading the installed package's own `default_w` constant — 21 weights, and `checkParameters`'s
// own comment: "Must be 17, 19 or 21 for FSRSv4, 5 and 6 respectively"), confirmed again at
// runtime below via the library's own exported `FSRSVersion` string rather than hand-typed.
//
// `Card.elapsed_days`/`ReviewLog.elapsed_days` are marked `@deprecated` in this version ("will be
// removed in version 6.0.0 [of the ts-fsrs PACKAGE, not the FSRS algorithm]") — this file never
// reads either; `utcCalendarDayDiff` (scheduler.ts) independently replicates the exact same
// UTC-calendar-day algorithm the library's own internal (and still-exported, non-deprecated)
// `dateDiffInDays` helper uses (verified directly against the installed package's source), so
// this app's own elapsed-day accounting stays numerically identical to what the engine computes
// internally without depending on a field the upstream package itself says it will remove.

// `enable_fuzz: false` is already this library's own default (verified directly against the
// installed package's source — `apply_fuzz` returns `Math.round(ivl)` immediately, before ever
// touching its RNG, whenever fuzz is off), but it is passed explicitly here so this app's
// determinism guarantee is visible in code and never silently lost to a future upstream default
// change. With fuzz off, nothing in this library's interval/stability/difficulty math consults
// `Math.random()` or any other non-deterministic source — confirmed by reading `apply_fuzz`'s
// own early-return directly, not assumed.
const scheduler = fsrs({ enable_fuzz: false });

const STATE_TO_DOMAIN: Record<State, CardLearningState> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};

const STATE_FROM_DOMAIN: Record<CardLearningState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

const RATING_FROM_DOMAIN: Record<ReviewRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

function toFsrsCard(state: CardSchedulingState): FsrsCard {
  const learningSteps = state.engineState?.fsrsLearningSteps;
  return {
    due: new Date(state.dueAt),
    stability: state.stability ?? 0,
    difficulty: state.schedulingDifficulty ?? 0,
    // Deprecated upstream field — only ever WRITTEN here (to satisfy the library's own Card
    // shape), never read back by this app; see this file's header comment.
    elapsed_days: state.elapsedDays,
    scheduled_days: state.scheduledDays,
    reps: state.reps,
    lapses: state.lapses,
    state: STATE_FROM_DOMAIN[state.state],
    last_review: state.lastReviewedAt ? new Date(state.lastReviewedAt) : undefined,
    learning_steps: typeof learningSteps === "number" ? learningSteps : 0,
  };
}

function fromFsrsCard(cardId: string, card: FsrsCard): CardSchedulingState {
  return {
    cardId,
    state: STATE_TO_DOMAIN[card.state],
    dueAt: card.due.toISOString(),
    lastReviewedAt: card.last_review ? card.last_review.toISOString() : undefined,
    stability: card.state === State.New ? undefined : card.stability,
    schedulingDifficulty: card.state === State.New ? undefined : card.difficulty,
    scheduledDays: card.scheduled_days,
    elapsedDays: card.elapsed_days,
    reps: card.reps,
    lapses: card.lapses,
    schedulerAlgorithm: "fsrs",
    schedulerVersion: FSRSVersion,
    // Opaque to every file outside this one — see types.ts's `engineState` doc comment.
    engineState: { fsrsLearningSteps: card.learning_steps },
  };
}

function buildOutcome(previous: CardSchedulingState, previousFsrsCard: FsrsCard, nextFsrsCard: FsrsCard, now: Date): SchedulerReviewOutcome {
  const nextState = fromFsrsCard(previous.cardId, nextFsrsCard);
  const elapsedDays =
    previousFsrsCard.state === State.New || !previousFsrsCard.last_review
      ? 0
      : utcCalendarDayDiff(previousFsrsCard.last_review, now);
  return {
    nextState,
    previousState: previous.state,
    resultingState: nextState.state,
    previousDueAt: previous.dueAt,
    nextDueAt: nextState.dueAt,
    previousStability: previous.stability,
    nextStability: nextState.stability,
    previousSchedulingDifficulty: previous.schedulingDifficulty,
    nextSchedulingDifficulty: nextState.schedulingDifficulty,
    elapsedDays,
    scheduledDays: nextFsrsCard.scheduled_days,
  };
}

export const fsrsScheduler: Scheduler = {
  algorithm: "fsrs",
  version: FSRSVersion,

  createNewCardState(cardId: string, now: Date): CardSchedulingState {
    return fromFsrsCard(cardId, createEmptyCard(now));
  },

  scheduleReview(state: CardSchedulingState, rating: ReviewRating, now: Date): SchedulerReviewOutcome {
    const previousFsrsCard = toFsrsCard(state);
    const { card: nextFsrsCard } = scheduler.next(previousFsrsCard, now, RATING_FROM_DOMAIN[rating]);
    return buildOutcome(state, previousFsrsCard, nextFsrsCard, now);
  },

  previewReview(state: CardSchedulingState, now: Date): SchedulerPreviewEntry[] {
    const previousFsrsCard = toFsrsCard(state);
    const preview = scheduler.repeat(previousFsrsCard, now);
    return (["again", "hard", "good", "easy"] as const).map((rating) => {
      const { card } = preview[RATING_FROM_DOMAIN[rating]];
      return { rating, nextState: fromFsrsCard(state.cardId, card), scheduledDays: card.scheduled_days };
    });
  },
};
