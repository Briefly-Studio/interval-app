import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildDefaultReviewQueue,
  isDue,
  isFuture,
  isNew,
  isOverdue,
  orderByDueAt,
  selectDueCards,
  selectFutureCards,
  selectNewCards,
  selectOverdueCards,
} from "./dueSelection";
import { applyCardReview } from "./applyCardReview";
import { fsrsScheduler } from "./fsrsScheduler";
import type { CardSchedulingState } from "./types";
import type { SchedulableCard } from "./dueSelection";

const NOW = new Date("2026-01-10T12:00:00.000Z");

function makeState(overrides: Partial<CardSchedulingState>): CardSchedulingState {
  return {
    cardId: "card",
    state: "review",
    dueAt: NOW.toISOString(),
    scheduledDays: 1,
    elapsedDays: 1,
    reps: 1,
    lapses: 0,
    schedulerAlgorithm: "fsrs",
    schedulerVersion: "test",
    ...overrides,
  };
}

function entry(id: string, overrides: Partial<CardSchedulingState>): SchedulableCard<{ id: string }> {
  return { cardId: id, card: { id }, schedulingState: makeState({ cardId: id, ...overrides }) };
}

const newCard = entry("new-1", { state: "new", dueAt: NOW.toISOString(), stability: undefined });
const dueToday = entry("due-today", { state: "review", dueAt: "2026-01-10T06:00:00.000Z" });
const overdueBy3Days = entry("overdue-3", { state: "review", dueAt: "2026-01-07T06:00:00.000Z" });
const dueInTenMinutes = entry("learning-due-soon", { state: "learning", dueAt: "2026-01-10T11:50:00.000Z" });
const futureCard = entry("future-1", { state: "review", dueAt: "2026-01-20T00:00:00.000Z" });

const all = [newCard, dueToday, overdueBy3Days, dueInTenMinutes, futureCard];

test("isNew: only the 'new' state counts, regardless of dueAt", () => {
  assert.equal(isNew(newCard), true);
  assert.equal(isNew(dueToday), false);
});

test("isDue: due the moment dueAt <= now, excluding 'new' cards (they're their own bucket)", () => {
  assert.equal(isDue(dueToday, NOW), true);
  assert.equal(isDue(overdueBy3Days, NOW), true);
  assert.equal(isDue(dueInTenMinutes, NOW), true);
  assert.equal(isDue(futureCard, NOW), false);
  assert.equal(isDue(newCard, NOW), false);
});

test("isOverdue: only a due card whose due date falls on an earlier UTC calendar day than now", () => {
  assert.equal(isOverdue(overdueBy3Days, NOW), true);
  assert.equal(isOverdue(dueToday, NOW), false); // due today, not an earlier day
  assert.equal(isOverdue(dueInTenMinutes, NOW), false); // due later today, still not overdue
  assert.equal(isOverdue(futureCard, NOW), false);
  assert.equal(isOverdue(newCard, NOW), false);
});

test("isFuture: strictly after now, excluding 'new' cards", () => {
  assert.equal(isFuture(futureCard, NOW), true);
  assert.equal(isFuture(dueToday, NOW), false);
  assert.equal(isFuture(newCard, NOW), false);
});

test("selectDueCards / selectOverdueCards / selectNewCards / selectFutureCards partition the fixture set correctly", () => {
  assert.deepEqual(selectDueCards(all, NOW).map((e) => e.cardId).sort(), ["due-today", "learning-due-soon", "overdue-3"]);
  assert.deepEqual(selectOverdueCards(all, NOW).map((e) => e.cardId), ["overdue-3"]);
  assert.deepEqual(selectNewCards(all).map((e) => e.cardId), ["new-1"]);
  assert.deepEqual(selectFutureCards(all, NOW).map((e) => e.cardId), ["future-1"]);
});

test("orderByDueAt: ascending, most-overdue/earliest-due first", () => {
  const ordered = orderByDueAt([dueToday, overdueBy3Days, dueInTenMinutes]);
  assert.deepEqual(ordered.map((e) => e.cardId), ["overdue-3", "due-today", "learning-due-soon"]);
});

test("orderByDueAt does not mutate its input array", () => {
  const input = [dueToday, overdueBy3Days];
  const copy = [...input];
  orderByDueAt(input);
  assert.deepEqual(input, copy);
});

test("buildDefaultReviewQueue: due cards (overdue-first) come before new cards; future cards never appear", () => {
  const queue = buildDefaultReviewQueue(all, NOW);
  assert.deepEqual(queue.map((e) => e.cardId), ["overdue-3", "due-today", "learning-due-soon", "new-1"]);
});

