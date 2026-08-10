# Deck Collections

**Status: implemented, local-only.** This document describes the Deck Collections foundation —
letting a user group decks (e.g. "University", "AWS", "Personal") so Home doesn't become a single
mixed list of unrelated subjects.

**Terminology — do not confuse these two features:**

| | Groups | Model file | Membership |
|---|---|---|---|
| **Deck Collection** | decks | `src/models/deckCollection.ts` | single (a deck belongs to at most one) |
| **Library Source Collection** | Library sources | `src/models/sourceCollection.ts` | multiple (a source can belong to several) |

They are unrelated features that happen to share the word "collection." A Deck Collection has no
relationship to, and does not affect, Library or its collections.

## Why single-collection-per-deck, not multi (like Library)

Library Source Collections use multi-membership (`LibrarySourceRecord.collectionIds: string[]`).
Deck Collections deliberately do not mirror that:

- **The founder's own stated use case is partition-like, not tag-like** — "University", "AWS",
  "Personal" read as mutually exclusive top-level buckets, not overlapping tags. The requested
  Home layout ("Collections [University] [AWS] [Personal] / Recent or Unfiled decks") is a
  partition: each deck is either in exactly one bucket or in the unfiled list, never both.
- **Multi-membership would reintroduce the exact clutter problem this feature exists to solve** —
  if a deck could appear under two collection headers at once, Home could show the same deck
  twice in different sections, which is a worse version of "Home is a mixed pile" than doing
  nothing.
- **Simplest reversible migration path.** A single `collectionId`-shaped relationship is trivially
  upgradable to multi-membership later if ever needed (wrap the single value in an array) — the
  reverse direction (constraining existing multi-membership down to one) is lossy and would force
  a real "pick one" decision on behalf of users. Starting single and only widening later, if
  evidence ever calls for it, is the lower-risk direction to be wrong in.

## Why collection-owned membership, not a `DeckRecord` field

This is the more consequential architecture decision in this feature, and it's *not* about product
UX — it's about not touching the existing deck sync path.

**Library's `collectionIds` lives on the source because Library never syncs.** Decks are
different: `src/cloud/sync/SyncService.ts`'s `collectDirty()` pushes the **entire** deck record
(`record: deck`) for any deck marked `dirty`, and the backend
(`backend/lambdas/sync-push/index.mjs`) stores whatever `record` shape it's given, with no field
whitelist. If `collectionId` were added directly to `DeckRecord`, the next time any signed-in
user's dirty deck got pushed, that field would ride along into the live Production
`Interval_Records` table automatically — a real, unapproved schema change reaching Production data
the moment this code shipped, not something this mission's "no AWS mutation, local foundation
now" scope permits.

**The fix: membership lives on `DeckCollectionRecord.deckIds`, never on `DeckRecord`.**
`src/models/deck.ts` and everything `src/cloud/sync/SyncService.ts` pushes/pulls for decks is
completely unmodified by this feature. Deck Collections are an entirely separate, parallel local
entity — `src/storage/deckCollections.ts` never imports from or writes to `src/storage/decks.ts`.

One side effect of this choice: finding "which collection is deck X in" requires checking each
active collection's `deckIds` (or building a `deckId -> collectionId` map once — see
`getDeckCollectionMembershipMap`) rather than reading one field off the deck. For the expected
scale (a handful of named collections), this is a non-issue.

## Data model

`src/models/deckCollection.ts`:

```ts
type DeckCollection = { id: string; name: string; createdAt: string; deckIds: string[] };
type DeckCollectionRecord = DeckCollection & {
  rev: number; updatedAt: string; deletedAt?: string; dirty?: boolean;
};
```

`rev`/`updatedAt`/`dirty`/`deletedAt` exist for future-sync shape-parity only, matching
`LibrarySourceRecord`'s own documented convention — see "Future cloud sync" below. Nothing in this
batch reads or pushes `dirty` for this entity; there is no sync integration yet.

