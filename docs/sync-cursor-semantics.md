# Sync Cursor Semantics

Fixes a foundational offline-sync correctness gap: the incremental pull cursor was based on a
client/domain timestamp, which could permanently miss a backdated or clock-skewed offline upload.
**Implemented, merged into `v3.3-dev`; infra/Lambda code changed but NOT deployed, and the
required one-time backfill has NOT been run against any live environment — see "Rollout" below
before this can go live anywhere.**

This document describes the FINAL, corrected architecture, reworked after a pre-founder-QA review
found an earlier revision of this fix unsound (see "Why not a GSI" below) — the earlier design
is not described here except where needed to explain why it was rejected.

## The old bug

A sync cursor must represent "how far this client has consumed the server's change stream" — not
"the newest domain timestamp I happened to see." The old implementation conflated the two.

`Interval_Changes` rows were keyed `PK=U#<sub>`, `SK=C#<changeKey>`, where
`changeKey = ${ts}|${deviceId}|${entity}|${id}|${op}` and `ts` is the record's own CLIENT domain
timestamp (`updatedAt`/`reviewedAt`/`generatedAt`, depending on entity). The pull cursor was that
same string, and `sync-pull` queried `KeyConditionExpression: "PK = :pk AND SK > :cursor"`.

Because ISO-8601 timestamps sort lexicographically in the same order they sort chronologically,
this was a hard DynamoDB key-range exclusion, not a probabilistic edge case: **any change whose
own `ts` was older than a cursor a device had already advanced past was permanently outside that
query's key range and would never be returned to that device by any future incremental pull, full
stop.** A record created offline and uploaded days (or longer) later — the single most basic
offline-first scenario this app exists to support — reliably triggered this.

Domain timestamps may legitimately be old, device-clock-skewed, restored, or created offline and
replayed much later — none of that should ever make a server-accepted change invisible to
delivery. **Delivery order and conflict resolution are two different concerns** — this was already
true in the old code (last-writer-wins already ran purely off `rev`/`updatedAt` on whatever was
delivered, independent of how it got delivered) and remains true here: this fix changes ONLY
delivery ordering, never touching `incomingWins`/`mergeIncomingReviewEvents`/tombstone semantics
at all.

## Correctness invariant

This fix exists to establish exactly one guarantee, stated precisely:

> If cursor N has been returned to a client, there can never later become visible an
> already-committed stream record with `seq <= N` that the client had no opportunity to receive.

Everything below is in service of that sentence. Two independent things have to be true for it to
hold, and both failed in an earlier revision of this fix (see "Why not a GSI"):

1. **Write-order correctness**: the counter must never advance to reflect `seq=N` unless `seq=N`'s
   own stream row is already durably committed. Otherwise a reader could observe the counter at N
   (e.g. by receiving N from a pull) before N's row physically exists anywhere.
2. **Read-order correctness**: a query for "everything up to seq=N" must see every row with
   `seq <= N` that is already committed, with no propagation lag of any kind.

## New cursor model

A server-assigned, monotonically increasing integer (`seq`) per user, generated at the moment
`sync-push` actually accepts a change — completely independent of that change's own `ts`.

### Server ordering — one atomic transaction, not two separate writes

`backend/lambdas/sync-push/lib.mjs`'s `assignSequenceAndAppendChangeLog`:

1. Reads the per-user counter row (`PK=U#<sub>`, `SK="SEQ#COUNTER"`, co-located in the same
   `Interval_Changes` partition as that user's idempotency rows) — `currentSeqValue` (0 if absent).
2. Attempts ONE `TransactWriteItems` call combining three actions (`buildSequenceTransactItems`),
   committed atomically or not at all:
   - **Put** the `Interval_Changes` idempotency row (`SK=C#<changeKey>`) — UNCHANGED shape from
     before this fix, conditioned on `attribute_not_exists(PK) AND attribute_not_exists(SK)`.
   - **Update** the counter, conditioned on it still holding `currentSeqValue` (or not existing
     yet — see "Counter initialization" below).
   - **Put** the new `Interval_ChangeStream` row at `seq=nextSeq` (the row `sync-pull` reads).
3. On success: `seq=nextSeq` is assigned, and — because all three actions are one DynamoDB
   transaction — this is also the exact instant the stream row becomes durably committed. There is
   no intermediate state where the counter reflects `nextSeq` without that row already existing.
4. On a `TransactionCanceledException`, `classifySequenceTransactionCancellation` inspects
   `CancellationReasons` (one entry per action, in the fixed order above):
   - The idempotency Put failed → **benign duplicate** (a retried push of the exact same change).
     The WHOLE transaction cancelled, so neither the counter nor the stream row were touched —
     a retried push wastes zero sequence numbers.
   - The counter Update failed → **genuine contention** (a different writer advanced the counter
     between this attempt's read and its transaction). Retry immediately with a fresh read — no
     sleep, bounded at `MAX_SEQUENCE_ASSIGNMENT_ATTEMPTS` (10) attempts.
   - Neither → an unexpected cancellation, treated as a real error (torn state → push rejected,
     client retries later), never silently retried or ignored.

**Why this closes the write-order race.** DynamoDB transactions are serializable: a transaction
advancing the counter to N can only *commit* once any transaction that previously claimed N is
either fully committed or fully rolled back — there is no "reserved but not yet durably written"
state visible to any later reader. So the counter can never reach N without `seq=N`'s stream row
already being committed, by construction, not by convention.

### Counter initialization

The very first assignment ever for a user: the `GetItem` read returns no `Item`, so
`currentSeqValue` is treated as `0` and `nextSeq` is `1`. The counter Update's condition,
`attribute_not_exists(#seqValue) OR #seqValue = :current`, is written to pass in BOTH the
"never existed" case and the "exists and matches" case — there is no separate first-time code
path. Tested explicitly (`assignSequenceAndAppendChangeLog: first-ever counter initialization for
a user assigns seq=1`, `backend/lambdas/sync-push/lib.test.mjs`).

### Why not a GSI

An earlier revision of this fix queried `seq` through a Global Secondary Index (`BySeq`) on
`Interval_Changes`, with `seq` assigned by a plain atomic counter increment, written as a
*separate*, later `PutItem`. A pre-founder-QA review found this unsound for two independent
reasons, and both had to be fixed — fixing only one would not have been enough:

1. **GSIs are always eventually consistent.** DynamoDB's `Query` operation does not support
   `ConsistentRead: true` against a GSI at all — strong consistency is only available against a
   table's own primary key (or a Local Secondary Index, which cannot be added to an existing
   table after creation). Propagation from the base table to a GSI is asynchronous, with no
   documented guarantee that two different items' propagation preserves their relative base-table
   write order. Concretely: a cursor could receive `seq=42` (already propagated to the index)
   while `seq=41` (committed to the base table strictly BEFORE 42) had not yet propagated, advance
   past 41's position, and then permanently miss it once 41 finally became visible — the exact
   failure this whole fix exists to prevent, just moved one layer down into the index itself.
2. **Independent of the GSI, "claim the next seq" and "durably write the row under it" were two
   separate, non-atomic calls.** A slower holder of a LOWER seq could commit its row AFTER a
   faster holder of a HIGHER seq — a race that existed even against a hypothetical
   strongly-consistent read, because nothing serialized the two steps against each other. Separate
   pushes for the same user, or even multiple changes within one push request (processed
   concurrently via `PUSH_CONCURRENCY`), could trigger this.

The correction: `seq` is the PRIMARY sort key of a dedicated base table, `Interval_ChangeStream`
(never a secondary index), so `sync-pull` can query it with `ConsistentRead: true` — closing
reason 1. Assignment and the stream write happen inside the SAME transaction as the counter
advance — closing reason 2. See "DynamoDB design" and "Pull semantics" below for each half.

### DynamoDB design — a dedicated table, not a key-schema change

DynamoDB's key schema (partition + sort key names/types) is immutable for the life of a table —
there is no in-place way to change `Interval_Changes`'s existing `SK`, and a Local Secondary Index
(which WOULD support `ConsistentRead`) can only be added at table-creation time, not retroactively.
The fix is therefore a new, separate table:

```ts
const changeStreamTable = new dynamodb.Table(this, "ChangeStreamTable", {
  tableName: names.changeStream,
  partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "seq", type: dynamodb.AttributeType.NUMBER },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  encryption: dynamodb.TableEncryption.AWS_MANAGED,
  pointInTimeRecovery: false,
  removalPolicy, // DESTROY (Development) / RETAIN (Staging) — same policy as every other table
});
```

`seq` is this table's own primary sort key (Number type — no zero-padded string tricks needed),
not an optional/sparse attribute on some other table's secondary index. Every row this table can
return carries one, unconditionally. The per-user counter sentinel row stays in `Interval_Changes`
(unchanged location) — it has no key-type conflict with this table, since it isn't part of it.

### Pull semantics (`backend/lambdas/sync-pull`)

`sync-pull` now ALWAYS queries `Interval_ChangeStream`'s own BASE TABLE, with
`ConsistentRead: true`, never a secondary index. `parseCursor` (unchanged from the original
design) decides how to interpret the client-supplied cursor string:

```ts
parseCursor(raw) ->
  | { mode: "full", legacy: false }          // absent/empty — first pull, or an explicit reset
  | { mode: "incremental", seq: N, legacy: false }  // the new format — pull strictly after seq N
  | { mode: "full", legacy: true }           // anything else — see "Migration" below
```

`buildPullQueryParams` turns that into the actual `QueryCommand` input:
`KeyConditionExpression: "PK = :pk"` (full) or `"PK = :pk AND #seq > :cursor"` (incremental),
`ScanIndexForward: true`, `ConsistentRead: true` (both modes — this is the load-bearing half of
the correctness invariant), the client-requested `Limit` (unchanged bounds: default 200, max 500).
No `IndexName` appears anywhere in the output — reintroducing one would reintroduce exactly the
gap this document's "Why not a GSI" section describes. `ownerPk` is always the TRUSTED `U#<sub>`
from the authenticated JWT claims, never derived from the cursor or any other client input.

**Why `ConsistentRead: true` is safe and sufficient here, when it would not be for a GSI.**
Strongly consistent reads are supported for a `Query`/`GetItem` against a table's own primary key
(unlike a GSI) precisely because the base table has no separate, asynchronously-replicated
projection to lag behind — a consistent read observes the same storage the write just committed
to. Combined with the write-side guarantee above (the counter never reflects `N` before `seq=N`'s
row is committed), this read always observes a complete, gap-free prefix of the stream.

`nextCursorForPage` chooses the cursor to return: the last item's own `seq`, stringified. Every
item this table can return carries a numeric `seq` (it's the table's own key, not sparse
membership), so there is no "unkeyable row" edge case to defend against. An empty page keeps the
incoming cursor unchanged (no forward progress claimed).

## Cursor format

A plain string, exactly as before (`PullResponse.cursor: string`, `PullRequest.cursor?: string`)
— **the mobile client's own code did not change at all** for this fix. `src/storage/sync.ts`'s
`getSyncCursor`/`setSyncCursor` always treated the cursor as an opaque string, never parsing or
constructing it; `SyncService.ts` only ever echoes back whatever the server's last response
contained. The backend emits a stringified non-negative integer (e.g. `"42"`) instead of a
pipe-delimited `changeKey` — mobile never needed to know the difference and still doesn't.

## Migration

Two separate things need to migrate, handled two different ways:

1. **Existing CLIENTS holding an old-format cursor string locally.** `parseCursor` treats
   anything that isn't a plain non-negative integer — including the entire old
   `ts|deviceId|entity|id|op` shape — as `legacy: true`, ignores it completely, and performs one
   full replay (every change for that user, oldest `seq` first). The response's own `cursor` is
   then a fresh, valid new-format value, which the client persists via its completely unchanged
   `setSyncCursor` call. **No mobile code change, no stored cursor-version field, no explicit
   negotiation** — every existing client self-heals permanently on its very next pull after the
   backend fix deploys, the same way a `Force Resync` already self-heals today — just
   automatically, exactly once, without the user ever taking that action. There is no infinite
   replay loop: a legacy cursor triggers exactly one full replay, which returns a new-format
   cursor, and every subsequent pull from that point on is `mode: "incremental"`.

2. **Existing CHANGE ROWS already in `Interval_Changes`, from before this fix, which have no
   corresponding row in `Interval_ChangeStream` at all.** Every historical row would otherwise be
   permanently invisible to any pull the moment the new Lambda code goes live. This requires a
   one-time backfill: `backend/scripts/backfill-change-sequence.mjs` (provided, **not run** by
   this batch — see "Rollout" below). For each user, in the best available historical order
   (ascending by the existing `changeKey`, which already sorts by `ts` first — this preserves
   whatever order a device already experienced, it does not change it, it just makes it durable
   going forward), it atomically marks the historical row with its assigned `seq`, advances that
   user's counter, and writes the `Interval_ChangeStream` row — reusing the identical
   atomic-transaction shape as the live push path, but via its OWN independent
   `buildBackfillTransactItems` (deliberately not importing the live path's builder — see that
   script's own comment for why a migration tool's correctness should not depend on the live
   Lambda's internal shape evolving later out from under it).

## Rollout architecture: why a dual-mode Lambda, not a two-step infra/code deploy

An earlier revision of this document described the rollout as "deploy infra only" followed
later by "deploy the new Lambda code." **A deployability audit found that sequencing is not
actually executable with this repository's CDK architecture** and the design below replaces it.

**The problem.** `Interval_ChangeStream`, its IAM grants, and `sync-push`/`sync-pull`'s own code
all live in the SAME CDK stack (`IntervalSyncStack`), deployed by the SAME `cdk deploy` command.
A single stack update synthesizes and updates everything in it together — CloudFormation change
sets apply to the stack as a whole, and there is no supported CDK/CloudFormation mechanism to
update only some resources in a stack while leaving others (here, the Lambda functions' own code
assets) on an older revision. Concretely: by the time anyone runs `cdk deploy` to create the new
table, this repository's checked-in `backend/lambdas/sync-push`/`sync-pull` source is ALREADY the
new, transactional/`ChangeStream`-aware implementation — there is no way to deploy "just the
table and IAM" while that deploy also, unavoidably, ships whatever Lambda code currently exists
in the repository.

**The fix.** The Lambda code itself is dual-mode, selected at runtime by two environment
variables, so "the new code is deployed" and "the new behavior is active" become two separate,
independently-controllable events:

- **`SYNC_CURSOR_MODE`** (`"legacy" | "v2"`, resolved by `resolveSyncCursorMode` in both
  `sync-push/lib.mjs` and `sync-pull/lib.mjs`) — fail-closed to `"legacy"` for anything other than
  the exact literal `"v2"`. `"legacy"` makes both Lambdas behave BYTE-FOR-BYTE like the
  pre-this-fix implementation: `sync-push`'s `appendChangeLogLegacy` writes a plain conditional
  `PutItem` into `Interval_Changes` with no `seq` attribute, no transaction, no
  `Interval_ChangeStream` write at all; `sync-pull`'s `buildLegacyPullQueryParams`/
  `nextLegacyCursorForPage` run the original plain `SK`-ordered query against `Interval_Changes`,
  no `ConsistentRead`. `"v2"` activates the transactional/`ChangeStream` design described above.
- **`SYNC_PUSH_MAINTENANCE`** (`"true" | "false"`, resolved by `resolveMaintenanceMode` in
  `sync-push/lib.mjs` only) — fail-closed to `false` for anything other than the exact literal
  `"true"` (deliberately the OPPOSITE fail-closed direction from cursor mode: an ambiguous value
  must never risk silently freezing every user's writes). `"true"` makes `sync-push` reject EVERY
  push immediately after the auth check, before touching any table, with a safe, explicit,
  retryable `503 {"ok": false, "error": "maintenance", "retryable": true}` — the client's
  existing generic sync-failure handling already retries any non-200 response on its next sync
  attempt, so this requires zero mobile code change, and nothing is ever marked clean or
  discarded. **`sync-pull` has no maintenance mode of its own and is never blocked by it** — reads
  are harmless during the freeze (the backfill's correctness only depends on no NEW writes
  landing in `Interval_Changes`, not on reads stopping), and continue being served from whichever
  `SYNC_CURSOR_MODE` is currently active.

Both flags are read from CDK context (per-environment keys —
`development`/`stagingSyncCursorMode`, `development`/`stagingSyncPushMaintenance`), resolved
fail-closed a SECOND time inside `IntervalSyncStack` itself (`resolveSyncCursorModeContext`/
`resolveSyncPushMaintenanceContext` in `infra/lib/interval-sync-stack.ts`), and PERSISTED with
safe defaults (`"legacy"`/`"false"`) in `infra/cdk.json`'s committed `context` block — not left to
be remembered on an ad-hoc CLI flag. This is deliberate: a routine, unrelated future
`cdk deploy IntervalDevelopmentStack` (no extra flags — e.g. bumping Lambda memory for an
unrelated reason) must never silently revert an already-completed cutover, and must never
silently activate one that hasn't happened yet. Once a transition is confirmed good, its value is
PROMOTED into `cdk.json` (edited and committed) so every future plain deploy preserves it — a
`-c key=value` override is for the one-off transition moment itself, not a standing config
mechanism. Development and Staging use distinct context key names, so one environment's
transition can never affect the other. **No AppConfig, no new service, no control plane** — this
is ordinary CDK context, the exact mechanism `docs/environment-config-contract.md`'s own
`INTERVAL_ENV` convention already established the precedent for (a different, client-side system,
not to be confused with this one).

## Rollout: exact command-level sequence

The deployment order is explicit and is a **write freeze**, enforced in code via
`SYNC_PUSH_MAINTENANCE`, not merely an ordering of deploy steps — see "Backfill race and required
write freeze" below for exactly why a freeze, not just step ordering, is required. Every command
below targets ONE environment (`IntervalDevelopmentStack`/`developmentSyncCursorMode` etc. —
substitute `IntervalStagingStack`/`staging...` for Staging; the two are never flipped together).

```sh
# 1. Deploy infra + the new dual-mode Lambda code — INERT by default (cdk.json's committed
#    context already has developmentSyncCursorMode=legacy, developmentSyncPushMaintenance=false,
#    so no extra flags are needed or should be passed here). Creates Interval_ChangeStream and
#    its IAM grants; sync-push/sync-pull behave exactly as before this deploy.
cd infra
npx cdk deploy IntervalDevelopmentStack

# --- Verify: ordinary sync still works exactly as before this deploy (founder smoke test). ---

# 2. Freeze sync-push. sync-pull is unaffected and keeps serving legacy reads.
npx cdk deploy IntervalDevelopmentStack -c developmentSyncPushMaintenance=true

# --- Verify: a push now returns 503 {"ok":false,"error":"maintenance","retryable":true}.
#     A pull still returns 200 with the existing history. ---

# 3. Run the backfill. This single command also runs the convergence-verification loop and the
#    post-convergence integrity check automatically, and exits non-zero (never reporting false
#    success) if either fails — see "Backfill race and required write freeze" below.
node backend/scripts/backfill-change-sequence.mjs \
  --table interval-dev-changes \
  --stream-table interval-dev-change-stream \
  --region us-east-2 \
  --execute

# --- Verify: the script's own final line is
#     "[backfill] integrity verified — ... Safe to deploy the new Lambda code next."
#     and its exit code is 0. Do not proceed past this point otherwise. ---

# 4. Cut over SYNC_CURSOR_MODE to v2 — WHILE STILL FROZEN, so a problem here is caught before any
#    new write can be affected by it.
npx cdk deploy IntervalDevelopmentStack \
  -c developmentSyncCursorMode=v2 -c developmentSyncPushMaintenance=true

# --- Verify: a pull against a known test account now returns a numeric cursor and the expected
#     full history (manual smoke test — this is the first real exercise of the v2 read path
#     against this environment's actual backfilled data). ---

# 5. Unfreeze.
npx cdk deploy IntervalDevelopmentStack \
  -c developmentSyncCursorMode=v2 -c developmentSyncPushMaintenance=false

# 6. Promote the now-confirmed-good values into committed config, so a FUTURE plain
#    `cdk deploy IntervalDevelopmentStack` (no -c flags at all) can never silently revert the
#    cutover. Edit infra/cdk.json: set "developmentSyncCursorMode": "v2" (leave
#    "developmentSyncPushMaintenance": "false" as it already is). Commit this change.

# 7. Founder QA: ordinary incremental sync, two-device convergence, Force Resync — see
#    "Founder QA" below.
```

**Development:** code (infra + dual-mode Lambda + backfill script) is ready and tested locally;
NONE of the above steps have been performed. **Staging:** later, after Development's multi-device
validation passes — same sequence with `staging`-prefixed names, real external beta-tester data
makes the freeze/backfill non-optional and worth extra operational care. **Production:**
explicitly out of scope — not CDK-managed, no deployment or enablement of any kind occurred or is
proposed here; `SYNC_CURSOR_MODE`/`SYNC_PUSH_MAINTENANCE` have no meaning there at all.

### Backfill race and required write freeze

A review of an originally-proposed order (deploy infra → backfill → deploy new Lambda, with no
explicit freeze) found a real race: if `sync-push` is still accepting writes WHILE the backfill
scans `Interval_Changes`, a row written in the gap between the backfill's scan and its own write
phase is a **straggler** — never seen by that backfill pass, and (since it was written with no
`seq` at all) nothing will ever revisit it once the counter advances past it. That row would be
**permanently** stranded outside the ordered stream — the exact failure this whole fix exists to
prevent, reintroduced by the migration tool itself.

A SECOND review found that the freeze itself could not be more than a documented operational
promise with the rollout design as it stood then — nothing in the code could actually enforce or
verify it. `SYNC_PUSH_MAINTENANCE` (see "Rollout architecture" above) closes that gap: the freeze
is now a real, code-enforced rejection (`503`, before any table is touched), not something that
depends on a human remembering to disable a route correctly. The correction has two layers:

1. **Primary mechanism — `SYNC_PUSH_MAINTENANCE=true`** (step 2 of the command sequence above).
   This is the mechanism that actually *guarantees* no straggler can be written during the
   backfill — enforced in `sync-push`'s own code (`createHandler`'s maintenance check, checked
   immediately after auth, before any DynamoDB access), not merely documented as a step to
   remember. Tested: `dual-mode: maintenance mode rejects every push with a safe, retryable 503
   and writes NOTHING` (`backend/lambdas/sync-pull/cursorHardening.test.mjs`).
2. **Defense in depth — the convergence-verification loop** (step 3, `runConvergenceLoop`): scan,
   backfill everything found, re-scan; if the re-scan finds NEW unmigrated rows (meaning something
   wrote during the pass — the freeze was not actually in effect), repeat. Bounded at
   `DEFAULT_MAX_PASSES` (5) passes. If stragglers keep appearing every single pass — modeling
   writes that were never actually frozen — the loop returns `converged: false` and the script
   **exits non-zero**, with an explicit message to confirm the freeze and re-run. It never reports
   success on a non-convergent run (tested:
   `runConvergenceLoop: non-converging backfill ... fails loudly after maxPasses, never reporting
   false success`, `backend/scripts/backfill-change-sequence.test.mjs`).

Tested explicitly that a straggler written mid-pass (simulating an imperfect freeze) IS caught by
a subsequent pass (`runConvergenceLoop: a straggler written mid-run ... is caught by a later
pass`), and that every individual backfill write is itself idempotent/safe to re-run (a prior
partial run's already-migrated rows are skipped, never double-assigned).

## Backward compatibility

An old mobile client (holding an old-format cursor, or none at all) can talk to the new backend
with zero changes and zero awkwardness — handled entirely by `parseCursor`'s legacy detection
(case 1 under "Migration"). There is no API shape change (`PullRequest`/`PullResponse` are
unchanged), no version field, and no need to "strand" or specially handle any client version. The
one awkward window is the deployment-order/write-freeze constraint above — not a client
compatibility problem, an operational sequencing one, and one that only the founder performing the
rollout experiences, never an end user.

## Duplicate delivery / idempotency

Already-idempotent on the client (unchanged by this batch — audited, not modified):

- Decks/cards/sessions/library records: `incomingWins` (rev, then `updatedAt` tie-break) —
  re-delivering an already-applied change re-applies identical data, harmlessly.
- `ReviewEvent`: pure existence check by content-addressed id (`mergeIncomingReviewEvents`) — a
  duplicate is a true no-op.
- `GeneratedCardProvenance`: rev-based merge (`mergeGeneratedCardProvenance`) — same idempotent
  shape as the mutable-entity case.

On the server, a retried push of the exact same change (same deterministic `changeKey`) still
cancels the ENTIRE transaction at the idempotency-row condition — meaning the counter and the
stream row are both untouched, not merely "harmlessly re-incremented and discarded" as an earlier
revision of this fix produced. A retried push wastes zero sequence numbers (tested:
`assignSequenceAndAppendChangeLog: a benign duplicate ... wastes ZERO sequence numbers`).

**Where duplicate delivery is a given, not an edge case:** re-pulling from an older cursor (e.g.
after a migration-triggered full replay, or a client that never persisted its new cursor before
crashing) re-sends already-seen changes. This is explicitly the preferred failure mode — "duplicate
delivery is preferable to missed delivery" — and is exactly what makes the client-side idempotency
above load-bearing, not incidental.

## Pagination

Unchanged shape: one pull = one page; the client decides whether to call again (comparing the
returned page size to the requested limit, same `hasMore` signal as before). `sync-pull` never
uses `LastEvaluatedKey`-based internal pagination — "the next page" is simply "call pull again
with the new cursor." If a client crashes after receiving a page but before persisting its new
cursor, re-pulling with the OLD cursor safely re-returns the same page (a strongly-consistent
query against a base table is stateless and repeatable) — never a gap, never a corrupted position.

## Failure / fail-closed behavior

- If `sync-push`'s record-snapshot update succeeds but the subsequent sequence-assignment
  transaction fails for any reason other than a benign duplicate (including exhausting
  `MAX_SEQUENCE_ASSIGNMENT_ATTEMPTS` under contention), the record is NOT acknowledged — the
  client keeps it dirty and retries (unchanged "torn state → retry" invariant; every write
  involved is safely retriable, and a retry's own idempotency-row condition correctly detects
  whether an earlier attempt actually landed).
- If `sync-pull`'s DynamoDB query itself fails, a sanitized 500 is returned and the client's
  cursor is never advanced (the client's own envelope validation, unchanged, already refuses to
  persist a cursor from a non-200 or malformed response).
- A legacy/malformed cursor is never a 500 — `parseCursor` always resolves it to a well-defined,
  safe `"full"` mode rather than throwing or passing garbage into a query expression.
- The backfill script never reports success while unmigrated rows remain — see "Backfill race and
  required write freeze" above.

## Recovery / full replay

Full replay (an absent/empty cursor — including the automatic one-time legacy-cursor case above,
and the existing `Force Resync` flow, `src/storage/devReset.ts`'s `forceFullResyncPrep`, which
deletes the locally stored cursor) remains exactly what it was: a recovery tool, not the normal
correctness mechanism. After this fix, incremental sync converges correctly for the bug's own
scenario WITHOUT needing a full replay — full replay stays available for genuine corruption
recovery, migrations, and diagnostics, unchanged in mechanism.

## Entity-agnosticism

Nothing here is specific to any entity type. `sync-push`/`sync-pull` have never known or cared
what `entity` string a change carries — decks, cards, sessions, `librarySource`,
`sourceCollection`, `reviewEvent`, `generatedCardProvenance`, and any future entity type all flow
through the identical transactional seq-assignment and strongly-consistent-query path. The
integration test suite (`backend/lambdas/sync-pull/cursorHardening.test.mjs`) explicitly
reproduces the original bug and proves the fix for three different entity-type strings via the
exact same code path.

## Security

- `ownerPk` is always the trusted `U#<sub>` derived from authorizer claims — never read from the
  cursor, the query string, or any other client-supplied value. No cursor value can cause
  cross-user access or arbitrary partition traversal.
- The cursor is validated strictly (`/^\d+$/`, then `Number.isSafeInteger`) before ever being
  used in a query expression. DynamoDB's parameterized `ExpressionAttributeValues` already
  prevents expression-string injection regardless; the strict check is defense-in-depth and
  avoids a confusing `ValidationException` from a malformed value.
- The cursor is not signed/encoded — it carries no authority of its own (a forged cursor value
  can only ever affect pagination position within the caller's OWN already-authenticated
  partition, never which partition is queried), so signing would add complexity with no
  corresponding security benefit here.

## Observability

Safe, aggregate-only logs added: `sync-pull` logs `cursorMode`/`legacyCursor` (never the raw
cursor value) on every call. The backfill script logs only counts, truncated PKs, and seq values
— never a change row's own `record` payload. No source text, card/question content, auth tokens,
or full record payloads are ever logged by either Lambda — unchanged from before this batch.

## Infrastructure impact

- **New:** one dedicated table, `Interval_ChangeStream` (Development/Staging via CDK; PK=String,
  SK=`seq` Number, `PAY_PER_REQUEST`). IAM on the existing shared sync Lambda role:
  `dynamodb:GetItem`/`PutItem`/`UpdateItem`/`Query`/`TransactWriteItems` on `Interval_Changes`'s
  own ARN (`Query` restored for `sync-pull`'s LEGACY read path — both Lambdas are now dual-mode
  and the shared role grants the union of what either mode's code path can do), and
  `dynamodb:PutItem`/`TransactWriteItems`/`Query` on `Interval_ChangeStream`'s own ARN. No
  `/index/*` resource appears anywhere in this role — there is no secondary index on the
  authoritative path left to query. Two new Lambda environment variables on `sync-push`
  (`SYNC_CURSOR_MODE`, `SYNC_PUSH_MAINTENANCE`) and one on `sync-pull` (`SYNC_CURSOR_MODE`; it
  also regained `CHANGES_TABLE`, needed for its legacy read path), sourced from new per-
  environment CDK context keys (`development`/`stagingSyncCursorMode`,
  `development`/`stagingSyncPushMaintenance`), persisted with safe defaults in `infra/cdk.json`
  — see "Rollout architecture" above. `npx cdk synth` for both `IntervalDevelopmentStack` and
  `IntervalStagingStack` verified clean with and without `-c` overrides; `npx tsc` (`infra/`)
  clean.
- **Unchanged:** `Interval_Records` table, Records-table conflict logic, Cognito, API Gateway
  routes, Lambda memory/timeout, every other resource in the stack.
- **Production is not touched at all** — not CDK-managed, no deployment occurred, no mutation of
  any kind was performed against any live AWS account by this batch. `SYNC_CURSOR_MODE`/
  `SYNC_PUSH_MAINTENANCE` have no meaning there — Production's Lambdas are not this repository's
  dual-mode code at all.

## Known limitations

- The backfill script orders historical rows by their existing `changeKey` (i.e. by original
  `ts`) — this is the BEST available signal, not a guarantee of true real-world ingestion order
  for data that predates this fix (that information was never captured). Every change from this
  fix forward has a REAL, accurate ingestion-order `seq`; only the one-time backfill's ordering
  of pre-existing history is a best-effort approximation.
- No request-level idempotency key exists yet (a pre-existing, separately-documented gap — see
  `docs/ai-generation-foundation.md`'s own "no request-level idempotency" note for the analogous
  AI-generation-side limitation) — a client retry of a push whose original request already
  succeeded server-side is still only protected by the deterministic `changeKey` conditional
  put, exactly as before this batch; this fix does not add or remove any idempotency guarantee
  beyond what already existed.
- `assignSequenceAndAppendChangeLog` adds one `GetItem` round trip per change on push (before the
  transaction attempt) — acceptable at this app's current scale (per
  `docs/aws-current-state-audit.md`, on the order of a few hundred change rows total in Production
  historically), not re-benchmarked at a materially larger scale. Sustained, high-frequency
  contention for the SAME user's counter (many devices pushing simultaneously) would increase
  retry traffic under `MAX_SEQUENCE_ASSIGNMENT_ATTEMPTS`, but has not been load-tested — not a
  realistic concern at this app's current beta scale.
- The freeze ITSELF is now code-enforced (`SYNC_PUSH_MAINTENANCE=true` — see "Backfill race and
  required write freeze" above), but REMEMBERING to engage it before running the backfill, and
  to disengage it in the documented order afterward, remains a founder-performed operational
  step — there is no automated orchestration tying the `cdk deploy -c ...=true` command to the
  backfill script's own invocation. The convergence loop and integrity check are the defense-in-
  depth that catches the specific case where this step was skipped or mistimed; they are not a
  substitute for actually running it.
- Dual-mode rollout control (`SYNC_CURSOR_MODE`/`SYNC_PUSH_MAINTENANCE`) is plain CDK context,
  persisted in `infra/cdk.json` and overridable per-deploy via `-c`. It has no audit trail beyond
  ordinary git history (a context-value change is a one-line diff in `cdk.json`, or an ephemeral
  CLI argument that leaves no record at all if never promoted into that file) and no automated
  "who changed this and when" tracking beyond what `git log` on `cdk.json` already provides.

## Founder QA

See the delivery report for this batch's proposed two-device Development plan.