test("buildDefaultReviewQueue: a newCardLimit caps only the new-card portion, never the due portion", () => {
  const manyNewCards = [newCard, entry("new-2", { state: "new", dueAt: NOW.toISOString() }), entry("new-3", { state: "new", dueAt: NOW.toISOString() })];
  const queue = buildDefaultReviewQueue([...all, ...manyNewCards.slice(1)], NOW, { newCardLimit: 1 });
  const newCardsInQueue = queue.filter((e) => e.schedulingState.state === "new");
  const dueCardsInQueue = queue.filter((e) => e.schedulingState.state !== "new");
  assert.equal(newCardsInQueue.length, 1);
  assert.equal(dueCardsInQueue.length, 3);
});

test("buildDefaultReviewQueue: zero due and zero new cards produces an empty queue, not an error", () => {
  assert.deepEqual(buildDefaultReviewQueue([futureCard], NOW), []);
  assert.deepEqual(buildDefaultReviewQueue([], NOW), []);
});

test("a deleted card is excluded by construction — the caller never includes it in the input array (storage-layer responsibility, not this module's)", () => {
  // dueSelection.ts has no concept of "deleted" at all — it only ever sees whatever the caller
  // passes in. This test documents that contract rather than exercising new behavior: a caller
  // that already filtered out deleted cards (as src/storage/cards.ts's getCards does) never
  // needs this module to re-check deletedAt.
  const queue = buildDefaultReviewQueue([], NOW);
  assert.deepEqual(queue, []);
});

// ---- Integration: a real applyCardReview outcome, fed back into dueSelection ----

test("a card rated 'Again' is NOT due immediately — it becomes due only once its own dueAt arrives", () => {
  const reviewedAt = NOW;
  const result = applyCardReview({ cardId: "card-x", deckId: "deck-1", schedulingState: undefined, rating: "again", reviewedAt, scheduler: fsrsScheduler });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;

  const entry = { cardId: "card-x", card: { id: "card-x" }, schedulingState: result.nextSchedulingState };
  // Right at the moment of rating, "Again" schedules a short learning step in the near future —
  // not immediately due again.
  assert.equal(isDue(entry, reviewedAt), false);
  assert.equal(isFuture(entry, reviewedAt), true);

  // Once the clock reaches (or passes) that card's own dueAt, it becomes due.
  const atDueTime = new Date(result.nextSchedulingState.dueAt);
  assert.equal(isDue(entry, atDueTime), true);
});

test("a card rated 'Easy' remains excluded from the due queue until its (multi-day) dueAt arrives", () => {
  const reviewedAt = NOW;
  const result = applyCardReview({ cardId: "card-y", deckId: "deck-1", schedulingState: undefined, rating: "easy", reviewedAt, scheduler: fsrsScheduler });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;

  const entry = { cardId: "card-y", card: { id: "card-y" }, schedulingState: result.nextSchedulingState };
  const oneHourLater = new Date(reviewedAt.getTime() + 60 * 60 * 1000);
  assert.equal(isDue(entry, oneHourLater), false);
  assert.deepEqual(buildDefaultReviewQueue([entry], oneHourLater), []);

  const atDueTime = new Date(result.nextSchedulingState.dueAt);
  assert.equal(isDue(entry, atDueTime), true);
  assert.deepEqual(
    buildDefaultReviewQueue([entry], atDueTime).map((e) => e.cardId),
    ["card-y"]
  );
});

test("'Study Due Cards' (newCardLimit: 0) excludes brand-new cards entirely, even when due cards exist", () => {
  const reviewed = applyCardReview({ cardId: "due-card", deckId: "deck-1", schedulingState: undefined, rating: "again", reviewedAt: NOW, scheduler: fsrsScheduler });
  assert.equal(reviewed.status, "ok");
  if (reviewed.status !== "ok") return;

  const dueEntry = { cardId: "due-card", card: { id: "due-card" }, schedulingState: reviewed.nextSchedulingState };
  const newEntry = { cardId: "new-card", card: { id: "new-card" }, schedulingState: fsrsScheduler.createNewCardState("new-card", NOW) };
  const atDueTime = new Date(reviewed.nextSchedulingState.dueAt);

  const dueOnlyQueue = buildDefaultReviewQueue([dueEntry, newEntry], atDueTime, { newCardLimit: 0 });
  assert.deepEqual(dueOnlyQueue.map((e) => e.cardId), ["due-card"]);
});

test("'Study Due Cards' with zero due cards (only new cards exist) produces an empty queue — the caller shows 'caught up', never an empty review session", () => {
  const newEntry = { cardId: "new-card", card: { id: "new-card" }, schedulingState: fsrsScheduler.createNewCardState("new-card", NOW) };
  assert.deepEqual(buildDefaultReviewQueue([newEntry], NOW, { newCardLimit: 0 }), []);
});
