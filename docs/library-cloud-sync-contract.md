# Library Cloud Sync Contract

**Status: implemented and founder-QA verified end-to-end in Development.** The client-side sync
engine (`src/cloud/sync/**`) and local model layer (`src/models/librarySource.ts`,
`src/models/sourceCollection.ts`) handle `librarySource`/`sourceCollection` exactly as this
contract specifies, gated behind `src/cloud/sync/libraryMetadataSyncCapability.ts` so it is only
active when `INTERVAL_ENV === "development"` (see "Rollout gate" and "Implementation status"
below). No backend Lambda code changed (it was already entity-agnostic — see "No direct Production
experimentation" below), and no AWS resource was created, modified, or deployed for this feature —
it runs entirely against the pre-existing, already-deployed `IntervalDevelopmentStack`.

**Founder QA verification (Development, physical iPhone via Expo Go + iOS Simulator):** Dev Tools
correctly reported the Development environment and an Enabled sync capability; the Library source
dirty count transitioned correctly after sync; source metadata created on one device appeared on
the other; source rename, archive/unarchive, and delete/restore all propagated cross-device;
source collections and collection membership synchronized correctly; deleting a collection did not
delete its underlying sources; an offline mutation converged correctly after reconnect; repeated
Force Resync succeeded; ordinary deck/card/session sync remained healthy throughout; account
isolation remained intact; source binaries/content were not synced (none exist yet — see
`docs/library-and-source-architecture.md` for the follow-on storage batch); and no unexpected
Staging or Production Library cloud sync occurred. This is the feature's Development rollout
gate working as designed, verified against real devices, not just repository inspection.

This document defines how Library metadata cross-device sync works. It resolves the "a dedicated
protocol is likely needed" item `docs/library-and-source-architecture.md` §12 flagged but left
open, for the metadata layer specifically: the implementation reuses the existing
`/sync/push`/`/sync/pull` routes rather than a dedicated protocol — see "What this contract
explicitly does not cover" below for what remains genuinely unresolved.

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

## Rollout gate (Development-only for this batch)

Library metadata cloud sync is enabled only when `isLibraryMetadataCloudSyncEnabled()`
(`src/cloud/sync/libraryMetadataSyncCapability.ts`) returns true — currently only when
`getEnvironmentConfig().environment === "development"`. This is the single, centralized decision
point; nothing else in the codebase independently checks `INTERVAL_ENV` for this feature. It gates
exactly two call sites in `src/cloud/sync/SyncService.ts`:

- `collectDirty` — a Staging/Production-pointed build never collects dirty Library records for
  push in the first place. This is the primary, structural protection: no Library metadata can
  ever leave the device unless this returns true at push time.
- `applyChanges` — if a Library change somehow arrived in a pull response while disabled, it is
  silently ignored (not written locally, not logged as a warning) rather than applied. Defense in
  depth alongside the push-side gate, not the primary mechanism.

`markClean` needs no separate gate: when the capability is off, `collectDirty` never included
Library entities in the outgoing push, so the acknowledged-revisions map for those entities is
always empty, and `markClean`'s own early-return on an empty map makes it a no-op naturally.

Enabling Staging and, later, Production is expected to be a small, deliberate, founder-approved
change to `ALLOWED_ENVIRONMENTS` in that one file — not a rewrite of this feature.

## Entities

Two new syncable entity types, alongside the existing `deck` / `card` / `session`:

- `librarySource` — one row per `LibrarySourceRecord`.
- `sourceCollection` — one row per `SourceCollectionRecord`, including collection membership
  (`LibrarySourceRecord.collectionIds`, which travels as part of the source's own record, the same
  way it already works locally — no separate join-table entity needed).

Both entities reuse the existing `/sync/push`/`/sync/pull` HTTP contract and `Change` envelope
(`src/cloud/sync/types.ts`) — no new route, no new request/response shape. `EntityType` was
extended to include both; `validateChange.ts` gained shallow shape validators for each
(`isLibrarySourceRecordShape`/`isSourceCollectionRecordShape`), matching the existing
deck/card/session validators' depth and reject-don't-coerce convention exactly.

**Since the Library Organization + Private Source Storage batch**, `LibrarySourceRecord` also
carries `cloudUploadState`/`cloudUploadedAt` (see
`docs/library-and-source-architecture.md`'s "Private source storage architecture"). These sync
through this exact same path — no new entity, no new route, no schema change to this contract's
own mechanics. They remain metadata: durable *state about* an original file (whether one has been
uploaded), never the file's bytes or a local device URI, which is a hard rule this contract has
always enforced and continues to.

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

## Local migration

No dedicated migration function was needed. Every mutation function in
`src/storage/librarySources.ts` and `src/storage/sourceCollections.ts` already set `dirty: true`
and correctly bumped `rev`/`updatedAt` on every write, from an earlier Library batch written for
future sync-readiness — and nothing has ever cleared `dirty` before this implementation. That
means every pre-existing local Library record, on any device, is already correctly flagged as
needing its first sync the moment sync is enabled — no separate one-time migration pass is
required. The only model-layer change was adding `lastSyncedAt?: string` to both
`LibrarySourceRecord` and `SourceCollectionRecord` (matching the field decks/cards/sessions
already have) and extending `upgradeLibrarySource`/`upgradeSourceCollection` to read it back —
both functions reconstruct their return object field-by-field rather than spreading raw input, so
this had to be added explicitly or the field would be silently stripped on every storage read.

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

Per this mission's and `CLAUDE.md`'s standing rules: this work was sequenced to happen against a
**Development** environment, never developed or tested directly against the live Production
backend. In the end, **no backend Lambda source change was required at all**: `PK = U#<sub>` and
the Records/Changes table `SK` shapes in `backend/lambdas/sync-push/index.mjs` and
`sync-pull/index.mjs` are already entity-agnostic — `entity` is just string-interpolated into the
sort key with no allowlist anywhere — so `librarySource`/`sourceCollection` changes flow through
the existing `/sync/push`/`/sync/pull` Lambdas and the existing `Interval_Records`/
`Interval_Changes` tables unmodified. No new table, no new access pattern, no new Lambda, and
consequently **no CDK/infrastructure change and no redeployment of `IntervalDevelopmentStack`**
is required for this feature to work once the Development-gated client code above reaches a
Development build. This document specified the contract; this section now also records that the
implementation satisfying it required zero backend changes.

## What this contract explicitly does not cover

- Source binary/file upload, storage, or retrieval (future, secure-upload-gated work).
- Server-side extraction, AI generation, or Canvas synchronization (§7–§10 of the architecture
  doc) — all depend on binary storage existing first, which this contract does not provide.
- Guest-to-account adoption/migration mechanics (§18 of the architecture doc, explicitly open).
- **Resolved by this implementation:** Library sync uses the *same* `/sync/push`/`/sync/pull`
  routes as decks/cards, not a dedicated protocol — metadata-only records turned out to fit the
  existing small-delta change-log model without modification, exactly as this document's original
  "much closer in shape" note anticipated. This resolution applies to metadata only; it says
  nothing about how a future binary/file-upload path should work, which remains a separate,
  unresolved question (`docs/library-and-source-architecture.md` §7/§11/§12).
