# Source Coverage

A read-only, truthful layer over the Library/Source Normalization/Generate Study Deck
architecture: for a given Library source, which of its normalized chunks already have at least
one **live, saved** study card referencing them, and which don't.

**Implemented, merged into `v3.3-dev`; not yet founder-QA verified.** On-device computation with gated metadata sync, no
network call beyond what `normalizeSource()` already does for Generate/Reader/Preview, no AI, no
cost, no backend/AWS/CDK change.

The domain/service are split across two files, with presentation in
`src/ui/SourceCoverageCard.tsx`, using the same pure/impure separation `src/domain/ai/aiConsent.ts` already
established: `src/domain/sourceCoverage.ts` (types + `computeSourceCoverage`,
`deriveCoveredChunkIds`, `deriveSourceCoverageDisplayState` — pure, no storage/RN import, directly
`node --test`-able) and `src/domain/sourceCoverageService.ts` (`loadSourceCoverage` — the async
orchestration that actually calls `normalizeSource`/storage).

## What this is NOT

- **Not AI generation.** Nothing here calls a model provider or produces card content.
- **Not the same thing as `src/domain/ai/generationCoverage.ts`'s `GenerationCoverage`.** That is
  a one-generation-session budget disclosure ("how much of the source fit in this generation's
  context window"), computed once at generation time and never persisted. Source Coverage is a
  persistent, after-the-fact question computed fresh any time the source is viewed, and it only
  cares about chunks a **saved** card actually cites — a chunk the model "saw" during a
  generation whose deck was never saved contributes nothing.
- **Not mastery, retention, or learning progress.** "42 of 143 source sections covered" means
  exactly that: 42 sections have at least one saved study card referencing them. It says nothing
  about whether the user has studied, remembers, or has mastered that card — that's FSRS
  scheduling state (`docs/spaced-repetition-foundation.md`), a completely separate concept. UI
  copy is deliberately worded to avoid implying otherwise (never "29% of this book learned").

## Presentation states

The Source Detail card uses the existing themed Card/ProgressBar surfaces. Its hierarchy is
Study coverage → covered/total statement → whole percentage → compact progress bar → remaining
count (or available count when nothing is covered) → a short explanation. No generation action
or navigation is added; a future source-scope CTA can sit beneath this summary without changing
the read-only component or the coverage calculation.

| State | Presentation |
| --- | --- |
| Loading | “Checking coverage…” with a small activity indicator; no percentage or stale counts |
| Load failure | Generic retry-on-return guidance, distinct from a successful empty result |
| Zero sections | “No studyable sections found.” No percentage or progress bar |
| Zero covered | “No study cards cover this source yet.”, 0%, and “193 sections available.” |
| Partial | “8 of 193 sections covered”, 4%, and “185 sections remaining” |
| Complete | “All 193 sections are covered.” and 100%; singular copy for a one-section source |

“Sections” means normalized chunks across formats, never inferred chapters/pages/cells. The
caption explains that coverage means at least one saved study card per section; it is not a
claim about mastery, memory, learning, or reading completion. All 13 locales include this copy
and use the existing CLDR plural selection for count-bearing messages.

### Percentage and remaining count

Presentation uses nearest-integer rounding (`Math.round(covered / total * 100)`) with partial
coverage capped at 99%. Thus 8/193 → 4%, 192/193 → 99%, 999/1000 → 99%, and 193/193 → 100%.
Very small positive coverage may round to 0%; the exact covered/total text remains visible.
Zero sections has no percentage, while zero covered out of a real total displays 0%.
The bar retains the real fraction, independent of whole-number rounding.

Remaining is `total - covered`, after presentation-only validation of safe integer counts and
clamping covered to [0, total]. It cannot be negative. Invalid totals show no-content; invalid
covered counts display zero. The domain coverage sets, provenance, ratio, and normalization are
unchanged. `uncoveredChunkCount` already exists on SourceCoverage; the display helper derives
the same count defensively instead of trusting inconsistent input hints.

### Accessibility and loading

The heading is a screen-reader heading. The progress bar exposes the progressbar role,
covered/total numeric values, and localized covered/total plus percentage text. Visible counts,
remaining text, and the explanation keep coverage understandable without color. Text scales
normally without single-line truncation; content is stacked to accommodate large type. Arabic
text follows the local RTL helper and the bar fills from the right. Other progress-bar consumers
retain their existing defaults. VoiceOver/TalkBack and largest-type device QA are still pending.

Coverage remains asynchronous and never gates Source Detail actions. A minimum-height content
area reduces loading transitions without fixing the card's height. Loading hides prior counts;
a failed load does not masquerade as 0% or a successful empty extraction. A request id now
invalidates results before metadata awaits and on blur as well as on refocus. It discards stale
results, not the underlying normalization work. Returning to the source recalculates coverage
from current live cards after card/deck deletion or restoration; no counters or cache were added.
Errors are handled without logging or showing raw storage/parser errors. Normalization outcomes
that return an empty chunk set still map to the existing no-content state; this polish does not
change normalization semantics or the service result contract.

## Exact meaning of coverage

```
covered chunk   = a normalized chunk from this source whose chunk id is referenced by the
                  sourceChunkIds of at least one LIVE saved card
uncovered chunk = a current normalized chunk from this source with no live card referencing it
```

### What counts

- A card saved through the normal Generate Study Deck → Review → Save flow
  (`src/domain/ai/generateDeckSave.ts`), which recorded a `GeneratedCardProvenance` entry
  (`src/models/generatedCardProvenance.ts`) at save time.
- That card must still be **live**: not soft-deleted (`CardRecord.deletedAt` unset), whether it
  was deleted individually or via its deck's cascade delete.
- Coverage aggregates across **every** live card referencing the source, regardless of which
  deck each card lives in (see "Multi-deck aggregation" below).

### What does NOT count

- A generation draft that was reviewed but never saved (`GenerateDeckSession` is in-memory only
  and is simply discarded — see `src/domain/ai/generateDeckSession.ts`).
- Deleted provenance, a missing/deleted card, or a card whose parent deck is missing/deleted.
  Parent-deck exclusion applies even when cascade card changes have not arrived yet.
- A card that was never generated from this source — a different source's cards, a manual card,
  or a CSV/Quizlet-imported card (`docs/flashcard-import.md`). None of these ever produce a
  `GeneratedCardProvenance` entry, so they are excluded by construction, not by a special check.
- "The model once saw this chunk during generation" alone, with no saved card to show for it.
  Coverage is strictly **study card coverage**, never "exposure to the model."

## Chunk identity dependency

Coverage is only sound because `src/domain/normalization/chunking.ts`'s `computeChunkId` is a
deterministic, content-addressed fingerprint of `(sourceId, normalizationVersion, index, chunk
text)` — **never** a random id. Re-normalizing byte-identical source content always reproduces
the same chunk ids; this is the existing contract (see `chunking.ts`'s own doc comment), it was
not changed for this feature, and it is now directly tested in
`src/domain/normalization/chunking.test.ts` (the shared primitive had only indirect,
adapter-specific determinism tests before this batch — see `docs/docx-reader.md`/the DOCX and PDF
adapters' own test files for those).

Two consequences that follow directly from content-addressing, not from anything Source Coverage
itself adds:

- If a source's content changes (a new file is attached, or a future edit-in-place feature ever
  exists), chunk ids for the changed sections change too, and old provenance referencing those
  ids simply stops matching — it is silently and correctly treated as uncovered for the
  now-different content. This is **not a bug**; a stable id is defined to mean stable content.
- If `NORMALIZATION_VERSION` is ever bumped (the segmentation *algorithm* changes), every chunk id
  for every source changes, and all existing provenance becomes stale in the same way. This is an
  accepted, documented consequence of content-addressed identity — see "Known limitations" below.

`computeSourceCoverage` (`src/domain/sourceCoverage.ts`) treats any provenance chunk id that
doesn't appear in the CURRENT normalized chunk list as simply absent — it is never counted and
never throws. This is what makes both of the scenarios above degrade safely instead of crashing
or showing a nonsensical number.

## Why provenance remains a separate link store

Before this batch, a saved `CardRecord`/`DeckRecord` carried **zero** trace of the source/chunks
it was generated from — `src/domain/ai/generateDeckSave.ts` read `draftCard.sourceChunkIds` only
to build the review-time citation and then discarded it at save time, by explicit design (see
`docs/generate-study-deck-ux.md`'s former "Source relationship & provenance persistence
(deliberately deferred)" section, now updated to point here). CLAUDE.md explicitly forbids adding
a source-origin field to `CardRecord`/`DeckRecord` — both are on the live Production sync path,
so any new field reaches Production the next time any signed-in user syncs.

So, exactly as `docs/deck-collections.md` already did for deck↔collection membership, this batch
uses a **separate provenance entity** instead of adding fields to the card/deck models.
See [Generated card provenance sync](./sync-generated-card-provenance.md) for the schema,
migration, conflicts, environment gates and rollout limitations:

- **Model**: `src/models/generatedCardProvenance.ts` — card/source/chunk identity and save time,
  with id/rev/updatedAt/dirty and optional tombstone/version fields. No source or card text.
- **Storage**: `src/storage/generatedCardProvenance.ts`, key
  `interval.generatedCardProvenance.v1` (`src/storage/generatedCardProvenanceKeys.ts`),
  `scopedKey`-partitioned exactly like decks/cards/Library/Deck Collections.
- **Synced in Development/Staging**, under its own fail-closed capability gate. Production and
  guests retain local-only provenance; AI provider rollout remains separate.
- **Written once**, in `saveDraftDeck` (`src/domain/ai/generateDeckSave.ts`), immediately after
  `setCards` succeeds — best-effort: a failure to record provenance never rolls back the
  already-successful deck/card save (same "additive, never a new failure mode for the core save"
  posture the rate-limiter and consent batches used for their own non-critical side effects).

This is persisted source-relationship metadata, not a CardRecord field — flagging it plainly here rather than
treating it as an implementation detail, since CLAUDE.md's existing guidance for the analogous
Deck Collections decision called this kind of thing "real product-architecture work."

## Multi-deck aggregation

One source may contribute cards to multiple decks (e.g. two separate Generate sessions, saved as
two different decks). Coverage aggregates across **every** deck's live cards referencing the
source — `src/domain/sourceCoverage.ts`'s `deriveCoveredChunkIds` collapses all `sourceChunkIds`
from every matching provenance entry into one `Set`, so a chunk covered by a card in Deck A and a
different chunk covered by a card in Deck B both count, and a chunk covered by cards in *both*
decks is still one covered chunk, not two references.

## Deletion / restoration behavior

Coverage is **always derived fresh** from current source chunks + current live card provenance —
there is no persistent incremented/decremented counter anywhere that could drift:

- Deleting the last card that covered some chunk removes that chunk from `coveredChunkIds` the
  next time coverage is computed (nothing is pre-computed or cached).
- Restoring a card (`restoreCardToDeck`) makes its provenance entry "count" again automatically —
  the provenance entry itself was never touched by the delete; card and parent-deck liveness
  are re-checked. Recovery-deck restores follow the newer card location.
- Deleting an entire deck cascades `deletedAt` onto every one of its cards
  (`deleteDeckById` in `src/storage/decks.ts`) — those cards stop being live, so their chunks drop
  out of coverage with no special-case code in the coverage layer itself. Restoring a
  cascade-deleted deck is symmetric.
- A provenance entry is **not** deleted when its card is soft-deleted — it simply stops
  contributing because the card it names is no longer live. It would only need cleanup if the
  card's row were ever hard-removed from `CardRecord` storage entirely outside of the (never
  used in this product) `deleteCardsForDeck` hard-delete path, which only ever runs on a
  just-created, never-synced deck being rolled back — before any provenance for it is written.

## Format behavior (TXT / PDF / DOCX / XLSX / image / audio)

No `sourceType` branching exists anywhere in `src/domain/sourceCoverage.ts` or
`src/domain/sourceCoverageService.ts` — the latter only ever reads
`NormalizedSourceContent.chunks`, which every adapter already produces uniformly:

- **TXT / PDF / DOCX / XLSX**: real chunk counts from their respective adapters; coverage behaves
  identically across all four.
- **image / audio**: structural stubs that always produce `chunks: []` (no OCR/transcription —
  see `docs/source-normalization-foundation.md`), so these sources always show the
  "No studyable sections found." (`totalChunkCount === 0`) state. Fast and free to compute — the
  image/audio adapters need no file resolution at all, only already-known `LibrarySourceRecord`
  metadata.
- **Any source whose normalization result is `empty` / `unsupported` / `pending-extraction` /
  `too-large` / `failed`**: `normalizeSource()` already guarantees `chunks: []` for every one of
  these outcomes (see `normalizeSource.ts`'s `stubContent` helper) — Source Coverage reads only
  the chunk count, never the `extraction.status` itself, so all of these collapse to the same
  honest "no content" display state with no extra branching.

## Performance approach

`normalizeSource()` has its own explicit, pre-existing contract: always computed on demand, no
cache, deterministic. This batch does not add a cache layer (per the mission's own "do not
introduce a broad persistent normalization cache unless necessary" instruction) — adding one
would duplicate `normalizeSource`'s own invalidation problem (knowing when a source's underlying
content changed) for a feature that doesn't need millisecond latency.

Instead, Source Detail (`app/library/[id]/index.tsx`) loads coverage **separately from, and never
blocking**, the rest of the screen:

- The existing `load()` (triggered by `useFocusEffect`, i.e. every time the screen gains focus)
  still resolves the fast, local-only source/collections/local-file data first and renders
  immediately, exactly as before this batch.
- Coverage is kicked off as its own non-blocking async call (`loadSourceCoverage`) right after,
  shown with its own small loading state inside just the Coverage card — it never gates the rest
  of the screen (actions, Open Original, Generate) on normalization finishing.
- A monotonically increasing request-id ref discards a stale result if the screen re-focuses
  (and so re-triggers coverage loading) before a previous call resolves — this prevents a
  slow earlier call from clobbering a newer one's result; it also invalidates on blur and before
  metadata awaits; it does not cancel the earlier call's
  actual work (no `AbortController` plumbing was added to `normalizeSource` for this batch).
- For `pdf`/`docx`/`xlsx`/`text` sources, computing coverage can mean a real local file read and,
  if no local copy exists, a cloud-fallback download (`resolveSourceOriginal`) — the exact same
  mechanism Generate Study Deck's own "Checking this source…" step already triggers automatically
  on every visit to that screen. Visiting Source Detail triggering the same kind of work is
  consistent with that existing precedent, not a new class of automatic network behavior.

## Known limitations

- **Coverage card visibility is tied to `isGenerateStudyDeckEnabled()`** (Development/Staging
  only, same gate Generate Study Deck itself uses) and hides on an archived source — reusing the
  existing gate already computed on this screen, rather than inventing a second one. Without
  Generate enabled, no card can ever carry provenance, so showing the section anywhere else today
  would only ever read "No study cards cover this source yet," forever. This was a product
  judgment call made in this batch, not a founder decision — revisit if Generate's own gate ever
  changes.
- **Provenance now syncs in Development/Staging** as a separate metadata entity. Equal delivered
  record sets and identical normalized chunks give the same coverage on each device. Production
  remains local-only. Real-device QA is pending; old clients that skipped provenance need replay,
  and the inherited timestamp-cursor limitation can miss backdated offline uploads. See
  [provenance sync](./sync-generated-card-provenance.md) before rollout.
- **A `NORMALIZATION_VERSION` bump invalidates all existing provenance** for every source, as
  described above — there's no migration step that remaps old chunk ids forward. This has not
  happened yet (the version has been `1` since the normalization foundation shipped) and would be
  a one-time, intentional consequence of a deliberate algorithm change, not a bug.
- **No automated UI/screen test.** Real sync-loop and coverage-service integration now use
  mocked native/transport boundaries under `npm run test:provenance`; this is not device QA.
 Like the rest of this codebase's RN rendering, the Source
  Detail coverage section itself is exercised only by founder runtime QA; the pure domain logic
  (`computeSourceCoverage`, `deriveCoveredChunkIds`, `deriveSourceCoverageDisplayState`) has full
  `node --test` coverage (`npm run test:coverage`).
- **No ordered/per-chunk UI.** Per the mission's own scope, this batch ships aggregate coverage
  only (counts + a progress bar) — no page-by-page or section-by-section breakdown list, even for
  PDF where page provenance would make one truthful. Left for a future batch if the founder wants
  it; the domain layer already returns `coveredChunkIds`/`uncoveredChunkIds` in normalized chunk
  order, so building that list later would not require new domain code.

## Future Discover compatibility

Nothing in `src/domain/sourceCoverage.ts`/`src/domain/sourceCoverageService.ts` is
Discover-specific — `loadSourceCoverage(scope, source)` is a plain, reusable domain function keyed
only on `WorkspaceScope` + `LibrarySourceRecord`. A future "what source material has no cards?" or
"which sources are
under-covered?" Discover feature (not built here — see `docs/discover-preview-foundation.md`'s
own explicit scope) could call this same function across every source in a workspace without any
change to this file. No Discover-specific logic, copy, or gating was added to this module.

## Future stale-card compatibility

Not implemented here (explicitly out of scope for this batch), but the chunk-identity contract
above already provides the mechanism a future stale-card detector would need: if a chunk's
content changes, its id changes, and any card whose `sourceChunkIds` still point at the OLD id
would be detectable as "generated from content that no longer exists in this source" simply by
checking whether a `GeneratedCardProvenance` entry's chunk ids are a subset of the CURRENT
normalized chunk id set — exactly the same check `computeSourceCoverage` already does to decide
what's covered. A future feature would not need new identity infrastructure, only a new UI/alert
built on top of data this batch already produces. No source versioning was added, since this
existing content-addressed identity is already sufficient — adding a separate version counter
would be redundant.

## Founder QA

Presentation polish still requires device QA: zero-card, partial, near-complete (999/1000 must
show 99%), complete, loading/error, navigate away/back, card delete/restore, deck delete/restore,
Arabic RTL, largest Dynamic Type, and VoiceOver/TalkBack. No device verification is claimed.

1. Open a source with zero generated cards → "No study cards cover this source yet," 0%
   progress.
2. Generate → Save a deck from that source → return to Source Detail → coverage count increases
   and reflects the saved cards' chunks.
3. Generate → Save a second deck from the same source, citing some overlapping and some new
   chunks → coverage reflects the union, not a doubled count for the overlapping chunks.
4. Delete the only card covering a chunk → that chunk becomes uncovered; the chunk count drops by
   exactly the chunks that lost their only covering card.
5. Restore that card → coverage returns to what it was before deletion.
6. Delete the whole deck containing some covering cards → those chunks become uncovered; restore
   the deck → coverage returns.
7. Confirm a manually created or CSV/Quizlet-imported card never changes this source's coverage
   numbers.
8. Repeat the above for a PDF, a TXT, a DOCX, and an XLSX source — coverage should behave
   identically (no format-specific UI difference beyond whatever `normalizeSource` itself
   already produces for that format).
9. Confirm the Coverage card never appears for an archived source or when Generate is disabled
   for the active environment.
10. RTL: open under Arabic — heading/summary text and the progress bar read correctly
    right-to-left; the percentage and counts are not conveyed by color alone.
11. Accessibility: with a screen reader, confirm the progress bar announces a role/value and the
    adjacent text states the same counts in words.