Same defensive-normalization convention as every other local model in this app
(`upgradeDeckCollection`) — a malformed stored record never crashes the app.

## Local persistence

`src/storage/deckCollectionKeys.ts` — new key `interval.deckCollections.v1`, scoped through the
existing `scopedKey(WorkspaceScope, ...)` mechanism (same guest-vs-`user:<sub>` local partitioning
decks/cards/sessions/Library already use — no new isolation model invented).

`src/storage/deckCollections.ts` — CRUD:

- `getDeckCollections` / `setDeckCollections` / `getActiveDeckCollections`
- `addDeckCollection`, `renameDeckCollection`, `softDeleteDeckCollection`
- `assignDeckToCollection(scope, deckId, collectionId)` — enforces single membership by removing
  the deck from every *other* active collection before adding it to the target.
- `unassignDeckFromCollection(scope, deckId)` — removes a deck from whichever collection currently
  holds it, if any. No-op if already unassigned.
- `getCollectionIdForDeck` / `getDeckCollectionMembershipMap` — read-side lookups.

**Deleting a collection never deletes its decks.** `softDeleteDeckCollection` only tombstones the
collection and clears its own `deckIds` — since no other record references a Deck Collection (the
collection references its decks, not the reverse), there is no cross-record cleanup needed the way
Library's `unassignCollectionFromAllSources` requires. Every deck that was in the deleted
collection simply reads back as unfiled.

**Deleting a deck sweeps it out of its collection.** `app/index.tsx`'s delete handler calls
`unassignDeckFromCollection` after `deleteDeckById` — purely local bookkeeping, touches no deck
sync state. Not required for correctness (Home's membership computation already intersects
`deckIds` against the currently-active deck list, so a stale id would simply render as absent) but
keeps stored data tidy rather than silently accumulating dead references.

## Deterministic ordering

`src/domain/deckCollectionOrder.ts` — alphabetical by normalized name (not recency): unlike decks,
where "most recently updated" is a meaningful, founder-directed signal, a collection is a stable,
deliberately-named container whose `updatedAt` only moves on rename/membership change, which isn't
a meaningful recency signal for a folder-like group. Alphabetical is the more predictable,
scannable order for a short list of named containers — the same reasoning a file browser's default
folder order follows. Same NFD-normalize/no-`localeCompare` determinism approach as
`src/domain/deckOrder.ts`, for the same cross-device reason.

## Home organization UX

`app/index.tsx` — additive, not a redesign:

- A **Collections** section (header + "+ New collection" button) is always shown. With zero
  collections, it shows a one-line hint instead of chips — collections are always discoverable,
  never hidden until the user's first one exists.
- Each collection renders as a `DeckCollectionChip` (`src/ui/DeckCollectionChip.tsx`) — name +
  deck count, tapping opens the collection's detail screen.
