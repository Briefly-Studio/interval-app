# Spaced-Repetition Scheduling Foundation

**Status: implemented on `feat/fsrs-scheduling-foundation` (cut from `v3.3-dev`); local-only,
visually founder-QA passed for the core rating loop, not yet QA-verified for the Study Due
Cards/deck-summary additions below, not yet merged.** This is the first real spaced-repetition
scheduling system in Interval — a durable, immutable review-history model plus a derived,
scheduler-neutral "what's this card's current state" model, wired to a real FSRS implementation
behind a narrow, replaceable boundary. **Cross-device sync is explicitly NOT implemented in this
batch** — see "Sync considerations" below for the full analysis and why this was the right call
to defer rather than force.

**Second pass (this update):** the first pass shipped the rating loop itself (Again/Hard/Good/
Easy, interval previews, persistence) but — per direct founder QA — left an ordinary user with no
visible reason the four buttons existed, and `dueSelection.ts`'s queue helpers, though fully built
and tested, were not wired into anything. This update closes that gap: plain-language rating
copy, a deck-detail due/new/not-due summary, a real **Study Due Cards** action built from the
existing queue helpers, and **Study All Cards** preserved as the unchanged, unscheduled path. No
scheduler math changed — see "Review queue behavior" below for exactly what was audited and
reused as-is.

## 1. Product purpose

Interval's name has not, until now, meant anything about *when* a card is reviewed — `review.tsx`
was (and for the un-rated path still is) a linear flip-through with no concept of due dates,
intervals, or retention. This foundation makes the name mean something: every card now has a real
scheduling state (new/learning/review/relearning, with a real `dueAt`), and every review a user
submits (Again/Hard/Good/Easy) both updates that state and is durably recorded as historical fact.
It is explicitly **not** a UI overhaul — see "Current study-flow integration" below for exactly
how small the UI change is.

## 2. Scheduler architecture

```
src/domain/scheduling/
  types.ts        — scheduler-neutral domain types (CardSchedulingState, ReviewEvent, ratings)
  scheduler.ts     — the Scheduler interface + utcCalendarDayDiff
  fsrsScheduler.ts — the ONLY file that imports ts-fsrs; implements Scheduler
  defaults.ts      — activeScheduler (the one place the active engine is chosen)
  migration.ts     — resolveCardSchedulingState (legacy/new-card resolution)
  reviewEvent.ts    — buildReviewEvent / computeReviewEventId
  applyCardReview.ts — the pure "apply one review" domain action
  dueSelection.ts   — pure due/new/overdue/future queue helpers
  intervalFormat.ts — pure "in 3 days" caption formatting for the review screen
```

Every file outside `fsrsScheduler.ts` talks exclusively to the `Scheduler` interface
(`scheduler.ts`) — none of them import `ts-fsrs` or know its `Card`/`Rating`/`State` shapes.
Swapping engines (a future FSRS major version, or a different algorithm entirely) means writing
one new file that implements `Scheduler` and changing `defaults.ts`'s one-line `activeScheduler`
assignment; nothing else changes. This directly satisfies the mission's core constraint: the app
is never permanently coupled to one scheduler implementation.

`Scheduler.createNewCardState`/`scheduleReview`/`previewReview` all take an explicit `now: Date`
— nothing in the scheduling domain layer calls `Date.now()` internally, so every function is
deterministic and testable for a fixed timestamp (verified directly: `fsrsScheduler.test.ts`
asserts identical output for identical inputs, including a far-future `now`).

## 3. Review event model

`ReviewEvent` (`types.ts`) is an immutable record of one real review:

```ts
type ReviewEvent = {
  id, cardId, deckId, sessionId?, reviewedAt, rating,
  previousState, resultingState, previousDueAt, nextDueAt,
  elapsedDays, scheduledDays,
  previousStability?, nextStability?, previousSchedulingDifficulty?, nextSchedulingDifficulty?,
  responseTimeMs?,
  schedulerAlgorithm, schedulerVersion,
};
```

- **Rating is an explicit lowercase string enum** (`"again" | "hard" | "good" | "easy"`) — never a
  magic integer anywhere outside `fsrsScheduler.ts`'s own narrow mapping to `ts-fsrs`'s `Rating`
  enum.
- **Append-only, by construction, not just by convention.** `src/storage/reviewEvents.ts` has no
  `updateReviewEvent` function at all — only `getReviewEventsForDeck` and `addReviewEvent`
  (prepend). `computeReviewEventId` (a deterministic FNV-1a hash of `cardId|reviewedAt|rating`)
  makes a genuine re-submission of the exact same review idempotent (`addReviewEvent` skips an
  exact-id duplicate) without needing a mutable "has this been recorded" flag anywhere.
