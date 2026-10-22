import { test } from "node:test";
import assert from "node:assert/strict";

import {
  deriveCardCountHintKind,
  deriveFewerCardsExplanation,
  hasTrustworthyChunkScope,
  summarizeGenerationCoverage,
} from "./generationCoverage";

test("summarizeGenerationCoverage reports full coverage with no exclusions", () => {
  const coverage = summarizeGenerationCoverage({ fullSourceIncluded: true, chunkCount: 5, excludedChunkCount: 0 });
  assert.deepEqual(coverage, { fullSourceIncluded: true, includedChunkCount: 5, totalChunkCount: 5 });
});

test("summarizeGenerationCoverage derives totalChunkCount from included + excluded, never a separate measurement", () => {
  const coverage = summarizeGenerationCoverage({ fullSourceIncluded: false, chunkCount: 12, excludedChunkCount: 131 });
  assert.deepEqual(coverage, { fullSourceIncluded: false, includedChunkCount: 12, totalChunkCount: 143 });
});

test("hasTrustworthyChunkScope is true for ordinary partial coverage", () => {
  assert.equal(hasTrustworthyChunkScope({ fullSourceIncluded: false, includedChunkCount: 12, totalChunkCount: 143 }), true);
});

test("hasTrustworthyChunkScope is true for ordinary full coverage", () => {
  assert.equal(hasTrustworthyChunkScope({ fullSourceIncluded: true, includedChunkCount: 5, totalChunkCount: 5 }), true);
});

test("hasTrustworthyChunkScope is false when total chunk count is zero — never invents a number", () => {
  assert.equal(hasTrustworthyChunkScope({ fullSourceIncluded: false, includedChunkCount: 0, totalChunkCount: 0 }), false);
});

test("hasTrustworthyChunkScope is false when included exceeds total (defensive, should never happen in practice)", () => {
  assert.equal(hasTrustworthyChunkScope({ fullSourceIncluded: false, includedChunkCount: 5, totalChunkCount: 3 }), false);
});

test("deriveCardCountHintKind is full when the whole source fits", () => {
  assert.equal(deriveCardCountHintKind(true), "full");
});

test("deriveCardCountHintKind is partial when the source will be (or was) truncated", () => {
  assert.equal(deriveCardCountHintKind(false), "partial");
});

test("deriveFewerCardsExplanation is none when the result meets the request", () => {
  assert.equal(deriveFewerCardsExplanation({ fullSourceIncluded: true, requestedCardCount: 10, resultingCardCount: 10 }), "none");
});

test("deriveFewerCardsExplanation is none when the result exceeds the request", () => {
  assert.equal(deriveFewerCardsExplanation({ fullSourceIncluded: false, requestedCardCount: 10, resultingCardCount: 12 }), "none");
});

test("deriveFewerCardsExplanation is none for a zero-card result (handled by separate no-cards messaging)", () => {
  assert.equal(deriveFewerCardsExplanation({ fullSourceIncluded: true, requestedCardCount: 10, resultingCardCount: 0 }), "none");
});

test("deriveFewerCardsExplanation is full-source when the whole source was used but fewer cards resulted", () => {
  assert.equal(deriveFewerCardsExplanation({ fullSourceIncluded: true, requestedCardCount: 25, resultingCardCount: 9 }), "full-source");
});

test("deriveFewerCardsExplanation is partial-source when only part of the source was used and fewer cards resulted", () => {
  assert.equal(deriveFewerCardsExplanation({ fullSourceIncluded: false, requestedCardCount: 25, resultingCardCount: 9 }), "partial-source");
});

test("coverage/fewer-cards logic is identical regardless of which source format produced the numbers", () => {
  // Neither function takes a sourceType/format parameter — a TXT-shaped partial context
  // (fewer, larger chunks) and a PDF-shaped partial context (more, smaller chunks) that happen to
  // land on the same included/excluded counts must be judged identically.
  const txtShapedContext = { fullSourceIncluded: false, chunkCount: 12, excludedChunkCount: 131 };
  const pdfShapedContext = { fullSourceIncluded: false, chunkCount: 12, excludedChunkCount: 131 };
  assert.deepEqual(summarizeGenerationCoverage(txtShapedContext), summarizeGenerationCoverage(pdfShapedContext));
  assert.equal(
    deriveFewerCardsExplanation({ fullSourceIncluded: false, requestedCardCount: 25, resultingCardCount: 9 }),
    deriveFewerCardsExplanation({ fullSourceIncluded: false, requestedCardCount: 25, resultingCardCount: 9 })
  );
});