- The deck list section header reads "My decks" when there are zero collections (byte-for-byte the
  same experience as before this feature, for anyone who hasn't adopted it) or "Unfiled decks"
  once at least one collection exists.
- The deck list itself shows only **unassigned** decks — a deck inside a collection is reached via
  that collection, not duplicated into the flat list. Nothing is hidden: every deck is either in
  the unfiled list or inside a visibly-listed, correctly-counted collection.
- If every deck is organized into a collection, the (now-empty) unfiled list shows an explanatory
  line rather than a bare empty space.

## Interaction model

**Core product rule: Add never implicitly moves a deck between collections.** Founder QA on the
first version of this feature found the opposite behavior confusing — the original Add Decks
picker listed every active deck, including decks already in a different collection, and checking
one silently moved it. That has been replaced with three distinct, explicitly-named actions that
each do exactly one thing:

### ADD — `Collection → Add decks`

`app/deck-collections/[id]/add.tsx` shows **only unfiled decks** — active decks currently
belonging to no collection (`src/domain/deckCollectionMembership.ts`'s `getUnfiledDecks`, shared
with Home's own unfiled-list computation so both screens agree on the definition). It never shows
a deck already in this collection (nothing to re-add) or a deck already in a different collection
(that's Move's job, not Add's). Multi-select remains, since picking several unfiled decks at once
is still useful; nothing is pre-checked, since everything shown is — by construction — not yet in
any collection. If there are no unfiled decks (either because every deck is already organized, or
because none exist yet), the screen shows an explicit empty state instead of a bare/empty checkbox
list.

### MOVE — `Deck → Move to collection`

`app/deck/[id]/move-to-collection.tsx` — reached via the deck long-press action sheet
(`src/ui/deckActionsSheet.ts`, shared by Home and collection detail) — shows every active
collection as a destination, plus "New collection." The deck's current collection (if any) is
shown with a "Current" indicator and is non-actionable (disabled), so the user can never wonder
which collection a deck is already in. Selecting any other collection **explicitly, atomically**
replaces the deck's membership — this is the only place a deck's collection is ever changed out
from under an existing assignment, and it always happens as the direct result of the user tapping
a named destination, never as a side effect of an Add action.

**New collection from Move:** selecting "New collection" opens the existing
`app/deck-collections/create.tsx` screen (reused, not duplicated) with an `assignDeckId` param. On
successful creation, that screen itself calls `moveDeckToCollection` for that one deck and lands
directly on the new collection's detail screen — the deck arrives already moved, no second
confirmation step needed.

### REMOVE — `Deck → Remove from collection`

Available only for a deck that's currently assigned (collection detail's per-deck button, and the
long-press sheet when reached from collection detail — omitted entirely from Home's sheet, since
Home's list only ever contains unfiled decks for which "remove" has no meaning). Returns the deck
to unfiled via `unassignDeckFromCollection`. Never deletes the deck.

## Collection detail / management

`app/deck-collections/[id].tsx` — rename, delete (with the same "decks aren't deleted" guarantee
as above), list member decks in canonical order, and the Remove action above.
`app/deck-collections/[id]/add.tsx` — the unfiled-only Add picker described above.
`app/deck-collections/create.tsx` — name entry, duplicate-name rejection, matching
`app/library/collections/create.tsx`'s exact pattern, plus the optional `assignDeckId` handling
for the Move flow's "New collection" entry.

No separate "list all collections" screen exists — Home's own Collections section already serves
that role, keeping the navigation hierarchy shallow (Home → collection detail → add-decks picker;
Home or collection detail → move-to-collection picker → optionally create → collection detail;
never deeper).

## Future cloud sync

**Not implemented in this mission — this section documents the decision, per the mission's
explicit instruction not to implement backend changes unless the existing generic sync schema
already supports the new entity safely with zero AWS mutation and Production schema risk.**

It does not: `backend/lambdas/sync-push/index.mjs` accepts any `entity` string and stores
`record` opaquely, so a client *could* start pushing `entity: "deckCollection"` changes without
any backend code change — but doing so today would still mean live Production DynamoDB rows for
an entity this repository has never reviewed a schema for, deployed with no founder sign-off on
that specific step. Default preference per this mission: **local foundation now, cloud enablement
after Development infrastructure exists** (`docs/environment-separation-plan.md`).

When it is built, it should reuse the existing invariants rather than invent parallel ones (see
`docs/sync-invariants.md`):

- `id` / `rev` / `updatedAt` / `dirty` / `deletedAt` — already present on `DeckCollectionRecord`
  for exactly this reason.
- Revision-based last-writer-wins conflict resolution, tombstone-participates-in-conflict, and the
  same push/pull/apply shape `SyncService.ts` already implements for deck/card/session.
- Ownership via the authenticated Cognito `sub`, exactly like every other synced entity — never
  trusted from client input.

**Founder expectation, restated:** the same signed-in account should ultimately see the same
decks, the same Deck Collections, and the same deck organization on every device. Achieving that
is a cloud-sync problem, not a local-model problem — this batch's job was to build a local model
that won't need a breaking migration once that sync work actually happens.
