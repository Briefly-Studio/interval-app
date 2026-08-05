# Sync Invariants — Multi-Device & Data Integrity V1

This document defines the required behavior of Interval's offline-first synchronization
system. It exists so that future changes to `src/cloud/sync/**`, `src/storage/**`, or
`backend/lambdas/sync-*` can be checked against a fixed, testable contract rather than
re-derived from scratch each time.

An invariant is only considered enforced once a deterministic test in the automated
harness proves it. Several invariants below are annotated with their enforcement point
(client, backend source, or both) — see "Live Backend Parity Status" in the batch report
for which backend behaviors are verified from source only versus actually deployed.

## Conflict model

Interval does not implement a CRDT. Every record (`DeckRecord` / `CardRecord` /
`SessionRecord`) carries a per-record `rev` (integer, incremented by the client on every
local mutation — edit, delete, or restore) and `updatedAt` (ISO timestamp, client-set).

Conflict resolution is **last-writer-wins by revision, with `updatedAt` as a tie-break
only when revisions are equal**:

- Given an existing (locally or remotely stored) record and an incoming candidate for
  the same id: the incoming candidate is applied only if `incoming.rev > existing.rev`,
  or (`incoming.rev === existing.rev` and `incoming.updatedAt` is not older than
  `existing.updatedAt`).
- A strictly lower incoming `rev` is never applied, regardless of `updatedAt` — this is
  what makes the model revision-based rather than wall-clock-based, and is what
  protects against client clock skew between devices.
- A delete is an ordinary mutation that bumps `rev` like any other edit — a tombstone
  therefore naturally outranks any live edit at or below its revision, and is naturally
  outranked by a later restore (which itself bumps `rev` again). Tombstones are never
  special-cased out of this comparison.

This is deliberately the smallest deterministic model that satisfies the invariants
below without vector clocks or per-device revision tracking. Its known limitation: two
devices independently reaching the same `rev` for the same record (rare — requires the
same number of prior edits on both sides before either synced) falls back to
`updatedAt`, which re-introduces a wall-clock dependency for that narrow case only. This
is accepted as an explicit, documented tradeoff rather than solved with additional
complexity.

## Invariants

1. **Every record belongs to exactly one authenticated workspace.** Enforced by
   `scopedKey()` — every storage key is namespaced by `WorkspaceScope` (`guest` or
   `user:<sub>`), never by device.
2. **Guest records never enter an authenticated workspace implicitly.** Guest and
   `user:<sub>` storage keys are structurally distinct (`scopedKey` prefixes `u.<sub>.`
   only for `user` scope); there is no code path that copies or migrates guest-scoped
   data into a signed-in scope.
3. **Push and pull operations are safe to retry.** Push: the backend's Changes-table
   append is a conditional put keyed by a deterministic `changeKey`
   (`ts|deviceId|entity|id|op`), so a retried identical push is a no-op on that table;
   the Records-table upsert is idempotent in effect (re-writing the same data changes
   nothing observable). Pull: cursor only advances after `applyChanges` completes
   without throwing, so an interrupted pull is safe to re-issue with the same cursor.
4. **Duplicate changes do not create duplicate records.** All records are stored keyed
   by `id` in a `Map`, both in `applyChanges` (pull) and in the Records table (backend);
   applying the same change twice is a no-op the second time.
5. **A stale device cannot silently overwrite a newer revision.** Enforced on the pull
   side by the rev-based comparison in `applyChanges` (client). Enforced on the push
   side by a `ConditionExpression` on the Records-table `UpdateCommand` requiring
   `incoming.rev >= stored.rev` or the item not existing yet (backend source — **not
   yet verified against the deployed Lambda**, see Live Backend Parity Status).
6. **Tombstones participate in conflict resolution.** A delete is not filtered out of
   the rev/updatedAt comparison — it wins or loses exactly like any other mutation.
7. **Restoring an item creates a newer valid state rather than reviving stale data.**
   Every restore path (`restoreCardToDeck`, deck restore) bumps `rev` past the
   tombstone's own `rev`, so a restore is itself a legitimate higher-revision write, not
   a revival of old data.
8. **A child cannot be restored into a deleted or missing parent without the documented
   recovery behavior.** `resolveCardRestoreTarget` classifies the parent deck as
   `activeDeck | deletedDeck | missingDeck | corrupted` before any restore UI is shown;
   `missingDeck` routes through `getOrCreateRecoveryDeck`, never a silent restore into
   nothing.
9. **A successfully acknowledged local revision becomes clean only when the
   acknowledgment corresponds to that exact revision.** `markClean` now compares the
   currently-stored record's `rev` against the `rev` that was actually included in the
   push payload for that id, and only clears `dirty` on an exact match.
10. **A record modified again during an active sync remains dirty.** Direct consequence
    of #9: if the user edits a record again (bumping `rev`) after it was read into the
    outgoing push payload but before the push response is applied, the stored `rev` no
    longer matches the acknowledged `rev`, so `markClean` leaves it dirty and it is
    retried on the next sync.
11. **Cursors never move backward.** The client only ever persists a cursor value taken
    directly from a successful pull response, and only when non-empty; there is no
    client-side cursor construction. The backend's Changes-table query is
    `ScanIndexForward: true` against a monotonically-increasing `SK`, so cursor values
    it hands out are themselves non-decreasing (verified from source only).
12. **Failed or partial syncs do not discard unsent local changes.** Rejected and
    not-yet-pushed records are never included in `markClean`'s id list; a thrown
    error anywhere in `runSync` leaves all dirty flags exactly as they were.
