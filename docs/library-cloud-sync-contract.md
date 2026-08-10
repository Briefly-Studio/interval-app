# Library Cloud Sync Contract

**Status: specification only — not implemented.** No cloud Library persistence exists anywhere in
this repository today. This document defines how Library metadata cross-device sync **must**
work once it is actually built, which itself requires Development AWS infrastructure to exist
first (`docs/environment-separation-plan.md`). It resolves the "a dedicated protocol is likely
needed" item `docs/library-and-source-architecture.md` §12 flagged but left open, for the metadata
layer specifically — see "What this contract explicitly does not cover" below for what it does
not resolve.

## Why this document exists now

A founder multi-device QA pass surfaced the expected, code-confirmed behavior: Library sources and
collections created on one device are completely absent on another device signed into the same
account. See `docs/library-cross-device-diagnosis.md` for the full root-cause trace. This document
is the forward-looking companion to that diagnosis — not an implementation, a contract for the
implementation to satisfy later.

## Scope: metadata only — the three-way distinction this contract does not conflate

| Layer | Example | This contract covers it? |
|---|---|---|
| **Cloud-syncable Library metadata** | title, type, tags, course, collection membership, status | **Yes — this is the entire subject of this document.** |
| **Source binary/file storage** | the actual PDF/audio/document bytes | **No.** Explicitly future, secure-upload work — see `docs/library-and-source-architecture.md` §7/§11. This contract assumes no binary exists to sync; `LibrarySourceRecord` today has no field capable of holding one (see that model's own file header). |
| **Derived AI artifacts** | AI-generated decks/summaries from a source | **No.** Depends on both binary storage and AI generation existing first (§10 of the architecture doc) — out of scope here and out of scope for this entire mission. |

Metadata syncing does not require binary storage or AI generation to exist first — a source's
*description* ("Calculus Chapter 3 PDF, 12 pages, tagged midterm") is independently useful to sync
across devices even before Interval can store or process the file itself. That's what this
contract enables; nothing more.

## Cross-device requirement

**The founder expectation, restated as a contract:** the same authenticated Cognito account,
signed into two devices, must eventually see the same Library metadata on both — same sources,
same collections, same collection membership, same deletions — the same cross-device consistency
guarantee `docs/sync-invariants.md` already provides for decks/cards/sessions, applied to this new
entity family rather than reinvented for it.

## Entities

Two new syncable entity types, alongside the existing `deck` / `card` / `session`:

- `librarySource` — one row per `LibrarySourceRecord`.
- `sourceCollection` — one row per `SourceCollectionRecord`, including collection membership
  (`LibrarySourceRecord.collectionIds`, which travels as part of the source's own record, the same
  way it already works locally — no separate join-table entity needed).

## Ownership

**Cognito `sub`, from trusted authorizer claims only — never from client input.** Identical rule
to the existing sync backend (`backend/lambdas/sync-push/index.mjs`'s `getUserSub`,
`backend/lambdas/sync-pull/index.mjs`): a future Library sync Lambda must derive the owning `sub`
only from `event.requestContext.authorizer.jwt.claims.sub` (or the REST-API equivalent), never
from a request body or query parameter. `CLAUDE.md`'s "Never accept the user ID from the request
body or query parameters" applies here exactly as it does to decks/cards/sessions today.

## Revision/conflict model

**Reuse `docs/sync-invariants.md`'s existing model verbatim — do not invent a second one.**

- Every synced Library record carries `rev` (integer, client-incremented on every local mutation)
  and `updatedAt` (client-set ISO timestamp) — both fields already exist on
  `LibrarySourceRecord`/`SourceCollectionRecord` today, unused by any sync path yet.
- Conflict resolution: last-writer-wins by `rev`, with `updatedAt` as a tie-break only when
  revisions are equal — identical to the existing invariant #5/"Conflict model" section.
- A strictly lower incoming `rev` is never applied, regardless of timestamp — same clock-skew
  protection as decks/cards.
- The same known, accepted limitation applies: this is not a CRDT, and concurrent edits to the
  same record on two offline devices can still silently supersede one another with no merge UI —
  see `docs/sync-invariants.md`'s "Known limitation: no conflict UI for concurrent multi-device
  edits" section. Nothing about Library metadata makes this limitation better or worse than it
  already is for decks; it is inherited, not newly introduced.

## Tombstones / deletion behavior

Identical shape to decks/cards: a delete is a mutation that sets `deletedAt`, bumps `rev`, and
participates in the same rev/updatedAt conflict comparison as any other change — never
special-cased out of it. `softDeleteLibrarySource`/`softDeleteSourceCollection` already produce
exactly this shape locally today; a sync layer would push that same tombstone record rather than a
distinct "delete" concept. Restoring a source/collection is, as with decks, itself a higher-`rev`
write, never a revival of stale data.

## Local cache / offline behavior

Same boundary `docs/library-and-source-architecture.md` §12 already defines: cached Library
metadata (the index — titles, types, collection membership, status) is exactly the kind of small,
frequent, textual delta the existing dirty-flag/queue/sync-when-online pattern already handles
well for decks/cards. A metadata edit made offline queues (`dirty: true`, already the field's
purpose) and syncs on the next successful `runSync`, using the same push/pull/apply/cursor shape
`SyncService.ts` already implements — not a new mechanism.

## Guest behavior

**Unaffected — guests keep exactly what they have today.** Local-only Library metadata for a
guest workspace (`WorkspaceScope = { kind: "guest" }`) continues to exist purely on-device,
scoped through the existing `scopedKey` mechanism, with no cloud counterpart. This contract only
describes what happens once a source/collection is adopted into an authenticated account — it does
not require guests to have an account, and does not change guest Library behavior in any way.

## Guest-to-account migration is explicitly out of scope here

**Deliberately not resolved by this document.** `docs/library-and-source-architecture.md` §18
already tracks "how a guest's local, pre-account source material is offered to, and adopted into,
a newly signed-in account" as an open, unresolved item (see that section's "What remains
unresolved"). This contract does not attempt to resolve it either — a future migration mechanism
is a separate, explicit product/architecture decision, not something this document's scope covers
or should be read as quietly deciding.

## No direct Production experimentation

Per this mission's and `CLAUDE.md`'s standing rules: implementing anything in this contract means
new DynamoDB access patterns (or a new table), a new/extended Lambda, and a schema this repository
has never deployed before. None of that touches the existing Production `Interval_Records`/
`Interval_Changes` tables' deck/card/session data — but even so, per
`docs/environment-separation-plan.md`, this work is sequenced to happen against a **Development**
environment first, once one exists, never developed or tested directly against the live Production
backend. This document specifies the contract the future implementation must satisfy; it does not
authorize building or deploying it.

## What this contract explicitly does not cover

- Source binary/file upload, storage, or retrieval (future, secure-upload-gated work).
- Server-side extraction, AI generation, or Canvas synchronization (§7–§10 of the architecture
  doc) — all depend on binary storage existing first, which this contract does not provide.
- Guest-to-account adoption/migration mechanics (§18 of the architecture doc, explicitly open).
- Whether Library sync uses the *same* `/sync/push`/`/sync/pull` routes as decks/cards or a
  dedicated protocol — `docs/library-and-source-architecture.md` §12 already flags that forcing
  large binaries into the existing small-delta change-log model is likely the wrong fit for
  *files*, but metadata-only records are much closer in shape to what that model already handles
  well. Which approach to take is a future implementation-phase decision, not resolved here.
