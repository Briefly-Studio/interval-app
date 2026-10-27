import assert from "node:assert/strict";
import test from "node:test";

import type { GeneratedCardDraft } from "../types";
import {
  computeExactDuplicateCount,
  computeExpectedConceptCoverage,
  computeGroundingScore,
  computeProvenanceValidity,
  computeUnsupportedClaimCount,
  countCheckPassed,
  deriveCountCheckStatus,
} from "./scoring";

function card(over: Partial<GeneratedCardDraft> = {}): GeneratedCardDraft {
  return { id: "card_1", front: "front", back: "back", sourceChunkIds: ["chunk_1"], ...over };
}

// ---- deriveCountCheckStatus ----

test("deriveCountCheckStatus: within-range when count meets target and status is complete", () => {
  const status = deriveCountCheckStatus({ generatedCount: 12, targetMinimum: 10, requestedMaximum: 15, generationStatusIsComplete: true });
  assert.equal(status, "within-range");
  assert.equal(countCheckPassed(status), true);
});

test("deriveCountCheckStatus: valid-insufficiency — below target, status honestly says incomplete", () => {
  const status = deriveCountCheckStatus({ generatedCount: 2, targetMinimum: 10, requestedMaximum: 15, generationStatusIsComplete: false });
  assert.equal(status, "valid-insufficiency");
  assert.equal(countCheckPassed(status), true);
});

test("deriveCountCheckStatus: exceeded-maximum takes priority over everything else", () => {
  const status = deriveCountCheckStatus({ generatedCount: 20, targetMinimum: 10, requestedMaximum: 15, generationStatusIsComplete: true });
  assert.equal(status, "exceeded-maximum");
  assert.equal(countCheckPassed(status), false);
});

test("deriveCountCheckStatus: unexplained-under-target — below target but self-reported complete (a real regression this is meant to catch)", () => {
  const status = deriveCountCheckStatus({ generatedCount: 7, targetMinimum: 10, requestedMaximum: 15, generationStatusIsComplete: true });
  assert.equal(status, "unexplained-under-target");
  assert.equal(countCheckPassed(status), false);
});

test("deriveCountCheckStatus: insufficiency-despite-target-met — met the target but self-reported incomplete (a regression this is meant to catch)", () => {
  const status = deriveCountCheckStatus({ generatedCount: 12, targetMinimum: 10, requestedMaximum: 15, generationStatusIsComplete: false });
  assert.equal(status, "insufficiency-despite-target-met");
  assert.equal(countCheckPassed(status), false);
});

test("deriveCountCheckStatus: below target, status not complete — ALWAYS accepted (valid-insufficiency), independent of any fixture-level 'designed for this' flag, since an honest shortfall is never itself a failure", () => {
  const status = deriveCountCheckStatus({ generatedCount: 3, targetMinimum: 10, requestedMaximum: 15, generationStatusIsComplete: false });
  assert.equal(status, "valid-insufficiency");
  assert.equal(countCheckPassed(status), true);
});

// ---- grounding / provenance ----

test("computeGroundingScore: 1 when every card's chunk ids are all allowed", () => {
  const allowed = new Set(["chunk_1", "chunk_2"]);
  const cards = [card({ sourceChunkIds: ["chunk_1"] }), card({ sourceChunkIds: ["chunk_2", "chunk_1"] })];
  assert.equal(computeGroundingScore(cards, allowed), 1);
});

test("computeGroundingScore: fractional when some cards cite a disallowed chunk id", () => {
  const allowed = new Set(["chunk_1"]);
  const cards = [card({ sourceChunkIds: ["chunk_1"] }), card({ sourceChunkIds: ["chunk_99"] })];
  assert.equal(computeGroundingScore(cards, allowed), 0.5);
});

test("computeGroundingScore: vacuously 1 for an empty card list", () => {
  assert.equal(computeGroundingScore([], new Set()), 1);
});

test("computeProvenanceValidity: false for an empty card list (no cards is not 'valid provenance')", () => {
  assert.equal(computeProvenanceValidity([], new Set(["chunk_1"])), false);
});

test("computeProvenanceValidity: false if any card has zero sourceChunkIds", () => {
  const allowed = new Set(["chunk_1"]);
  assert.equal(computeProvenanceValidity([card({ sourceChunkIds: [] })], allowed), false);
});

test("computeProvenanceValidity: true when every card has at least one allowed chunk id", () => {
  const allowed = new Set(["chunk_1"]);
  assert.equal(computeProvenanceValidity([card({ sourceChunkIds: ["chunk_1"] })], allowed), true);
});

// ---- expected / forbidden concepts ----

test("computeExpectedConceptCoverage: undefined when the fixture defines no expected concepts", () => {
  assert.equal(computeExpectedConceptCoverage([card()], undefined), undefined);
  assert.equal(computeExpectedConceptCoverage([card()], []), undefined);
});

test("computeExpectedConceptCoverage: case-insensitive substring match across front+back", () => {
  const cards = [card({ front: "What is a Queen Bee?", back: "the only fertile female" })];
  assert.equal(computeExpectedConceptCoverage(cards, ["queen bee"]), 1);
  assert.equal(computeExpectedConceptCoverage(cards, ["queen bee", "drone"]), 0.5);
});

test("computeExpectedConceptCoverage: a duplicate expected concept does not inflate coverage past 1", () => {
  const cards = [card({ front: "Queen bee", back: "queen bee queen bee" })];
  assert.equal(computeExpectedConceptCoverage(cards, ["queen bee", "queen bee"]), 1);
});

test("computeExpectedConceptCoverage: a missing expected concept is reflected as a fractional score, never rounded up", () => {
  const cards = [card({ front: "Queen bee", back: "" })];
  assert.equal(computeExpectedConceptCoverage(cards, ["queen bee", "drone", "royal jelly"]), 1 / 3);
});

test("computeUnsupportedClaimCount: undefined when the fixture defines no forbidden concepts", () => {
  assert.equal(computeUnsupportedClaimCount([card()], undefined), undefined);
  assert.equal(computeUnsupportedClaimCount([card()], []), undefined);
});

test("computeUnsupportedClaimCount: counts cards whose text contains a forbidden concept", () => {
  const cards = [card({ back: "bees communicate via telepathy" }), card({ back: "bees communicate via the waggle dance" })];
  assert.equal(computeUnsupportedClaimCount(cards, ["telepathy"]), 1);
});

// ---- exact duplicates ----

test("computeExactDuplicateCount: 0 for distinct cards", () => {
  const cards = [card({ front: "a", back: "1" }), card({ front: "b", back: "2" })];
  assert.equal(computeExactDuplicateCount(cards), 0);
});

test("computeExactDuplicateCount: counts exact (normalized) duplicate pairs, case/whitespace-insensitive", () => {
  const cards = [card({ front: "What is X?", back: "Y" }), card({ front: "  what IS   x?  ", back: "y" }), card({ front: "different", back: "z" })];
  assert.equal(computeExactDuplicateCount(cards), 1);
});
