# Generated card provenance sync

Implemented on `feat/provenance-sync`; real-device multi-device QA and deployed-backend parity
remain unverified. No deployment or infrastructure change is part of this feature.

## Purpose and schema

`generatedCardProvenance` is a separate first-class sync entity. CardRecord and DeckRecord are
unchanged. Manual/imported cards gain no fake source relationship. Source Coverage remains a
derived query, not a synchronized counter, and never means mastery or reading completion.

The existing scoped `interval.generatedCardProvenance.v1` array remains in place. Each record:

```ts
{
  id: string;                 // exactly cardId, unique within this entity
  cardId: string;
  deckId: string;             // original saved deck, a lookup hint
  sourceId: string;
  sourceChunkIds: string[];   // canonical sorted unique ids
  generatedAt: string;        // original save timestamp
  normalizationVersion?: number;
  rev: number;
  updatedAt: string;
  deletedAt?: string;
  dirty: boolean;            // device-local, excluded from push payload
  lastSyncedAt?: string;     // device-local, excluded from push payload
}
```

Identity is `id === cardId`, without a prefix: backend identity includes the entity name
(`E#generatedCardProvenance#<cardId>`), so a card and its provenance do not collide. No ownerId
comes from the record; backend ownership remains the authenticated Cognito sub.

IDs are nonempty ASCII letters/digits/underscore/hyphen, at most 128 characters. Chunk IDs are
at most 64 ASCII characters; arrays are nonempty and bounded to 5,000 entries before deduplication,
matching the normalizer's maximum chunk count. This covers even unusually small page chunks in
the 60,000-character maximum generation context. Timestamps must be canonical UTC ISO strings;
revision and optional normalizationVersion must be positive safe integers. Delete operations
require a valid deletedAt not later than updatedAt; upsert operations forbid a tombstone. Change
id, record id, cardId and change ts/updatedAt must agree. Unknown remote record fields are
rejected, preventing arbitrary source/card content from entering this metadata entity.

Even the maximum record is below DynamoDB's 400 KiB item limit (tested with maximum-length IDs).
Provenance-bearing push batches are subdivided below a conservative 4 MiB JSON body budget,
retaining the existing 500-change ceiling and sequential acknowledgement handling. Other
batches retain existing behavior. Nothing is truncated to fit a request.

## Write, revision, and migration lifecycle

The existing saveDraftDeck call is unchanged: save ordinary cards, then record provenance
locally, best-effort. No network is required, and a provenance persistence failure does not
roll back successfully saved cards. That failure still means those cards cannot contribute
coverage until trustworthy provenance is available; content is never reconstructed or guessed.

New records start rev 1, dirty true, with updatedAt equal to generatedAt. Normalization version
is optional because the existing draft save input does not carry it. Neither migration nor sync
guesses it from a chunk hash. An optional known version is preserved and validated. Normalizer
version changes still make old chunk references unmatched: no fuzzy remapping or migration.

Reads lazily upgrade legacy entries and persist the canonical array under the same scoped key.
They preserve cardId/deckId/sourceId/chunk IDs/generatedAt, initialize revision/dirty metadata,
and do not require reinstall. Repeated reads/restarts are idempotent. Malformed individual
entries are ignored. Duplicate legacy rows are possible because the old format was an array;
they collapse by cardId using a deterministic sort and the same merge rules as sync. Different
source IDs are never unioned. Already-upgraded rows retain their revision/dirty state.

Storage I/O errors and invalid whole-array JSON are errors, not empty data. All reads/migration,
local saves, applies and acknowledgements share a per-scope transaction queue so overlapping
array writes cannot discard newly created provenance. The native adapter delegates to the same
injected store tested under Node. Acknowledgements only clear the exact entity/id/revision
that was sent; a later merge or tombstone stays dirty.

## Conflict resolution

This entity is not an immutable ReviewEvent. Application-authored provenance content is fixed
after card creation; explicit withdrawal/restore and sync conflict repairs are revisioned.
There is no speculative editor or arbitrary rewrite API.