13. **Account switching cannot leak changes across workspaces.** `runSync` captures
    `scope` once at the start and re-checks the active scope (`sameScope`) before
    applying pulled changes and before marking push results clean; a mismatch aborts
    the apply step for that run entirely rather than writing into the wrong scope.
14. **Force Resync cannot destroy valid unsynced local work silently.** Redesigned this
    batch: Force Resync now requires a real sync attempt first; if dirty records remain
    afterward (rejected, offline, or otherwise unresolved), it refuses to wipe local
    data and shows a clear, localized explanation instead.
15. **Sync state shown to users reflects actual engine state.** `pendingDirtyCount` is
    now recomputed by rescanning storage after apply, rather than derived from a fixed
    arithmetic expression that could drift from reality when a rejected record is later
    superseded by a newer pulled change.
16. **No sync path logs study content, profile data, tokens, raw errors, or payloads.**
    Both client (`getSyncDiagnosticCode`) and backend (`console.log` sites in both
    Lambdas) log only a fixed string or a stable, sanitized code — never a raw `Error`
    object, response body, or record content.

## Known limitation: same-millisecond changeKey ordering

Discovered while building this batch's multi-device test harness (a deterministic fake
clock was required to eliminate real-time flakiness in the tests themselves — see the
test file's `installFakeClock` for why).

Both `backend/lambdas/sync-push/index.mjs` and this document's mock-remote test double
build each change's identifier (`changeKey`/SK) as
`${change.ts}|${deviceId}|${entity}|${id}|${op}`, where `ts` is the client-supplied
`record.updatedAt`. When two changes share the **exact same millisecond** timestamp —
plausible if two records are edited in the same JS event-loop tick, or if two devices
happen to push at the same instant — the tie-break is a plain alphabetical comparison
of `entity` (`"card" < "deck"`). A cursor computed from the last item in a
same-millisecond batch can therefore sort *ahead of* a different same-millisecond
change that has not yet been delivered to a given device, and a subsequent pull using
that cursor will silently and permanently skip it.

This is a real, proven limitation (see the dedicated "KNOWN LIMITATION" test in the
automated suite), not a hypothetical one. It was **not** structurally fixed in this
batch: a correct fix requires a server-assigned monotonic sequence number (or
equivalent), which changes the Records/Changes table SK format and needs a carefully
tested, deployed migration this batch is not authorized to perform (no AWS changes,
no deployment). Classify this as **requires future deployment** — see the batch
report's Live Backend Parity Status and future deployment checklist.

In practice, ordinary user-driven edits (separated by real human interaction time)
essentially never collide at millisecond precision, so this is a low-probability edge
case rather than a routine failure mode — but it is a real gap, and is documented here
rather than silently accepted.

## Known limitation: no conflict UI for concurrent multi-device edits

The "Conflict model" section above and invariant #5 describe a real, deterministic
guarantee: given two candidate revisions of the same record, the system always resolves
to the same winner, and a strictly-lower incoming `rev` can never overwrite a strictly-
higher one. That guarantee is about **system consistency** — it does not mean a user
can never lose an edit.

**Exact user risk.** Suppose a record is at `rev 5` when Device A goes offline and
edits it locally (still `rev 5` on the server, A's local copy queues the edit dirty).
Meanwhile Device B, already synced, edits the same record and successfully pushes it —
the server is now at `rev 6`. When Device A reconnects and syncs: its push is rejected
(the server's `ConditionExpression` requires `incoming.rev >= stored.rev`, and A is
still proposing based on the old `rev 5`), and A's own edit stays dirty (per invariant
#12) — so far so correct. But A's very next pull step applies B's `rev 6` record via
the same `incomingWins` rev comparison, which — because a pull-side apply does not
re-check whether the local dirty copy represents unsent work worth protecting — writes
B's version over A's local storage. A's own edit, from A's user's point of view, has
now vanished. Nothing in the product surfaces this: no conflict prompt, no "your edit
couldn't be saved" notice, no backup copy of what A typed. The system did exactly what
its rev-based contract promises (a lower revision never wins), but the human
consequence — a real edit, silently gone — is not something today's UI communicates at
all.

**Why this is accepted for the current small beta.** The founder/product decision for
this beta is that a rev-only, no-merge model is the right amount of complexity for a
small, mostly-single-device beta cohort, and that building conflict UI or field-level
merge logic now would be premature relative to actually seeing how often (if ever) this
occurs in practice. This is an accepted, known risk, not an oversight, and not
considered solved.

**What future resolution could involve**, roughly in order of how much new
infrastructure each requires:
- Surfacing a plain-language "this device's change may have been overwritten by
  another device" notice in Sync Status (or similar) when a locally dirty record is
  about to be superseded by a pulled change with a higher `rev`, so the loss is at
  least visible rather than silent.
- Keeping a local, non-syncing backup copy of a losing edit (a "conflict copy"),
  recoverable by the user, without attempting to merge it automatically.
- An explicit conflict-resolution UI letting the user choose which version to keep, or
  manually reconcile the two.
- Server-side version history (rather than a single current revision per record),
  giving the client something to actually resolve against instead of only the latest
  state.
- Device metadata (which device made which change, and when) as supporting evidence
  shown to the user during resolution — but never as the resolution mechanism itself.

**Timestamps alone must not silently replace revision correctness.** Any future work
here must preserve the existing rule that a strictly lower `rev` never wins regardless
of `updatedAt` (see "Conflict model" above) — `updatedAt` may inform what a user is
shown, but re-introducing wall-clock comparison as the primary conflict rule would
reopen the exact clock-skew problem the rev-based model exists to close.

This remains a known, documented beta risk — not a solved problem, and not something
this batch attempted to fix. See the V3.0 stabilization audit for how this was
originally identified.
