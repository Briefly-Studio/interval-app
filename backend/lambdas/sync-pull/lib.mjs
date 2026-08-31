// Pure, dependency-free helpers for backend/lambdas/sync-pull/index.mjs — same rationale as
// sync-push/lib.mjs: exercised directly by `npm run test:sync`, no AWS SDK, no framework.
// `lib.test.mjs` is excluded from the deployed Lambda package.

export const DEFAULT_PULL_LIMIT = 200;
export const MAX_PULL_LIMIT = 500;

export function jsonResponse(statusCode, obj) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(obj),
  };
}

// Supports HTTP API (v2) JWT authorizer AND REST API style authorizer.
export function getUserSub(event) {
  const subV2 = event?.requestContext?.authorizer?.jwt?.claims?.sub;
  if (typeof subV2 === "string" && subV2.length) return subV2;

  const subV1 = event?.requestContext?.authorizer?.claims?.sub;
  if (typeof subV1 === "string" && subV1.length) return subV1;

  const subLoose = event?.requestContext?.authorizer?.sub;
  if (typeof subLoose === "string" && subLoose.length) return subLoose;

  return null;
}

// The client never sends `limit`, but an external/malformed caller could — `Number("abc")` is
// NaN and `Number("0")` is 0, both of which DynamoDB rejects for `Limit` with a
// ValidationException that would surface as a 500. Fall back to the default for anything that
// isn't a positive finite number, and cap at MAX_PULL_LIMIT.
export function resolvePullLimit(rawLimit) {
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PULL_LIMIT;
  return Math.min(Math.floor(parsed), MAX_PULL_LIMIT);
}

/**
 * The cursor value for one Changes-table row. The authoritative source is the row's SK, which is
 * always `C#<changeKey>` (key schema — it cannot be missing) — the client passes the cursor back
 * as `?cursor=X` and the handler queries `SK > C#X`, so the cursor MUST be `SK` minus the `C#`
 * prefix. The `changeKey` attribute is a secondary source, used only if the SK somehow isn't
 * `C#`-shaped (which `sync-push` never produces). Returns `null` when neither is usable.
 */
export function cursorForRow(row) {
  const sk = row?.SK;
  if (typeof sk === "string" && sk.startsWith("C#") && sk.length > 2) return sk.slice(2);
  const ck = row?.changeKey;
  if (typeof ck === "string" && ck.length > 0) return ck;
  return null;
}

/**
 * Choose the cursor to return for a page of `items` (already sorted ascending by SK).
 *
 * Walks backward from the last row to the last row we can key. Advancing to that row is always
 * safe for forward progress: every row we walk past has ALREADY been returned in this page's
 * `changes` (the client applies/skips them), so the next page — which re-queries `SK > C#<that
 * cursor>` — never skips an unprocessed valid row, it only re-delivers the trailing rows we
 * could not key (idempotent for the client). We never invent a cursor and never jump forward
 * past a row we could not key. Empty page → keep the incoming cursor. No keyable row at all
 * (impossible for real Changes rows) → keep the incoming cursor and let the caller log it.
 */
export function nextCursorForPage(items, incomingCursor) {
  const fallback = typeof incomingCursor === "string" ? incomingCursor : "";
  if (!Array.isArray(items) || items.length === 0) return { cursor: fallback, advanced: false };
  for (let i = items.length - 1; i >= 0; i--) {
    const key = cursorForRow(items[i]);
    if (key !== null) {
      return { cursor: key, advanced: true, unkeyedTrailingRows: items.length - 1 - i };
    }
  }
  return { cursor: fallback, advanced: false };
}
