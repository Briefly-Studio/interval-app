// Dependency-free helpers for backend/lambdas/sync-pull/index.mjs — same rationale as
// sync-push/lib.mjs: exercised directly by `npm run test:sync`, no bundler, no framework.
// Most of this file is pure; `createHandler` at the bottom is the one exception, DI'd (client/
// Command constructor passed in, never imported) so it never needs
// "@aws-sdk/client-dynamodb"/"@aws-sdk/lib-dynamodb" to be resolvable at test time — only
// index.mjs (the one file that constructs the real client) imports them. `lib.test.mjs` is
// excluded from the deployed Lambda package.
//
// See docs/sync-cursor-semantics.md for the full design this file implements: pull now orders by
// a server-assigned `seq`, never by the client domain timestamp the old SK-based cursor used —
// that old scheme could permanently miss a backdated/late offline upload once a device's cursor
// had advanced past its (old) `ts`.
//
// REWORKED (post-review): an earlier version of this fix queried `seq` through a GSI on the
// Changes table. A GSI can NEVER serve a `ConsistentRead: true` query — DynamoDB documents GSI
// reads as eventually consistent only, with no documented guarantee that two different items'
// index propagation preserves their relative base-table write order. That left a real gap: a
// cursor could receive a higher `seq` whose GSI projection happened to propagate first, advance
// past a lower `seq` whose projection had not yet propagated, and then permanently miss it once
// that projection finally appeared. The fix: `seq` is now the PRIMARY sort key of a dedicated
// base table, `Interval_ChangeStream` (never a secondary index), queried here with
// `ConsistentRead: true` — fully supported for a base-table Query against its own primary key,
// unlike a GSI — so every pull always observes the true, fully committed state with zero
// propagation lag. See docs/sync-cursor-semantics.md's "Root cause" and "Correctness invariant"
// sections for the full analysis, including the independent write-order race this also closes
// on the push side (sync-push/lib.mjs's assignSequenceAndAppendChangeLog).
//
// DUAL-MODE ROLLOUT (post-deployability audit): this file's v2 path (above) and a resurrected
// LEGACY path (below — the exact pre-this-fix plain SK-ordered query against `Interval_Changes`)
// both live in the same deployed code, selected at runtime by `SYNC_CURSOR_MODE`
// (`resolveSyncCursorMode`, fail-closed to `"legacy"`). This is required because
// `Interval_ChangeStream`, its IAM grants, and this file's own code all deploy together in one
// CDK stack update — there is no supported way to deploy the new table/IAM without also deploying
// whatever Lambda code currently exists in this repository, so the code itself has to default to
// behaving exactly like the pre-fix implementation until a later, separate, explicit deploy flips
// the mode. See sync-push/lib.mjs's header comment and docs/sync-cursor-semantics.md's "Rollout"
// section for the full reasoning and the exact command-level sequence.

export const DEFAULT_PULL_LIMIT = 200;
export const MAX_PULL_LIMIT = 500;

/** Same fail-closed resolution as sync-push/lib.mjs's own `resolveSyncCursorMode` — duplicated
 * deliberately (no shared module between Lambdas); only the exact literal `"v2"` activates the
 * new path. */
export function resolveSyncCursorMode(raw) {
  return raw === "v2" ? "v2" : "legacy";
}

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
 * Parses a client-supplied cursor into either a valid incremental position or a signal to
 * perform a full replay. See docs/sync-cursor-semantics.md's "Cursor format" and "Migration"
 * sections for the full reasoning.
 *
 *   - Absent/empty → full replay (first pull ever, or a client that reset its cursor, e.g. Force
 *     Resync).
 *   - A plain non-negative integer string (e.g. "42") → the new, server-assigned `seq` format —
 *     incremental pull strictly after that seq.
 *   - Anything else — including the OLD pipe-delimited `ts|deviceId|entity|id|op` changeKey
 *     format a client may still be holding locally from before this fix, or any other malformed/
 *     garbage value — is a LEGACY/invalid cursor: never parsed further, never interpolated into
 *     a query expression (the strict `/^\d+$/` check is what makes this safe — see this file's
 *     own "Security" note in docs/sync-cursor-semantics.md), and resolved to exactly one full
 *     replay. The client then receives a fresh, valid new-format cursor in the response and
 *     self-heals permanently with no mobile code change and no explicit version negotiation.
 */
