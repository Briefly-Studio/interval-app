import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_PROVENANCE_CHUNK_IDS, upgradeGeneratedCardProvenance, type GeneratedCardProvenanceRecord as P } from "../../models/generatedCardProvenance";
import { collapseGeneratedCardProvenance, mergeGeneratedCardProvenance as merge, provenancePayload } from "./generatedCardProvenanceMerge";

function record(overrides: Partial<P> = {}): P {
  return { ...upgradeGeneratedCardProvenance({ cardId: "card-1", deckId: "deck-1", sourceId: "source-1",
    sourceChunkIds: ["chunk_a"], generatedAt: "2026-01-01T00:00:00.000Z" })!, ...overrides };
}

test("missing local/incoming and duplicate pull are idempotent", () => {
  const local = record();
  assert.equal(merge(local, undefined).record, local);
  assert.equal(merge(undefined, undefined).record, undefined);
  assert.equal(merge(undefined, local).record?.dirty, false);
  assert.deepEqual(merge(local, local).record, local);
});

test("higher revision wins identity/lifecycle even with an older timestamp", () => {
  const old = record({ rev: 1, sourceId: "other-source", updatedAt: "2026-02-01T00:00:00.000Z" });
  const newer = record({ rev: 2 });
  assert.equal(provenancePayload(merge(old, newer).record!), provenancePayload(newer));
  assert.equal(provenancePayload(merge(newer, old).record!), provenancePayload(newer));
});

test("same source disjoint/overlapping sets union canonically; repair is dirty and revisioned", () => {
  const a = record({ sourceChunkIds: ["chunk_a", "chunk_b"] });
  const b = record({ sourceChunkIds: ["chunk_b", "chunk_c"] });
  const ab = merge(a, b).record!;
  assert.deepEqual(ab, merge(b, a).record);
  assert.deepEqual(ab.sourceChunkIds, ["chunk_a", "chunk_b", "chunk_c"]);
  assert.equal(ab.rev, 2);
  assert.equal(ab.dirty, true);
  assert.equal(ab.updatedAt, "2026-01-01T00:00:00.001Z");
  assert.deepEqual(merge(ab, a).record, ab);
  assert.deepEqual(merge(ab, b).record, ab);
});

test("late lower-revision valid chunks are retained after an earlier union", () => {
  const first = merge(record(), record({ sourceChunkIds: ["chunk_b"] })).record!;
  const result = merge(first, record({ sourceChunkIds: ["chunk_c"] })).record!;
  assert.deepEqual(result.sourceChunkIds, ["chunk_a", "chunk_b", "chunk_c"]);
  assert.equal(result.rev, 3);
  assert.deepEqual(merge(result, first).record, result);
});

test("all three-way arrival permutations converge after repair exchange", () => {
  const entries = [record(), record({ sourceChunkIds: ["chunk_b"] }), record({ sourceChunkIds: ["chunk_c"] })];
  const orders = [[0,1,2], [0,2,1], [1,0,2], [1,2,0], [2,0,1], [2,1,0]];
  const results = orders.map((order) => order.reduce<P | undefined>((local, i) => merge(local, entries[i]).record, undefined)!);
  assert.equal(new Set(results.map(provenancePayload)).size, 1);
  for (const result of results) assert.equal(merge(result, results[0]).record?.rev, 3);
});

test("same-revision identity conflicts use timestamp then deterministic payload; never cross-source union", () => {
  const a = record(), b = record({ sourceId: "source-2", sourceChunkIds: ["chunk_b"] });
  const ab = merge(a,b), ba = merge(b,a);
  assert.deepEqual(ab, ba);
  assert.equal(ab.conflict, "identity-conflict");
  assert.equal(ab.record?.sourceChunkIds.length, 1);
  const later = record({ sourceId: "source-3", updatedAt: "2026-02-01T00:00:00.000Z" });
  assert.equal(merge(a,later).record?.sourceId, "source-3");
  assert.throws(() => merge(a, record({ id: "other" })), /identity-mismatch/);
});

test("different known normalization versions and deck identities are never unioned", () => {
  for (const b of [record({ normalizationVersion: 2 }), record({ deckId: "deck-2" })]) {
    assert.equal(merge(record(), b).conflict, "identity-conflict");
  }
});

test("tombstones beat old active data; a newer explicit restore becomes active", () => {
  const active = record();
  const deleted = record({ rev: 2, deletedAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" });
  assert.ok(merge(deleted, active).record?.deletedAt);
  assert.ok(merge(active, deleted).record?.deletedAt);
  const restored = record({ rev: 3, updatedAt: "2026-01-03T00:00:00.000Z" });
  assert.equal(merge(deleted, restored).record?.deletedAt, undefined);
  assert.equal(merge(restored, deleted).record?.rev, 3);
  const tied = record({ deletedAt: active.updatedAt });
  assert.ok(merge(active, tied).record?.deletedAt);
  assert.deepEqual(merge(active, tied).record, merge(tied, active).record);
});

test("union overflow chooses a bounded deterministic record, never a silent partial union", () => {
  const a = record({ sourceChunkIds: Array.from({length: MAX_PROVENANCE_CHUNK_IDS}, (_, i) => `a_${i}`) });
  const b = record({ sourceChunkIds: ["other"] });
  const result = merge(a,b);
  assert.equal(result.conflict, "chunk-limit");
  assert.deepEqual(result, merge(b,a));
  assert.ok(result.record!.sourceChunkIds.length <= MAX_PROVENANCE_CHUNK_IDS);
});

test("duplicate legacy collapse is independent of array order, idempotent, and scoped by card", () => {
  const entries = [record(), record({sourceChunkIds:["chunk_b"]}), record({id:"card-2",cardId:"card-2"})];
  const collapsed = collapseGeneratedCardProvenance(entries);
  assert.deepEqual(collapsed, collapseGeneratedCardProvenance([...entries].reverse()));
  assert.deepEqual(collapsed, collapseGeneratedCardProvenance(collapsed));
  assert.equal(collapsed.length, 2);
});