For one card ID:

1. Missing local record accepts a validated incoming record clean. Missing incoming is a no-op.
2. Envelope dominance is revision, then updatedAt, then tombstone at an exact tie, then a stable
   canonical payload comparison. Device-local flags do not participate.
3. Two active records with the same sourceId, original deckId, and normalizationVersion can
   union sorted chunk IDs, retaining the earlier generatedAt. Previously unseen valid chunks
   from a lower-revision active record are retained. This is a new merged revision, not a
   lower-revision overwrite of local state.
4. Tombstones never union. Older active records cannot resurrect a tombstone. A higher-revision
   explicit active restore wins. Different source/deck/version identities choose the dominant
   payload and never blend unrelated identities.
5. If the union exceeds the bound, choose the whole dominant record, not a truncated union.
   The pure helper reports `chunk-limit`; this exceptional conflict can lose references and is
   deliberately not described as a lossless unbounded union.
6. A novel merged payload or differing equal-revision payloads produce max(rev)+1, timestamp
   max(updatedAt)+1 millisecond, dirty true. This repair must be pushed on a subsequent sync.
   Replayed older subsets do not endlessly increment revisions. Revision/time exhaustion fails
   rather than writing an invalid record.

Publishing repairs is necessary: the generic backend stores a revision-conditional snapshot;
an in-memory-only union would leave new devices with a lossy snapshot. Tests exercise repaired
server state, repeated pulls, all three-way compatible arrival permutations, and identity and
tombstone conflicts. No claim is made that malicious contradictory metadata proves a card's
factual source; deterministic resolution prevents mixing incompatible source identities.

## Deletion, restore, and out-of-order arrival

Coverage requires active provenance AND a live card AND a live parent deck. A provenance row
arriving before its card, a card arriving before its provenance, or missing source chunks
contributes nothing until the related records exist. Unknown/stale chunk IDs are ignored.

Ordinary card soft-delete uses the existing synced CardRecord tombstone as the inactive state.
Do not delete the provenance or write another tombstone per card. Restoring the card makes its
retained provenance usable again. Deck deletion similarly excludes coverage immediately even
if cascade card changes have not arrived yet; restoring the deck/cards reactivates coverage.
This avoids extra writes and races between card and provenance restore streams.

An explicit sidecar withdrawal has its own deletedAt/rev/dirty lifecycle; it is excluded even
if a card is live, and its explicit restore retains trustworthy source metadata. The store
supports this lifecycle without adding UI or automatically withdrawing rows on card deletion.

Recovery can move a card to another deck. Coverage loads referenced decks first and, when a
cited card is missing/inactive there, searches other decks once. Newer card revisions determine
the real location. There is no per-card scan of every provenance record or every deck.

Source archive and soft-delete do not erase provenance. UI source visibility follows existing
Library behavior. Permanent card/source purges leave inactive orphans; no garbage collector or
cascade hard deletion is introduced. Keeping orphans is necessary for out-of-order sync.

## Sync integration and environment safety

The entity is in EntityType/Change.record, strict validateChange, collectDirty, applyChanges,
and entity-scoped exact-revision markClean. The generic backend accepts it unchanged and
partitions it by authenticated user. No Lambda, DynamoDB table, IAM, API Gateway, CDK or AWS
deployment change is required by the inspected source. Live deployments were not inspected.

| Environment | Provenance push/apply | Real AI generation |
| --- | --- | --- |
| Development | Enabled | Existing policy unchanged |
| Staging | Enabled | Existing mock policy unchanged |
| Production | Disabled | Existing generation gate unchanged |
| Unknown/unreadable config | Disabled | Unchanged |
| Guest | Local-only; syncOnce returns before network | Unchanged |

The dedicated gate is independent of Library metadata sync, ReviewEvents and AI provider
selection. Collection and application both gate the entity. Disabled environments leave local
dirty records intact. scopedKey separates every user and guest; no implicit adoption or
cross-account lookup is added. Existing mid-push/mid-pull identity checks remain intact.