export function parseCursor(raw) {
  if (raw === null || raw === undefined || raw === "") {
    return { mode: "full", legacy: false };
  }
  if (typeof raw === "string" && /^\d+$/.test(raw)) {
    const seq = Number(raw);
    if (Number.isSafeInteger(seq) && seq >= 0) return { mode: "incremental", seq, legacy: false };
  }
  return { mode: "full", legacy: true };
}

/**
 * Builds the exact DynamoDB `QueryCommand` input for one pull — always against
 * `Interval_ChangeStream`'s own BASE TABLE (`tableName`), never a secondary index, and always
 * with `ConsistentRead: true`. That consistent read is the load-bearing half of this fix's
 * correctness invariant (see docs/sync-cursor-semantics.md's "Correctness invariant" section):
 * because `seq` is this table's own primary sort key, a strongly consistent Query is fully
 * supported and always reflects every write already committed at the moment it runs — there is
 * no propagation lag to reason about, unlike the GSI design this replaces.
 *
 * A `"full"` parsed cursor omits the sort-key condition entirely (same semantics as today's "no
 * cursor → everything" pull, just now ordered by `seq`); an `"incremental"` cursor adds
 * `seq > :cursor`. `ownerPk` is always the TRUSTED `U#<sub>` derived from the authorizer claims
 * (see index.mjs) — this function never reads a partition key from client input, so no cursor
 * value can ever cause cross-user access or arbitrary partition traversal regardless of what
 * `parsed` contains.
 */
export function buildPullQueryParams({ tableName, ownerPk, parsed, limit }) {
  const base = { TableName: tableName, Limit: limit, ScanIndexForward: true, ConsistentRead: true };
  if (parsed.mode === "incremental") {
    return {
      ...base,
      KeyConditionExpression: "PK = :pk AND #seq > :cursor",
      ExpressionAttributeNames: { "#seq": "seq" },
      ExpressionAttributeValues: { ":pk": ownerPk, ":cursor": parsed.seq },
    };
  }
  return { ...base, KeyConditionExpression: "PK = :pk", ExpressionAttributeValues: { ":pk": ownerPk } };
}

/**
 * Chooses the cursor to return for one page of `Interval_ChangeStream`-sourced items (already
 * sorted ascending by `seq`, per `buildPullQueryParams`'s `ScanIndexForward: true`). Every item
 * this table can possibly return carries a numeric `seq` — it is that table's own primary sort
 * key, not an optional/sparse attribute — so, unlike the original SK-derived cursor this whole
 * fix replaced, there is no "unkeyable row" edge case left to walk around: the last item's own
 * `seq` is always directly usable. Empty page → keep the incoming cursor, no forward progress
 * claimed (see docs/sync-cursor-semantics.md's "Failure/idempotency" section).
 */
export function nextCursorForPage(items, incomingCursor) {
  const fallback = typeof incomingCursor === "string" ? incomingCursor : "";
  if (!Array.isArray(items) || items.length === 0) return { cursor: fallback, advanced: false };
  const last = items[items.length - 1];
  if (typeof last?.seq !== "number" || !Number.isFinite(last.seq)) {
    // Defensive only — cannot happen for a real ChangeStream result; see header comment above.
    return { cursor: fallback, advanced: false };
  }
  return { cursor: String(last.seq), advanced: true };
}