- **No `deletedAt` field exists on this record type at all** — not optional-and-unused, genuinely
  absent from the type. A correction/deletion feature, if ever built, needs its own explicit
  design (per the mission's own Phase 2 instruction) — it is not something this batch quietly
  permits via an unused tombstone field.
- `responseTimeMs` is only ever populated when the review screen directly measured it (time from
  the card becoming visible to the rating tap) — never estimated, backfilled, or defaulted.
- `previousStability`/`nextStability`/`previousSchedulingDifficulty`/`nextSchedulingDifficulty`
  capture the FSRS memory-state before and after the review specifically so a future analytics or
  recomputation feature has enough to reconstruct what changed without re-deriving it from two
  separate state snapshots (see "Analytics future" and "Algorithm/version strategy" below).

## 4. Scheduling-state model

`CardSchedulingState` (`types.ts`) is the CURRENT, derived state:

```ts
type CardSchedulingState = {
  cardId, state, dueAt, lastReviewedAt?,
  stability?, schedulingDifficulty?,
  scheduledDays, elapsedDays, reps, lapses,
  schedulerAlgorithm, schedulerVersion,
  engineState?: Record<string, unknown>,
};
```

- `state` is the real FSRS state machine: `"new" | "learning" | "review" | "relearning"`.
- `engineState` is a deliberately **opaque, engine-owned bag** (used today to round-trip FSRS's
  own short-term learning-step counter) — see "Why not a named `learningSteps` field" below. No
  file outside `fsrsScheduler.ts` reads or writes its contents; storage/UI persist and pass it
  through without interpreting it.
- This is explicitly a trimmed-down set, not a copy of `ts-fsrs`'s own `Card` type. Fields that
  exist purely as FSRS v5.4.2 implementation detail (the deprecated `elapsed_days` round-trip
  value, the raw `Card` shape itself) never leave `fsrsScheduler.ts`.

### Why not a named `learningSteps` field

An earlier draft of this type named FSRS's internal "which learning step am I on" counter
directly (`learningSteps: number`). That was deliberately reverted: naming it on the
scheduler-neutral type bakes one engine's own internal stepping model into a contract that is
supposed to survive an engine swap — exactly what this foundation exists to prevent. It is
carried instead inside `engineState.fsrsLearningSteps`, named and interpreted only inside
`fsrsScheduler.ts`.

## 5. Content difficulty vs. scheduling difficulty — kept permanently separate

`CardRecord.difficulty` (`src/models/card.ts`) is **completely untouched** by this batch: it
remains the existing, permanent, user-set `"easy" | "medium" | "hard"` content label that only
drives `smartShuffle`'s ordering, exactly as before. Nothing in review or quiz mode writes to it,
exactly as before.

The FSRS algorithm's own internal, continuously-valued difficulty estimate lives on a *different*
type (`CardSchedulingState.schedulingDifficulty: number`) under a deliberately different name.
The two can never be confused at the type level (different host type, different value shape —
closed string enum vs. a roughly-1-to-10 number) even though the English word "difficulty"
appears in both. Likewise, the review **rating** "Hard" (how hard *this specific recall* felt) is
a different concept from the card's own permanent "Hard" content-difficulty label, despite
sharing a word — `types.ts`'s header comment calls this out explicitly so it's never silently
conflated in future code or copy.

## 6. Storage

Two new, dedicated per-deck stores, mirroring `src/storage/cards.ts`'s own exact shape (same
`cardSchedulingKeyForDeck`/`reviewEventsKeyForDeck` per-deck keying pattern, same
read-upgrades-and-writes-back self-healing on read):

- `src/storage/cardScheduling.ts` — `interval.cardScheduling.v1.<deckId>`. One record per card
  that has ever been reviewed (absent = never reviewed — see "Migration" below). **Not synced** —
  see "Sync considerations" (§16) for why this stays a local-only, derived cache even now that
  `ReviewEvent` syncs.
- `src/storage/reviewEvents.ts` — `interval.reviewEvents.v1.<deckId>`. Append-only array of every
  review ever submitted for that deck's cards. **Now a first-class synced entity**, gated to
  Development/Staging — see "Sync considerations" (§16) for the full sync design.

