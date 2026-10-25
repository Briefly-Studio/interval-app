import { test } from "node:test";
import assert from "node:assert/strict";

import { validateImportDraftForSave } from "./importDeckSave";
import type { ImportedDeckDraft } from "./types";

function draft(overrides: Partial<ImportedDeckDraft> = {}): ImportedDeckDraft {
  return {
    name: "My Deck",
    cards: [{ front: "front", back: "back" }],
    warnings: [],
    ...overrides,
  };
}

test("validateImportDraftForSave accepts a well-formed draft", () => {
  assert.equal(validateImportDraftForSave(draft()), null);
});

test("validateImportDraftForSave rejects an empty/whitespace-only deck name", () => {
  assert.equal(validateImportDraftForSave(draft({ name: "" })), "invalid-draft");
  assert.equal(validateImportDraftForSave(draft({ name: "   " })), "invalid-draft");
});

test("validateImportDraftForSave rejects a draft with zero cards", () => {
  assert.equal(validateImportDraftForSave(draft({ cards: [] })), "invalid-draft");
});

test("validateImportDraftForSave rejects a card with an empty front or back", () => {
  assert.equal(validateImportDraftForSave(draft({ cards: [{ front: "", back: "back" }] })), "invalid-draft");
  assert.equal(validateImportDraftForSave(draft({ cards: [{ front: "front", back: "   " }] })), "invalid-draft");
});

test("validateImportDraftForSave accepts multiple valid cards", () => {
  const multi = draft({
    cards: [
      { front: "a", back: "1" },
      { front: "b", back: "2" },
    ],
  });
  assert.equal(validateImportDraftForSave(multi), null);
});