/**
 * The LEGACY (`SYNC_CURSOR_MODE=legacy`) query — byte-for-byte the same shape as the pre-this-fix
 * implementation: a plain `Query` against `Interval_Changes`'s own base table, ordered by `SK`,
 * `SK > :cursor` for an incremental pull (no condition for a full replay). No `ConsistentRead`
 * (this path never claimed strong consistency, and doesn't need to — it is exactly what already
 * runs today). `cursor` here is the raw, opaque, previously-returned `SK` string, not a parsed
 * `{mode, seq}` value — legacy mode has no v2-style "detect a foreign cursor format" concept of
 * its own; every cursor it ever hands out IS this exact shape.
 */
export function buildLegacyPullQueryParams({ tableName, ownerPk, cursor, limit }) {
  const base = { TableName: tableName, Limit: limit, ScanIndexForward: true };
  if (typeof cursor === "string" && cursor.length > 0) {
    return {
      ...base,
      KeyConditionExpression: "PK = :pk AND SK > :cursor",
      ExpressionAttributeValues: { ":pk": ownerPk, ":cursor": cursor },
    };
  }
  return { ...base, KeyConditionExpression: "PK = :pk", ExpressionAttributeValues: { ":pk": ownerPk } };
}

/**
 * True for a real change-log row (`SK` starts `"C#"`) — false for the per-user sequence-counter
 * sentinel row (`SK="SEQ#COUNTER"`, sync-push/lib.mjs's `SEQUENCE_COUNTER_SK`). The counter row
 * did not exist at all while this repository ran ONLY the legacy path, so the original
 * implementation never needed this filter — it is a NEW defensive addition for the dual-mode
 * world, where the counter row can legitimately exist (written by the backfill script, or by a
 * v2-mode push, during a period this environment's pull is still running in legacy mode) and,
 * because `"SEQ#COUNTER"` sorts lexicographically AFTER every real `"C#..."` row, would otherwise
 * surface as a fake "change" at the END of an unbounded legacy scan. Filtering it out of the
 * DELIVERED `changes` array — while still advancing the cursor past it via the RAW (unfiltered)
 * item list in `nextLegacyCursorForPage` below — is what keeps this safe without reintroducing
 * any query-level complexity into the one proven, already-correct legacy path itself.
 */
export function isLegacyChangeRow(item) {
  return typeof item?.SK === "string" && item.SK.startsWith("C#");
}

/**
 * Chooses the cursor for one page of legacy results — the last RAW item's own `SK` (never the
 * filtered/delivered list — see `isLegacyChangeRow`'s own comment for why advancing past the
 * counter sentinel row, even though it is never delivered as a "change," is what prevents a
 * permanent pagination stall at that exact position).
 */
export function nextLegacyCursorForPage(items, incomingCursor) {
  const fallback = typeof incomingCursor === "string" ? incomingCursor : "";
  if (!Array.isArray(items) || items.length === 0) return { cursor: fallback, advanced: false };
  const last = items[items.length - 1];
  if (typeof last?.SK !== "string") return { cursor: fallback, advanced: false };
  return { cursor: last.SK, advanced: true };
}

function mapChangeRow(it) {
  return { id: it.id, entity: it.entity, op: it.op, record: it.record, ts: it.ts };
}

/**
 * Builds the full sync-pull Lambda handler — DI'd exactly like sync-push/lib.mjs's own
 * createHandler: client/Command constructor passed in, never imported here, so this entire
 * request/response flow can be exercised end to end by index.test.mjs with a small in-memory
 * fake, with "@aws-sdk/client-dynamodb"/"@aws-sdk/lib-dynamodb" never needing to be resolvable
 * at test time — only index.mjs (the one place that constructs the REAL client) imports them.
 */