## Privacy, observability, and performance

No source text, chunk text, filename, prompt, generated question/answer, or token is included.
Only metadata fields are serialized. Sync logs retain counts/categories; malformed provenance
diagnostics omit record IDs and arrays. No raw storage/parser exceptions are logged here.

One scoped array is read per transaction, then indexed with Maps/Sets. Coverage reads provenance
once and cards in batches per relevant deck, with one recovery fallback. Dirty collection does
not fetch provenance separately for each card. This is not a database/cache rewrite; very large
accounts still incur whole-array JSON reads/writes and may eventually warrant a different store.

## Rollout limitations

Development two-device QA comes first, followed by Staging/TestFlight multi-device QA. Production
enablement remains a separate explicit decision; schema implementation alone does not enable it.
Upgrade participating devices before sending this entity. Old/disabled clients skip new entity
changes while advancing the shared cursor; later enablement requires a deliberate full replay
(the existing Force Resync workflow) to recover previously skipped history. No automatic cursor
reset is added, preserving existing cursor invariants.

The existing backend log is ordered by client timestamps, not server commit sequence. A late
offline/backdated push or a same-millisecond key inserted behind another device's cursor may
never be delivered to that device's incremental pull. This inherited limitation also affects
cards/decks; provenance sync cannot guarantee cross-device equality in those cases. A full
history replay can recover retained changes, while a general fix requires separately reviewed
backend/cursor work and deployment. See docs/sync-invariants.md. Migration preserves old
generatedAt/updatedAt rather than falsifying creation time, so an already-advanced peer may need
that replay after legacy provenance upload. This limitation must be checked during rollout,
not hidden behind the feature's convergence tests.

Convergence requires successful delivery of the participating records and any dirty repairs,
matching source bytes/chunk normalization, and compatible client versions. The sync integration
suite explicitly reproduces a missed backdated legacy upload and verifies full replay recovery;
its normal convergence tests do not conceal that inherited delivery gap. A repair may require
another explicit/opportunistic sync. Source Coverage still uses its existing source-file
resolution path (local file works offline; a missing local original may need cloud retrieval).
Device tests, source parsing quality and live backend parity are not established by Node tests.

## Validation

`npm run test:provenance` runs model/validation, merge, real SyncService with mocked native
boundaries, injected storage migration/concurrency, payload bounds, and coverage liveness tests.
It uses Node's experimental module mocking flag only in this test command. No new dependency.
Existing coverage, sync, AI, scheduling/ReviewEvent, DOCX and import suites remain required,
along with TypeScript, lint, diff whitespace, autolinking verification and expo-doctor.

## Founder two-device QA

1. Upgrade A and B; sign into the same Development account and sync both. Make the same Library
   source/file available on both devices with identical normalization.
2. Generate/save on A, verify increased coverage, sync A then B. Verify deck, cards, provenance
   and exact coverage agree. Restart B and verify persistence.
3. Delete the only card covering a section on A; sync both and check downward convergence.
   Restore it, sync both, and check recovery. Repeat with an entire deck.
4. Generate different cards from the same source on B; sync B then A and verify union coverage.
5. Save while offline and reconnect later. Specifically test a peer whose cursor advanced while
   A was offline; exercise full replay if the inherited backdated-cursor limitation occurs.
6. Upgrade a device containing legacy local provenance, sync it, and check the other device.
   Include a peer that previously skipped unknown provenance changes and verify replay recovery.
7. Test restore into a recovery deck; source archive/restore and source soft-delete/restore.
8. Confirm manual/CSV cards gain no provenance; missing card/source arrivals never crash.
9. Inspect payload/log categories: no source/card content or tokens in provenance diagnostics.
10. Sign out/in with a different account and guest scope; confirm isolation. Repeat in Staging
    with mock AI, then verify Production collects/applies no provenance. Do not enable Production.