**Deliberately NOT a field on `CardRecord`.** `CardRecord` is already on the live Production sync
path — any field added there reaches Production the moment any signed-in user's next sync runs
(the exact risk CLAUDE.md's Deck Collections precedent already documents for `DeckRecord`:
*"decks already participate in the live Production sync path... so any field added there reaches
Production the next time any signed-in user syncs"*). Keeping scheduling state as its own store,
keyed by `cardId`, avoids that entirely and keeps this foundation's local-only status genuinely
local, not accidentally cloud-reaching.

**Card delete/restore never touches scheduling state or review events, on purpose.** Both new
stores are joined against the *live* card list by the caller (e.g. the due-selection helpers) —
an orphaned scheduling record for a soft-deleted card is simply invisible until/unless the card is
restored, at which point it naturally reappears with its real history intact. This is the same
reasoning that makes `restoreCardToDeck` safe today: nothing had to be taught to resurrect
scheduling state on restore, because nothing ever tore it down on delete. **Review events are
never deleted by anything in this batch, including deck cascade-delete** — `deleteDeckById`
soft-deletes the deck/cards/sessions (confirmed by reading it directly: no hard removal happens
there at all today, only tombstoning, so Recently Deleted can restore), and this batch adds no
new behavior to that path. The only place either new store is ever hard-removed is the dev-only
full wipe (`devReset.ts`'s `wipeScope`) — there is no "permanent delete" action anywhere in the
current UI (confirmed directly: `recently-deleted.tsx` removed its old blanket permanent-delete
action in an earlier batch specifically because of the cloud-tombstone-resurrection risk
documented there), so a card/deck's scheduling history realistically only ever goes away via that
dev tool.

## 7. Migration

There is no legacy *shape* to migrate, because scheduling state was never bolted onto an existing
record — it simply didn't exist before this batch. A card with no entry in `cardScheduling.ts`'s
store (true for every single card that existed before this branch) is treated identically to a
brand-new card: `resolveCardSchedulingState` (`migration.ts`) resolves a missing state to the
scheduler's own honest "nothing has happened yet" default (immediately due, no stability, zero
reps/lapses) — **never a fabricated prior review, interval, or difficulty value.**

This makes migration trivially deterministic and idempotent by construction: resolving a missing
state is a pure read that writes nothing. A real `CardSchedulingRecord` is only ever persisted the
first time a card is actually reviewed (`applyCardReview` → `upsertCardScheduling`). Launching the
app any number of times before that first real review produces the exact same (absence of) data
every time — there is no "migrate everything on first launch" batch job to accidentally run twice.

`upgradeCardSchedulingRecord`/`upgradeReviewEventRecord` (`src/models/cardScheduling.ts`/
`reviewEvent.ts`) exist for forward safety only — a structural validator mirroring
`upgradeCard`/`upgradeDeck`'s own resilience-on-read posture, in case this record's own shape ever
needs to evolve later. They **reject** (return `null`) a value that doesn't look like a real
scheduling record/review event, rather than coercing it into one — unlike `upgradeCard`, which
trusts locally-authored older-shape data, there is no known legacy shape here to trust.

## 8. Review flow

`app/deck/[id]/review.tsx`:

- **Before the answer is revealed: completely unchanged.** "Show answer" and the generic
  Next/Finish button both still render exactly as before, including the pre-existing (slightly
  odd but pre-existing) ability to skip a card without ever flipping it.
- **Once the answer is revealed, the generic Next/Finish button is replaced by four rating
  buttons** (Again/Hard/Good/Easy). Above them, two short lines now explain what they mean in
  plain language — **"How well did you remember this?"** / **"Your answer determines when this
  card appears again."** — never mentioning FSRS, stability, or any engineering term. Each button
  shows a live preview of its own consequence — e.g. "Good · 3 days" — computed via
  `Scheduler.previewReview` and never persisted; see "What the four ratings mean to users" and
  "What the interval means" below for the exact user-facing framing. Its `accessibilityLabel` is
  a fuller, still-short phrase using whole words instead of the visible label's abbreviation —
  e.g. **"Good — review again in 3 days"** rather than "Good · 3 days" — so a screen reader never
  has to interpret "3 d" or similar. Tapping a rating calls `applyCardReview`, persists the result
  (`upsertCardScheduling` + `addReviewEvent`, awaited before advancing — so two rapid taps can
  never race each other's writes), updates the in-memory scheduling map, and advances to the next
  card exactly like the old Next/Finish button did.
- **Finish Early remains available regardless of flip state, unchanged.**
- Quiz mode (`app/deck/[id]/quiz.tsx`) is **completely untouched** — it remains an ungraded,
  aggregate-only flow.
- **Manual study never rewrites scheduling state unless the user actually rates a card.** Audited
  directly: `onNextOrFinish` (the pre-flip Next/Finish path, and the entire "Study All Cards"
  flow when the user never flips a card) calls neither `applyCardReview` nor
  `upsertCardScheduling`/`addReviewEvent` anywhere — those are reachable only from `onRate`, which
  only runs when a rating button is actually tapped. Browsing or skipping through cards leaves
  their scheduling state exactly as it was.

### Where review.tsx's cards now come from

`review.tsx` itself still makes **zero** scheduling decisions — it only resolves whichever card-id
list it was handed against the cards it actually has (`resolveReviewQueueCards.ts`), via an
in-memory, consume-once handoff from deck-detail (`reviewQueueSession.ts`, the same "module-scope
single-slot store" pattern `src/domain/ai/generateDeckSession.ts` already uses):

- **Study All Cards** (`goReview`, unchanged route, no queue set) → `resolveReviewQueueCards`
  returns every live card unchanged → `smartShuffle` (difficulty-bucketed) orders them, exactly
  as before this entire feature existed.
- **Study Due Cards** (deck-detail's new button) → deck-detail itself computes the due queue
  (see "Study Due Cards behavior" below) and hands off the resulting card-id list → `review.tsx`
  uses those exact cards, in that exact (already-urgency-ordered) order — **never re-shuffled**,
  since re-shuffling would scramble the deliberately-computed overdue-first ordering.
- If the handed-off queue is somehow lost (e.g. the in-memory store was cleared by an app
  restart between the tap and this screen mounting — a rare timing edge case, not a normal path)
  `consumePendingReviewQueue` returns `null` and the screen falls back to the exact same
  behavior as Study All Cards, never an error screen.
- If every card in a real due queue became unavailable in the brief window between the queue
  being built and this screen mounting (e.g. deleted), the screen shows a distinct, honest "no
  longer available" message — never the ordinary "this deck has no cards, add one" empty state,
  which would be actively misleading here.

### Session/history audit

`SessionRecord` (`src/models/session.ts`) was **not changed at all** — still aggregate-only
(`total`/`correct?`/`percent?`), no new field added, no redesign. `finishSession` (the function
both `onNextOrFinish` and `onRate` call to end a session) still passes `cards.length` as `total`
regardless of whether `cards` is the full deck (Study All Cards) or a due-only subset (Study Due
Cards) — this is correct and intentional: a due-only session's own "cards reviewed" count should
honestly reflect how many cards were actually in *that* session, not the deck's total size.
Finish Early behaves identically for both paths (it already only ever used `index`/`cards.length`,
neither of which this batch changed the meaning of). History (`app/deck/[id]/history.tsx`) and
`review-results.tsx` read `SessionRecord` exactly as before — neither needed a change, and neither
can currently tell a due-only session apart from a Study-All one in the history list, which is an
accepted, honest limitation (see "Known limitations"), not a defect — the mission's own guidance
was to preserve the existing aggregate-only contract unless a new field was genuinely necessary,
and it was not.

## 9. Queue construction — now wired

`src/domain/scheduling/dueSelection.ts`'s pure, storage-agnostic helpers (`isDue`/`isOverdue`/
`isNew`/`isFuture`, `selectDueCards`/`selectNewCards`/`selectFutureCards`, `orderByDueAt`,
`buildDefaultReviewQueue`) are now a real consumer's dependency — **nothing in this module's own
math changed**; it was audited, not rewritten (see "Review queue behavior" below). Deck-detail
uses it for both the summary counts and the "Study Due Cards" queue itself, so the two can never
drift into reporting different numbers.

## 10. What the four ratings mean to users

Shown as plain product copy, never engineering terminology (no "FSRS," "retrievability,"
"stability," or "scheduling difficulty" anywhere in `review.tsx`'s UI):

| Button | What it means to the user |
| --- | --- |
| Again | "I forgot this" |
| Hard | "I remembered, but it was difficult" |
| Good | "I remembered this normally" |
| Easy | "I remembered this easily" |

The heading above the four buttons — **"How well did you remember this?"** — and the one
supporting sentence — **"Your answer determines when this card appears again."** — are the only
explanatory copy added. Deliberately just a heading and one sentence, not a tutorial paragraph.

## 11. What the interval means

The text shown beside/below each rating (e.g. "3 days") is that rating's **estimated next review
interval** — "if you tap this, that's roughly how long before this card comes back." It is a
preview, computed by `Scheduler.previewReview` from the card's *current* state, and is never
itself persisted; only the interval that results from the rating the user actually taps becomes
real (via `applyCardReview`). The visible label abbreviates ("3 days", "10 min"); the
accessibility label spells it out in full words ("review again in 3 days") for screen readers.

## 12. Due/New/Not-due definitions

Exact, not approximate — the same classification deck-detail's summary counts and "Study Due
Cards"' queue both use, via `dueSelection.ts`:

- **New** — the card has no scheduling state at all (never reviewed under this system).
  `isNew`/`selectNewCards`.
- **Due now** — the card has been reviewed before, and its `dueAt` is at or before the current
  moment. `isDue`/`selectDueCards`. This deliberately reads **"Due now," not "Due today"** —
  selection is an exact-timestamp comparison (`dueAt <= now`), not a calendar-day one, so "Due
  today" would overclaim precision it doesn't have (a card due at 11:58 PM is "due now" the
  moment the clock reaches it, not "due today" in some calendar-wide sense this app doesn't
  actually compute for the *due* check — `isOverdue`, a different, calendar-day-based check used
  only to order the queue, is the one place calendar-day semantics genuinely apply). This choice
  was deliberate, not an oversight — the mission that produced this feature explicitly allowed
  either "Due now" or truthful calendar-day semantics, and "Due now" was chosen specifically to
  avoid implying calendar-day precision the underlying check doesn't have.
- **Not due yet** — the card has been reviewed before, and its `dueAt` is still in the future.
  `isFuture`/`selectFutureCards`.
- These three are a true partition of every live card in a deck — every card is in exactly one
  bucket, confirmed directly (not assumed) by `dueSelection.test.ts`'s own partition test.
  **Deleted cards never participate** — deck-detail computes this classification over `getCards`'
  output (the already-live, non-deleted list), the same list every other part of deck-detail
  already uses; `dueSelection.ts` itself has no concept of "deleted" and never needs one.

## 13. Study Due Cards behavior

Deck-detail's new primary action. Tapping it:

1. Computes `buildDefaultReviewQueue(schedulableEntries, now, { newCardLimit: 0 })` — the exact
   existing helper, with new-card introduction explicitly suppressed. **"Study Due Cards" means
   due cards only** — a brand-new, never-reviewed card is not "due" in any real sense (it has
   never been scheduled at all), and mixing it in would make "zero due cards" an inaccurate
   reason to show "You're caught up" whenever new cards still existed. `newCardLimit: 0` reuses
   the helper's own existing parameter rather than a second, parallel due-only implementation.
2. If the resulting queue is empty, shows **"You're caught up" / "No cards are due right now."**
   as a plain alert and does **not** navigate anywhere — no empty review session is ever opened.
3. Otherwise, hands the queue's card ids to `review.tsx` (via `reviewQueueSession.ts`) and
   navigates to the existing review route — the same screen Study All Cards uses, just with a
   different, pre-computed card list and order.

## 14. Study All Cards behavior

The renamed (from "Start review") but behaviorally **identical** existing path: no queue is set,
so `review.tsx` falls back to every live card, `smartShuffle`-ordered, exactly as before this
entire scheduling foundation existed. FSRS is never mandatory for this action — a user can study
every card in a deck regardless of what's due, exactly as they always could, and doing so never
writes any scheduling state unless they actually tap a rating button while doing it (see "Review
flow" above).

## 15. Short-interval limitation (documented, not solved)

A card rated "Again" typically becomes due again within **minutes**, not the next calendar day.
This app does **not** simulate a timer or keep a review screen open waiting for a short-interval
card to become due again — if a user finishes a "Study Due Cards" session before an
`Again`-rated card's own `dueAt` arrives, that card is simply not due yet and will not reappear
until the user starts another session after that time passes (e.g. a bit later the same day, or
the next time they open the deck). This is an accepted, explicit limitation, not a bug: building
a live countdown/auto-reopen mechanism was explicitly out of scope for this batch. Deck-detail's
own due count naturally reflects this correctly — a just-rated "Again" card briefly shows as "not
due yet" for those few minutes, then moves to "due now" once its time arrives, with no extra code
needed to make that transition correct (it falls directly out of the exact-timestamp `isDue`
check already described above).

## 16. Sync considerations

**Now implemented, gated to Development/Staging.** `ReviewEvent` is a first-class synced entity
(`src/cloud/sync/types.ts`, `validateChange.ts`, `SyncService.ts`), gated by its own dedicated
capability check, `isReviewEventSyncEnabled()` (`src/cloud/sync/reviewEventSyncCapability.ts`),
mirroring `isLibraryMetadataCloudSyncEnabled()`'s exact shape and `["development", "staging"]`
allow-list — **deliberately a separate gate**, since ReviewEvent sync may roll out to Production
on its own schedule, independent of Library metadata. `CardSchedulingState` is **not** synced and
is not planned to be — it remains a local-only, derived cache. The design below replaces the
"deliberately not implemented" / "analyzed, not solved" framing this section previously carried;
a prior readable of this document should treat anything below as current, not historical.

**Core principle: `ReviewEvent` is the durable, synced source of truth. `CardSchedulingState` is
derived, recomputable, and never cross-device truth on its own.**

```
Device A events ─┐
                  ├─> merged immutable event history (synced ReviewEvent records)
Device B events ─┘
                          ↓
                 deterministic ordering (reviewedAt, tiebreak by id)
                          ↓
                   replay through the Scheduler
                          ↓
               CardSchedulingState rebuilt (recomputeCardSchedulingState.ts)
```

### Why `ReviewEvent` syncs safely with the existing generic sync model

Every event is immutable, carries a unique, deterministic, content-addressed id
(`computeReviewEventId` — an FNV-1a hash of `cardId|reviewedAt|rating`), and is never mutated
after creation (`rev` is always `1`). Two records sharing an id are therefore definitionally the
same fact, so `SyncService.ts`'s `applyChanges` resolves the `reviewEvent` entity with a pure
**existence check** (`src/cloud/sync/reviewEventMerge.ts`'s `mergeIncomingReviewEvents`) instead of
the generic `incomingWins` rev/updatedAt conflict rule every mutable entity (deck/card/session/
librarySource/sourceCollection) uses: an incoming id already present locally is simply skipped (no
comparison needed); an id not yet present is added. This is also why `markClean`'s existing
generic acked-rev-match logic needed **zero modification** to correctly handle this entity — a
rev that is always `1` degenerates correctly through the same code path every other entity uses.
The backend needed **zero changes**: `sync-push`'s own conditional write
(`attribute_not_exists(PK) OR attribute_not_exists(#record) OR :incomingRev >= #record.#rev`) is
satisfied trivially, since each event's Records-table row is created exactly once and never
collides with the condition's "newer rev already stored" case.

### Deterministic event ordering (`recomputeCardSchedulingState.ts`'s `orderReviewEventsForReplay`)

Primary key is `reviewedAt` (ISO 8601 UTC). Ties — two events with the *exact* same `reviewedAt`,
which can genuinely happen when two devices independently construct a review in the same
millisecond — break on the event's own `id` (the same stable FNV-1a hash used for identity),
never on array/arrival order, so replay order is 100% reproducible across every device and every
recompute.

**Clock-skew limitation, stated plainly, not solved:** `reviewedAt` is client wall-clock time, not
a logical/vector clock or a server-assigned sequence number. If two devices' clocks are skewed,
the chronological order this model derives may not match the real-world order the reviews
actually happened in. What this design *does* guarantee is determinism (the same merged event set
always replays to the same final state, on every device, every time) — not real-world
chronological accuracy under clock skew. Building distributed-clock infrastructure (Lamport
clocks, hybrid logical clocks, a server-assigned monotonic sequence) to close this gap is
explicitly out of scope for this batch.

### Recomputation engine (`src/domain/scheduling/recomputeCardSchedulingState.ts`)

`recomputeCardSchedulingState({cardId, reviewEvents, scheduler?}) → CardSchedulingState` is pure:
no UI dependency, no `Date.now()`, no network/storage access. It de-duplicates its input by event
id (defense-in-depth — the normal caller has already deduplicated via the merge step above, but
this function does not trust that), sorts deterministically, and replays each historical rating
through the `Scheduler` interface starting from the scheduler's own honest "nothing has happened
yet" default — discarding every intermediate state except the final one. A card with zero events
resolves to that same default, anchored at the Unix epoch rather than `Date.now()` (purity); this
is safe because `dueSelection.ts`'s `isNew`/`isDue`/`isOverdue`/`isFuture` all branch on
`state === "new"` before ever consulting `dueAt`.

### Post-sync reconciliation (`SyncService.ts`'s `applyChanges`, `reviewEvent` branch)

After a pull merges new review events for a deck, only the **card ids that actually received a
genuinely new event** (`mergeIncomingReviewEvents`'s `affectedCardIds`) have their
`CardSchedulingState` recomputed and persisted (`upsertCardScheduling`) — never every card in the
deck or app, and never a no-op when every incoming event in a page was already present (a
duplicate/repeated pull). The merged event list used for recompute already includes this device's
own not-yet-pushed local events alongside the newly pulled ones, so a card rated on this device
*and* another device before either had synced still replays its full, true merged history. Due/
New/Not-due counts and the Study Due Cards queue update naturally from the rebuilt, persisted
`CardSchedulingState` — no UI code changed for this; `dueSelection.ts` already reads whatever is
currently persisted.

### Local review flow is unaffected (offline-first preserved)

`app/deck/[id]/review.tsx`'s `onRate` already does, and continues to do, exactly what offline-
first requires: build the `ReviewEvent` and next `CardSchedulingState` purely
(`applyCardReview`), persist both locally (`upsertCardScheduling` + `addReviewEvent`, both marking
`dirty: true`), and advance immediately — no network call, no sync dependency, on the critical
path. Sync (push/pull) happens later, asynchronously, exactly like every other entity.

### Idempotency and duplicates

A `ReviewEvent`'s identity is its `id` alone, never payload equality. The same event pushed twice,
pulled twice, already present locally, or replayed after an app restart is a true no-op at every
layer: `addReviewEvent` (local write) skips an id already present; `mergeIncomingReviewEvents`
(pull-side merge) skips an id already present; `markClean` (push-ack) only clears `dirty` when the
acked rev still matches the stored rev (always `1`, so this degenerates to "mark clean once").
Heavily tested in `src/cloud/sync/reviewEventMerge.test.ts` and
`src/domain/scheduling/recomputeCardSchedulingState.test.ts` (duplicate-event, repeated-pull, and
repeated-recompute cases).

### Card deletion/restore (audited, unchanged)

Soft-deleting or restoring a card/deck never touches `cardScheduling.ts` or `reviewEvents.ts` at
all (confirmed directly — no call site exists in `src/storage/cards.ts`/`decks.ts`); see "Storage"
above. This holds exactly the same now that `ReviewEvent` syncs: a soft-deleted card's review
history keeps syncing/recomputing normally (it is addressed by `cardId`, independent of the card
record's own `deletedAt`), and restoring the card naturally finds its full scheduling history
already intact, recomputed or not. Nothing in this batch invents a permanent-deletion policy for
review history — the only hard removal path remains the dev-only full wipe (`devReset.ts`).

## 17. Algorithm/version strategy

Every `CardSchedulingState` and `ReviewEvent` carries `schedulerAlgorithm` ("fsrs") and
`schedulerVersion` — read directly from the installed library's own exported `FSRSVersion` string
(`"v5.4.2 using FSRS-6.0"` today), never hand-typed. This means:

- A future `ts-fsrs` version bump (or a switch to a different FSRS parameter set) changes what new
  reviews record, without silently reinterpreting what *already-recorded* events/state mean —
  old `ReviewEvent`s remain exactly what they always were: a true record of what happened under
  whichever version produced them.
- **No silent mass rescheduling.** Nothing in this batch ever walks existing
  `CardSchedulingState` records and recomputes them just because the library version changed — a
  future "recalculate everyone's schedule under the new parameters" action, if ever wanted, is an
  explicit, separate, founder-approved product decision, exactly as the mission requires.
- `ts-fsrs` itself is pinned to an **exact** version (`"5.4.2"`, no caret range) specifically so an
  unrelated `npm install`/dependency bump elsewhere in the app can never silently change this
  app's scheduling math underneath it.

**Mixed-version replay (recomputation engine, §16):** `recomputeCardSchedulingState` always
replays every historical event through the CURRENT `activeScheduler`, regardless of which
`schedulerAlgorithm`/`schedulerVersion` each individual event itself recorded at creation time.
This is a deliberate, reasoned choice, not an oversight: FSRS's own review step takes a card's
prior numeric state (stability, difficulty, state, last-review) and a `(rating, now)` pair as
input — it does not need to know which past engine *version* produced that prior state to
correctly schedule the *next* review from it, so replaying old events through today's
`fsrsScheduler` is semantically valid under a version bump within the same algorithm family. The
stored `schedulerAlgorithm`/`schedulerVersion` on each event remains valuable as a historical audit
trail even though replay does not branch on it. **This reasoning does NOT automatically extend to
a future `schedulerAlgorithm` change** (switching off FSRS to a different algorithm family
entirely, not just a version bump) — replaying pre-swap events under a structurally different
algorithm would need its own explicit migration strategy, not silent reinterpretation; nothing in
this batch builds that migration UI or logic, consistent with the mission's "do not build
migration UI" boundary.

## 18. Analytics future (not built, but supported)

Nothing in this batch builds a dashboard. `ReviewEvent`'s fields were chosen so a future one could
be built without a schema change: review count and lapse rate (count/filter events by
`rating`/deckId/cardId), retention-adjacent signals (`previousStability`/`nextStability` deltas),
average response time (`responseTimeMs`), and cards due/workload (`CardSchedulingState.dueAt`
across a deck, via the existing `dueSelection.ts` helpers). Nothing was added that can only be
justified by a hypothetical future screen — every field already named in "Review event model"
above is also directly consumed by this batch's own `applyCardReview`/`reviewEvent.ts`.

## 19. FSRS dependency (full audit)

**Package:** `ts-fsrs@5.4.2` (exact-pinned), MIT license, zero runtime dependencies, dual CJS/ESM
build (`exports.require`/`exports.import`, both present — confirmed directly from the installed
`package.json`), maintained by the `open-spaced-repetition` GitHub organization — the FSRS
algorithm's own reference-implementation org, not a third-party wrapper. At audit time: 829
GitHub stars, ~845,000 npm downloads/month, 3 open issues, last pushed within the audit window.

**Why not the newer `v6.0.0-beta.*` line:** `npm`'s `latest` dist-tag is `5.4.2`, not any `6.x`
version — v6 is still in beta and introduces a significantly different, async,
middleware/`defineScheduler`-based API (`await DefaultScheduler()`) that this audit judged
materially harder to verify correctness for without a real device build, versus the mature,
synchronous, "classic" `fsrs()`/`createEmptyCard()`/`scheduler.next()` API that `5.4.2` (and every
prior major version) actually ships.

**Determinism, verified directly against the installed source, not assumed:** `enable_fuzz`
defaults to `false` in this library (`default_enable_fuzz = false`); `apply_fuzz`'s own
implementation returns `Math.round(ivl)` immediately whenever fuzz is off, *before* ever touching
its `Math.random()`-backed generator. `fsrsScheduler.ts` passes `enable_fuzz: false` explicitly
anyway, so this app's determinism guarantee is visible in code and never silently lost to a future
upstream default change. Verified empirically as well: a real probe script run against the
installed package (not hypothesized) produced the exact values `fsrsScheduler.test.ts` asserts.

**Elapsed-day accounting:** `Card.elapsed_days`/`ReviewLog.elapsed_days` are marked `@deprecated`
in this exact version ("will be removed in version 6.0.0" of the *package*, not the algorithm).
This app never reads either — `utcCalendarDayDiff` (`scheduler.ts`) independently replicates the
library's own internal (and still-exported, non-deprecated) `dateDiffInDays` algorithm exactly
(verified by reading its source directly: a UTC-year/month/date-only calendar-day difference, not
a 24-hour duration divide), so this app's own elapsed-day math stays numerically identical to what
the engine computes internally without depending on a field the upstream package itself intends
to remove.

**Serialization:** `CardSchedulingState` is plain JSON-serializable data (strings/numbers/a plain
object bag for `engineState`) — no `Date` objects, class instances, or library-specific types ever
leave `fsrsScheduler.ts`'s own `toFsrsCard`/`fromFsrsCard` boundary functions.

**Replacement blast radius:** exactly one file (`fsrsScheduler.ts`) plus one line in
`defaults.ts`. No other file in the app imports `ts-fsrs` (confirmed: it is a dependency of this
one file only).

## 20. Known limitations

- **`ReviewEvent` cross-device sync is implemented but gated to Development/Staging** — see
  "Sync considerations" above for the full design. Production and guest builds remain local-only
  for both `ReviewEvent` and `CardSchedulingState`, same posture as Library metadata sync; widening
  the `ALLOWED_ENVIRONMENTS` allow-list in `reviewEventSyncCapability.ts` to Production requires
  explicit founder approval, same as every other environment-boundary change in this app.
- **Clock-skew ordering is a stated, not solved, limitation** — see "Deterministic event ordering"
  above. Two devices with meaningfully skewed clocks can produce a replay order that doesn't match
  the true real-world order those reviews happened in; this batch guarantees determinism
  (same merged input → same output, everywhere), not clock-skew-proof chronological accuracy.
  Building a logical/vector clock or server-assigned sequence number is explicitly out of scope.
- **Recomputation is not incremental** — `recomputeCardSchedulingState` always replays a card's
  *entire* event history from scratch (not just the newly-arrived events applied on top of the
  last known state). This is simple and correct, at the cost of O(history length) work per
  affected card on every pull that touches it — acceptable at this app's current scale (a single
  user's own review history, not a multi-tenant workload), not yet a concern worth optimizing.
- **No daily/weekly review-history pruning or archival** still applies, and now has an added
  dimension: a long-lived, heavily-reviewed deck's review-event history is also what gets pushed/
  pulled/replayed on sync, so unbounded growth affects sync payload size and recompute cost, not
  just local storage, once sync is enabled for an environment. Still accepted as out of scope for
  this foundation batch.
- **The due-queue helpers are now wired — corrected from the previous revision of this
  document**, which said `dueSelection.ts` was built and tested but not consumed anywhere. That is
  no longer true: deck-detail's scheduling summary and "Study Due Cards" button both now call it
  directly (see "Queue construction" and "Study Due Cards behavior" above). Plain "Study All
  Cards" intentionally still uses the pre-existing, unchanged `smartShuffle` ordering — there is
  still no due-aware ordering inside that specific path, by design, not oversight.
- **No daily new-card limit is enforced anywhere** — `buildDefaultReviewQueue`'s `newCardLimit`
  parameter exists and is tested, and "Study Due Cards" now calls it with `0` specifically to
  exclude new cards entirely from that action, but nothing persists a daily "how many new cards
  have I already introduced today" counter — there is no new-card introduction flow in this
  batch at all (new cards only ever enter the schedule via a real review in "Study All Cards").
- **No short-interval timer/auto-reopen mechanism** — see "Short-interval limitation" above; a
  card due again in a few minutes simply won't appear again until a later session.
- **Session history cannot distinguish a "Study Due Cards" session from a "Study All Cards" one**
  — `SessionRecord` was deliberately left unchanged (see "Session/history audit" above); both
  simply record a `total`/aggregate review session, same as always.
- **No workload planner, exam-date planner, mastery dashboard, streaks, or gamification** — all
  explicitly out of scope per the mission, and nothing here was built toward them speculatively.
- **Quiz mode is entirely unaffected** — it remains ungraded and aggregate-only; a future "grade
  quiz answers into the scheduler too" decision is separate, explicit future work.
- **No daily/weekly review-history pruning or archival** — a very long-lived, heavily-reviewed
  deck's per-deck review-event store will grow unboundedly over years; accepted as out of scope for
  this foundation batch, same posture as every other "do not build a complex X yet" boundary here.
- **No native rebuild is required** for anything in this batch (`ts-fsrs` is pure JS/TS, no native
  module) — but no on-device testing has been performed from this environment either; this is
  static-checks-clean, not yet founder-runtime-QA-verified.

## 21. Founder QA

See the final report's "Founder QA checklist" for the full device-testing matrix. In short:
create a card, review it with each of the four ratings and confirm sensible interval ordering
(Again < Hard < Good < Easy in urgency), confirm the card's schedule and review history both
survive an app restart, confirm editing a card's content never disturbs its scheduling history,
confirm delete/restore preserves scheduling history, confirm AI-generated and manually-created
cards both schedule identically (scheduling state is keyed by `cardId` alone — it has no idea how
a card was created), and confirm quiz mode, smart shuffle, and existing session history are all
completely unaffected.

This update adds: a new deck with no reviews yet shows the right "New" count; opening "Study Due
Cards" with nothing due shows "You're caught up" without opening a review session; rating a card
"Again" and confirming it does *not* immediately reappear in "Due now" before its own interval
elapses, then *does* once that time passes; rating another card "Easy" and confirming it stays
out of "Due now"/the due queue for its full (multi-day) interval; counts and the due queue surviving
an app restart; "Study All Cards" still working and never writing scheduling state unless a
rating is actually tapped; and the rating explanation/accessibility copy reading sensibly in
Arabic (RTL) and through a screen reader.

**Multi-device scheduling sync (Development or Staging build only — see "Sync considerations"
above for why Production is excluded):**

1. Device A, offline (airplane mode), rates a card "Good."
2. Device B, offline, signed into the *same* account, rates the *same* card "Again."
3. Reconnect both devices and let sync run (or trigger it manually).
4. After sync, confirm — on either device — that **both** `ReviewEvent`s survive (no event was
   silently dropped or overwritten by the other).
5. Confirm both devices converge on the exact same final due date/scheduling state for that card
   (deterministic recomputation, not whichever device happened to sync last).
6. Restart both devices (force-quit and reopen).
7. Confirm the same scheduling result still holds after restart on both devices.
8. Trigger a manual resync again on either device with no new reviews. Confirm nothing changes
   (duplicate sync is a true no-op).
9. Soft-delete the reviewed card, then restore it. Confirm its full review history and scheduling
   state are exactly as they were before deletion.
10. Open "Study Due Cards" on either device and confirm it reflects the recomputed schedule.
11. Confirm "Study All Cards" still works normally and is unaffected.
12. (Optional, documents the stated limitation rather than testing a fix) deliberately set one
    device's clock a few minutes off before step 1–2, and confirm sync still converges to one
    deterministic result on both devices — it may not match true wall-clock chronological order,
    and that is the accepted, documented limitation, not a bug to chase.