export function createHandler({ client, QueryCommandCtor, changesTable, changeStreamTable, cursorMode }) {
  const resolvedCursorMode = resolveSyncCursorMode(cursorMode);

  return async (event) => {
    const startedAt = Date.now();

    // Both tables are required regardless of which mode is CURRENTLY active: this environment's
    // mode can flip to v2 on a later deploy without this Lambda's code changing again, and a
    // rollback to legacy must also remain possible — see this file's header comment.
    if (!changesTable || !changeStreamTable) {
      return jsonResponse(500, { ok: false, error: "Missing env var: CHANGES_TABLE / CHANGE_STREAM_TABLE" });
    }

    const sub = getUserSub(event);
    if (!sub) return jsonResponse(401, { message: "Unauthorized" });

    const OWNER_PK = `U#${sub}`;
    console.log(`[auth] sub: ${sub.slice(0, 8)}… cursorMode=${resolvedCursorMode}`);

    const qs = event.queryStringParameters || {};
    const rawCursor = qs.cursor || null;
    const limit = resolvePullLimit(qs.limit);

    // Wrapped defensively (matching sync-push) so a transient DynamoDB failure returns a
    // sanitized 500 rather than an unhandled Lambda error response that could leak internals
    // through API Gateway's default error formatting.
    try {
      if (resolvedCursorMode === "v2") {
        // parseCursor never trusts rawCursor's shape — see this file's own doc comment for
        // exactly which values are treated as the new server-assigned format vs. a legacy/
        // invalid cursor that triggers one full replay (this is also exactly the mechanism that
        // bridges a client still holding a pre-cutover legacy SK-string cursor the FIRST time it
        // pulls after this environment's mode flips to v2 — `legacy: true` is logged, never the
        // raw value, so a migrating fleet's self-healing rate is observable).
        const parsed = parseCursor(rawCursor);
        console.log(
          `[sync-pull] start cursorMode=v2 parsedMode=${parsed.mode} legacyCursor=${parsed.legacy} limit=${limit}`
        );

        const params = buildPullQueryParams({ tableName: changeStreamTable, ownerPk: OWNER_PK, parsed, limit });
        const out = await client.send(new QueryCommandCtor(params));
        const items = out.Items || [];
        const changes = items.map(mapChangeRow);

        // Advance the cursor from the last item's own `seq` — guaranteed present for every row
        // this strongly-consistent query can return (see nextCursorForPage's own header
        // comment). This is the root fix for the backdated-upload bug: `seq` is server-assigned
        // at ingestion time, never the change's own (client-supplied, possibly old/clock-skewed)
        // `ts` — see docs/sync-cursor-semantics.md.
        const next = nextCursorForPage(items, rawCursor);
        if (items.length > 0 && !next.advanced) {
          console.log("[sync-pull] warning: page returned but cursor did not advance");
        }

        console.log(
          `[sync-pull] complete cursorMode=v2 returned=${changes.length} hasMore=${
            items.length === limit
          } advanced=${next.advanced} elapsedMs=${Date.now() - startedAt}`
        );

        return jsonResponse(200, { cursor: next.cursor, changes });
      }

      // LEGACY path — see this file's header comment's "Dual-mode rollout" section.
      console.log(`[sync-pull] start cursorMode=legacy limit=${limit}`);

      const params = buildLegacyPullQueryParams({ tableName: changesTable, ownerPk: OWNER_PK, cursor: rawCursor, limit });
      const out = await client.send(new QueryCommandCtor(params));
      const items = out.Items || [];
      const changes = items.filter(isLegacyChangeRow).map(mapChangeRow);

      const next = nextLegacyCursorForPage(items, rawCursor);
      if (items.length > 0 && !next.advanced) {
        console.log("[sync-pull] warning: page returned but cursor did not advance");
      }

      console.log(
        `[sync-pull] complete cursorMode=legacy returned=${changes.length} hasMore=${
          items.length === limit
        } advanced=${next.advanced} elapsedMs=${Date.now() - startedAt}`
      );

      return jsonResponse(200, { cursor: next.cursor, changes });
    } catch (e) {
      console.log(
        `[sync-pull] unhandled error: ${e?.name || "UnknownError"} elapsedMs=${Date.now() - startedAt}`
      );
      return jsonResponse(500, { ok: false, error: "Unhandled server error" });
    }
  };
}
