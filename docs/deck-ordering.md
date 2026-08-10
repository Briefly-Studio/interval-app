# Canonical Deck Ordering

## The problem this fixes

Two devices signed into the same account, holding the exact same decks, could display them in
a **different order** on Home. This was a real, code-verified bug, not a hypothetical:

- **Locally created decks are prepended.** `src/storage/decks.ts`'s `addDeck` writes
  `[newDeck, ...existingDecks]` — a deck created on a device lands at the front of that device's
  own on-disk array, newest first.
- **Pulled decks are appended, in a different order.** `src/cloud/sync/SyncService.ts`'s
  `applyChanges` builds a `Map` keyed by deck id, seeded from the device's existing decks (order
  preserved for updates), then calls `byId.set(ch.id, ...)` for every incoming change. For a deck
  id the receiving device has never seen before, `Map.set` on a new key appends it at the end of
  the map's iteration order — and `Array.from(byId.values())` writes that order straight back to
  storage. Incoming changes are processed in ascending change-timestamp order within a page, so a
  batch of newly-pulled decks lands at the very end of the array, oldest-of-the-batch first.
- **Home never sorted at all.** `app/index.tsx`'s `loadDecks` (before this fix) called
  `getDecksAll()`, filtered out tombstones, and rendered the result as-is — whatever order the
  array happened to be in on disk.

So: a deck created on Device A sits near the front of Device A's array (prepended locally). The
same deck, once synced to Device B, lands at the *back* of Device B's array (appended on pull).
Same deck records, structurally different array order, and nothing downstream corrected for it —
exactly the founder-observed symptom.

## The rule

**Primary: most recently updated first.** Deterministic tie-breakers, in order:

1. `updatedAt` descending
2. normalized (accent/case-insensitive) title ascending
3. `id` ascending

Implemented in `src/domain/deckOrder.ts` — `compareDecksCanonical` / `sortDecksCanonical`. Pure,
side-effect-free, no storage or network access: given the same deck records, every device
produces the same order, full stop. It does not read or depend on AsyncStorage insertion order,
sync-pull arrival order, or anything else about *how* a record got onto the device.

### Why not `localeCompare()` for the title tie-break

`localeCompare`'s collation behavior can differ by JS engine/ICU data availability (Hermes on
iOS vs. Android vs. web). Two devices could legitimately disagree on tie order for the exact same
two titles if the comparator depended on it — the one thing this rule must never allow. The title
tie-break instead does NFD-normalize + strip combining marks + lowercase, then compares with plain
`<`/`>` (UTF-16 code-unit order) — byte-identical on every JS engine, no ICU dependency.

### Malformed/missing timestamps

`updatedAt` is parsed with `Date.parse`; a missing or unparseable value falls back to `0`
(oldest possible) rather than throwing or producing `NaN`, which would otherwise corrupt every
comparison it participates in. A deck with a malformed timestamp sorts last among equal-titled
decks rather than crashing the list.

### What this function does not do

`sortDecksCanonical` only orders whatever array it's given — it does not filter tombstoned
(`deletedAt`) records itself. Callers are expected to have already excluded them, matching the
same sort/filter split `src/domain/libraryOrganize.ts` already uses for Library sources.

## Where it's applied

- **`app/index.tsx` (Home)** — the primary active-deck list. Applied after filtering out
  `deletedAt` records, before rendering.
- **`app/deck-collections/[id].tsx` / `.../add.tsx`** — decks shown inside a Deck Collection use
  the same canonical order, for the same cross-device-consistency reason.

## Where it's deliberately NOT applied

- **`app/recently-deleted.tsx`** — already had its own explicit, product-intentional sort (most
  recently *deleted* first, by `deletedAt`). That's a different signal for a different purpose
  (showing what you just trashed, not what you last edited) and was left untouched.
- **`app/deck/[id]/index.tsx` / `app/deck/[id]/history.tsx`** — session history lists, already
  sorted by `finishedAt` descending. Unrelated to deck ordering.

## Cross-device guarantee

Because the comparator is a pure function of record content (not array position, not arrival
order), any two devices that have converged to holding the same set of active deck records —
regardless of which device created which deck, or what order sync happened to deliver them in —
render those decks in the identical order. This does not, by itself, fix the underlying
`applyChanges` append behavior (still true, still relatively arbitrary) — it makes that behavior
irrelevant to what the user sees, which is the actual product requirement.
