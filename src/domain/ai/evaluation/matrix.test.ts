import assert from "node:assert/strict";
import test from "node:test";

import { EVALUATION_FIXTURES } from "./fixtures";
import { ALL_DIFFICULTIES, ALL_SCOPES, ALL_TIERS, buildEvaluationMatrix, buildFullMatrix, DEFAULT_SMOKE_FIXTURE_IDS } from "./matrix";

test("buildEvaluationMatrix: with no selection at all, reproduces the small default smoke matrix (never the full grid)", () => {
  const cases = buildEvaluationMatrix();
  assert.equal(cases.length, DEFAULT_SMOKE_FIXTURE_IDS.length); // 1 difficulty x 1 tier x 1 scope x N fixtures
  assert.deepEqual(new Set(cases.map((c) => c.fixtureId)), new Set(DEFAULT_SMOKE_FIXTURE_IDS));
  assert.ok(cases.every((c) => c.difficulty === "balanced" && c.tier === "medium" && c.scope === "bounded"));
});

test("buildEvaluationMatrix: selecting one dimension explicitly leaves the others at their small defaults", () => {
  const cases = buildEvaluationMatrix({ difficulties: ["basic", "advanced"] });
  assert.equal(cases.length, DEFAULT_SMOKE_FIXTURE_IDS.length * 2);
  assert.deepEqual(new Set(cases.map((c) => c.difficulty)), new Set(["basic", "advanced"]));
});

test("buildEvaluationMatrix: an explicit single fixture + single dimension values produces exactly the example from the mission brief", () => {
  const cases = buildEvaluationMatrix({ fixtureIds: ["txt-factual-rich"], difficulties: ["basic"], tiers: ["medium"], scopes: ["bounded"] });
  assert.deepEqual(cases, [{ fixtureId: "txt-factual-rich", difficulty: "basic", tier: "medium", scope: "bounded" }]);
});

test("buildEvaluationMatrix: multiple fixtures x multiple tiers produces the full cross product of exactly those", () => {
  const cases = buildEvaluationMatrix({ fixtureIds: ["txt-factual-rich", "pdf-structured-facts"], tiers: ["small", "large"] });
  assert.equal(cases.length, 4);
  const pairs = new Set(cases.map((c) => `${c.fixtureId}|${c.tier}`));
  assert.deepEqual(pairs, new Set(["txt-factual-rich|small", "txt-factual-rich|large", "pdf-structured-facts|small", "pdf-structured-facts|large"]));
});

test("buildEvaluationMatrix: an unknown fixture id throws immediately, never silently producing zero cases for it", () => {
  assert.throws(() => buildEvaluationMatrix({ fixtureIds: ["does-not-exist"] }), /unknown fixture id/);
});

test("buildEvaluationMatrix: an empty array for any dimension throws rather than silently producing zero cases", () => {
  assert.throws(() => buildEvaluationMatrix({ fixtureIds: [] }), /fixtureIds must not be empty/);
  assert.throws(() => buildEvaluationMatrix({ difficulties: [] }), /difficulties must not be empty/);
  assert.throws(() => buildEvaluationMatrix({ tiers: [] }), /tiers must not be empty/);
  assert.throws(() => buildEvaluationMatrix({ scopes: [] }), /scopes must not be empty/);
});

test("buildFullMatrix: the full Cartesian product over every registered fixture x every dimension value — explicit opt-in only", () => {
  const cases = buildFullMatrix();
  assert.equal(cases.length, EVALUATION_FIXTURES.length * ALL_DIFFICULTIES.length * ALL_TIERS.length * ALL_SCOPES.length);
  const uniqueCases = new Set(cases.map((c) => `${c.fixtureId}|${c.difficulty}|${c.tier}|${c.scope}`));
  assert.equal(uniqueCases.size, cases.length, "every case in the full matrix must be unique");
});
