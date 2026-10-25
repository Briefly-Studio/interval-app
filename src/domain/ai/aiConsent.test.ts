import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildAiConsentRecord,
  CURRENT_AI_CONSENT_VERSION,
  hasCurrentAiConsent,
  isValidAiConsentRecord,
  needsAiConsent,
} from "./aiConsent";

test("isValidAiConsentRecord accepts a well-formed record", () => {
  assert.equal(isValidAiConsentRecord({ version: 1, acceptedAt: "2026-01-01T00:00:00.000Z" }), true);
});

test("isValidAiConsentRecord rejects missing, malformed, or wrong-type fields", () => {
  assert.equal(isValidAiConsentRecord(null), false);
  assert.equal(isValidAiConsentRecord(undefined), false);
  assert.equal(isValidAiConsentRecord("not an object"), false);
  assert.equal(isValidAiConsentRecord({}), false);
  assert.equal(isValidAiConsentRecord({ version: "1", acceptedAt: "2026-01-01T00:00:00.000Z" }), false);
  assert.equal(isValidAiConsentRecord({ version: 1, acceptedAt: 12345 }), false);
  assert.equal(isValidAiConsentRecord({ version: 1, acceptedAt: "" }), false);
  assert.equal(isValidAiConsentRecord({ version: Number.NaN, acceptedAt: "2026-01-01T00:00:00.000Z" }), false);
});

test("hasCurrentAiConsent: a record at the current version is valid consent", () => {
  assert.equal(hasCurrentAiConsent({ version: CURRENT_AI_CONSENT_VERSION, acceptedAt: "2026-01-01T00:00:00.000Z" }), true);
});

test("hasCurrentAiConsent: a record at a LOWER version is rejected (stale)", () => {
  assert.equal(hasCurrentAiConsent({ version: CURRENT_AI_CONSENT_VERSION - 1, acceptedAt: "2026-01-01T00:00:00.000Z" }), false);
});

test("hasCurrentAiConsent: a record at a HIGHER version is rejected — fails closed rather than trusting an impossible future/corrupt value", () => {
  assert.equal(hasCurrentAiConsent({ version: CURRENT_AI_CONSENT_VERSION + 1, acceptedAt: "2026-01-01T00:00:00.000Z" }), false);
});

test("hasCurrentAiConsent: a malformed version value is rejected", () => {
  assert.equal(hasCurrentAiConsent({ version: Number.NaN, acceptedAt: "2026-01-01T00:00:00.000Z" }), false);
  assert.equal(hasCurrentAiConsent({ version: "1", acceptedAt: "2026-01-01T00:00:00.000Z" }), false);
  assert.equal(hasCurrentAiConsent({ version: null, acceptedAt: "2026-01-01T00:00:00.000Z" }), false);
  assert.equal(hasCurrentAiConsent({ version: undefined, acceptedAt: "2026-01-01T00:00:00.000Z" }), false);
});

test("hasCurrentAiConsent: missing/malformed consent is never valid", () => {
  assert.equal(hasCurrentAiConsent(null), false);
  assert.equal(hasCurrentAiConsent(undefined), false);
  assert.equal(hasCurrentAiConsent({ garbage: true }), false);
  assert.equal(hasCurrentAiConsent("1"), false);
});

test("buildAiConsentRecord stamps the current version and the exact given timestamp", () => {
  const now = new Date("2026-05-01T12:00:00.000Z");
  assert.deepEqual(buildAiConsentRecord(now), { version: CURRENT_AI_CONSENT_VERSION, acceptedAt: "2026-05-01T12:00:00.000Z" });
});

// ---- needsAiConsent: the single decision point the Generate screen calls ----

test("needsAiConsent: mock provider never needs consent, even with no stored record", () => {
  assert.equal(needsAiConsent(false, null), false);
});

test("needsAiConsent: mock provider never needs consent, even with a stale/malformed record", () => {
  assert.equal(needsAiConsent(false, { version: 0, acceptedAt: "x" }), false);
  assert.equal(needsAiConsent(false, "garbage"), false);
});

test("needsAiConsent: real provider with no stored record requires consent", () => {
  assert.equal(needsAiConsent(true, null), true);
});

test("needsAiConsent: real provider with a valid current-version record does not require consent", () => {
  assert.equal(needsAiConsent(true, { version: CURRENT_AI_CONSENT_VERSION, acceptedAt: "2026-01-01T00:00:00.000Z" }), false);
});

test("needsAiConsent: real provider with a stale-version record requires consent again", () => {
  assert.equal(needsAiConsent(true, { version: CURRENT_AI_CONSENT_VERSION - 1, acceptedAt: "2026-01-01T00:00:00.000Z" }), true);
});

test("needsAiConsent: real provider with a HIGHER-than-current version record requires consent again (fails closed)", () => {
  assert.equal(needsAiConsent(true, { version: CURRENT_AI_CONSENT_VERSION + 1, acceptedAt: "2026-01-01T00:00:00.000Z" }), true);
});

test("needsAiConsent: real provider with a malformed/corrupted stored record fails safely and asks again", () => {
  assert.equal(needsAiConsent(true, { acceptedAt: "2026-01-01T00:00:00.000Z" }), true);
  assert.equal(needsAiConsent(true, { version: "one", acceptedAt: "2026-01-01T00:00:00.000Z" }), true);
  assert.equal(needsAiConsent(true, []), true);
  assert.equal(needsAiConsent(true, 42), true);
});

test("needsAiConsent: repeated calls with the same valid record are idempotent (no reprompt)", () => {
  const record = buildAiConsentRecord(new Date("2026-01-01T00:00:00.000Z"));
  assert.equal(needsAiConsent(true, record), false);
  assert.equal(needsAiConsent(true, record), false);
  assert.equal(needsAiConsent(true, record), false);
});

test("needsAiConsent: a version bump (simulated by requiring a higher version) reprompts", () => {
  const acceptedUnderOldVersion = { version: 1, acceptedAt: "2026-01-01T00:00:00.000Z" };
  // hasCurrentAiConsent compares against the CURRENT constant; this test simulates what happens
  // the moment a future batch raises CURRENT_AI_CONSENT_VERSION past what was stored previously —
  // same assertion shape as the "stale-version record" test above, named for that scenario
  // explicitly.
  assert.equal(needsAiConsent(true, { ...acceptedUnderOldVersion, version: 0 }), true);
});
