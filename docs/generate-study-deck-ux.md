# Generate Study Deck — UX Shell

**Status: implemented, founder runtime QA verified, and integrated into `v3.2-dev`.** Gated by
`isGenerateStudyDeckEnabled()` to `INTERVAL_ENV` `development`/`staging` — hidden in Production.
Generation still uses the deterministic local mock provider only; there is no production model
provider, no network AI call, and no deployed AI backend.

This is the first user-facing AI workflow in Interval: **Library source → Generate → choose
options → review draft → edit / delete cards → Save as a real deck.** It is a UX/product shell
built on top of the already-merged [AI Generation Foundation](./ai-generation-foundation.md) and
[Source Normalization Foundation](./source-normalization-foundation.md).

It uses the **deterministic local mock provider** (`src/domain/ai/mockProvider.ts`) through the
existing AI service boundary. There is **no production model provider, no network AI call, and no
AWS resource** anywhere in this batch. A future production provider is a separate, founder-gated
change — see "Future production provider integration" below.

An independent audit found storage-safety and correctness issues in the first cut; they were
remediated before founder QA. See "Save semantics", "Route / session consistency", "Provenance
behavior", and "Content direction" for the fixes (audit refs CRITICAL-1/2, HIGH-1/2,
MEDIUM-1/2/3, LOW-1/2).

## Product flow

```
Library Source Detail
  └─ "Generate study deck"  (app/library/[id]/index.tsx, gated — see "Capability gate")
       ▼
  app/library/[id]/generate/index.tsx
    • normalizes the source and checks availability (see "Supported source types")
    • if ready: shows the options form (card count / difficulty / card style)
    • "Generate deck" → calm in-place generating state → mock generation
       ▼
  app/library/[id]/generate/review.tsx   (reads the in-memory draft session)
    • editable deck title
    • card list with per-card provenance, Edit, and Delete
    • "Save deck"  → creates a real DeckRecord + CardRecord[] → navigates to the new deck
    • "Discard draft" / back → confirmation only if the draft was edited
       ▼
  app/library/[id]/generate/edit-card.tsx   (edit one draft card's front/back)
```

Nothing is written to deck/card storage until the user explicitly taps **Save deck**. AI output
is always a draft.

## Capability gate

`isGenerateStudyDeckEnabled()` (`src/domain/ai/generateStudyDeckCapability.ts`) restricts the
entire shell to the `development` and `staging` environments, deliberately mirroring
`isLibraryMetadataCloudSyncEnabled()` and `isLibrarySourceStorageEnabled()`. It is its **own**
capability, not merged with either of those. A Production build never surfaces the entry point,
and the generate routes render an "unsupported" state if reached directly. Fails closed (returns
`false`) when environment config can't be read (e.g. a guest with no `INTERVAL_ENV`).

Widening this to `production` must happen here, together with real provider wiring — never as a
side effect of another capability change.

## Supported source types

Generation availability is a thin mapping over `NormalizedSourceContent.extraction.status`
(`src/domain/ai/generationAvailability.ts` → `deriveGenerationAvailability`). The normalization
layer already does the `sourceType` → status work; this shell only decides what to tell the user.

| Normalization status | Source types (today) | Shell behavior |
| --- | --- | --- |
| `ready` | **TXT** (`text-v1`), **PDF with extractable text** (`pdf-text-v1`), **DOCX with real content** (`structured-blocks-v1`), **XLSX with real cell content** (`spreadsheet-structured-v1`) | Generation allowed |
| `empty` | TXT/PDF/DOCX/XLSX with no extractable text (e.g. a scanned/image-only PDF, an image-only DOCX, or a workbook with no non-blank cells) | "No usable text" — honest, no generation |
| `too-large` | TXT/PDF over their byte/page/extracted-text ceilings; DOCX over its block-count ceiling; XLSX over its row-count ceiling | "Source is too large" |
| `pending-extraction` | **PDF only**, and only if the native text-extraction module isn't loaded in this runtime (e.g. Expo Go, or a build that hasn't picked up the native dependency yet) | "Not ready for generation yet" — honest not-ready state |
| `unsupported` | image, audio, pptx — see docs/ai-multiformat-generation.md for why image/audio remain unsupported despite being investigated in depth | "Not supported" |
| `failed` | any source that couldn't be resolved/read, a password-protected/corrupted PDF, or an encrypted/unrecognized DOCX/XLSX | Friendly failure state with Retry |

Internal `ExtractionStatus` / `GenerationErrorCode` values are never shown to the user — every
state has a localized title/body pair.

## Source coverage disclosure

**Status: implemented, pending founder runtime QA.** Static checks (`tsc`, lint, `test:ai`)
pass; this has not yet been exercised on a real build against an actual large source — see
"Founder QA matrix" steps 22–25 below.

**Problem this fixes:** founder QA on a large PDF (193-page *The Great Gatsby*) requesting a
25-card "Large" deck produced only 9 cards. Generation itself was correct — the model only
received the bounded subset of the source that fits one generation's context budget and
correctly refused to invent cards from material it never saw — but the UI never made that
boundedness clear before the user chose a card count, so "25 cards" read as a promise rather
than a maximum.

**This is one of two independent causes of "fewer cards than expected," not the whole story.**
A later founder-QA example (Medium selected, 19 of 193 sections supplied, only 7 cards returned)
showed the model ALSO under-producing relative to what the SUPPLIED context could actually
support — 19 sections is plenty of material for well more than 7 cards. That second cause — the
model instruction itself only ever stating a ceiling ("produce up to N — fewer if not enough"),
with no stated quality floor and no requirement to explain an undershoot — is fixed separately by
`docs/ai-generation-foundation.md`'s "Count contract and insufficient-distinct-content" section
(`targetMinimumCardCount`/`GenerationStatus`). That batch does not touch anything described below
— bounded `GenerationContext` sizing is unchanged, and "19 of 193 sections used" vs "N cards
generated" remain two different, independently-explained numbers.

`src/domain/ai/generationCoverage.ts` is the generic (not PDF-specific) decision layer for this:

- `summarizeGenerationCoverage()` reshapes the **existing** context-preparation fields
  (`GenerationContext.fullSourceIncluded` / `chunkCount` / `excludedChunkCount`, already computed
  by `contextPreparation.ts` for every generation) into `{ fullSourceIncluded,
  includedChunkCount, totalChunkCount }` — `totalChunkCount` is simply `included + excluded`.
  **No second, independent source-size computation was added anywhere.**
- `hasTrustworthyChunkScope()` gates whether a specific "using X of Y" figure is shown — false
  only for the one edge case where the numbers wouldn't be meaningful (e.g. a source somehow
  reporting zero total chunks); the caller falls back to a plain, non-numeric sentence instead of
  ever inventing a number.
- `deriveFewerCardsExplanation()` decides which of two honest explanations applies when the
  result has fewer cards than requested: **"full-source"** (the whole source was used; the
  material itself didn't support more useful cards — a legitimate, non-error outcome) or
  **"partial-source"** (only part of the source was available, so incomplete coverage is an
  additional, honest explanation). A zero-card result and a result that met/exceeded the request
  are both `"none"` — handled by the pre-existing "no cards" / no-message paths instead.

None of this branches on `sourceType`/PDF/TXT — a large TXT and a large PDF are described
identically, satisfying the "implement generically, don't fork by source type" requirement.

**Setup screen** (`app/library/[id]/generate/index.tsx`): `checkGenerationAvailability` now also
runs `prepareGenerationContext` on the normalized content (the SAME call `generateStudyDeck` will
make, with the same default budget — not a duplicate size computation) so the screen knows
up front, before the user ever taps Generate, whether the source will fit:

- **Full source fits:** no extra warning box — the normal, low-friction experience is unchanged.
- **Source will be partial:** a prominent disclosure box (`generateDeck.coverage.setupPartialTitle`
  / `setupPartialBody`, plus `scopeSummary` — e.g. "Using 12 of 143 sections of this source" —
  when `hasTrustworthyChunkScope`) explains this BEFORE the user chooses a card count.
- Under the card-count picker, a caption always clarifies that counts are maximum targets, not
  guarantees (`cardCountHintFull`), switching to a reason-specific version
  (`cardCountHintPartial`, "You requested up to N cards. Because only part of this source can be
  used in one generation, Interval may create fewer.") when the source is partial. The
  `cardCountSmallHint` / `MediumHint` / `LargeHint` presets themselves were reworded from "About N
  cards" to "Up to N cards" — "about" wrongly implied the result could land either above or below
  the target; "up to" matches the real maximum-target semantics.

**Review screen** (`app/library/[id]/generate/review.tsx`): shows the coverage note (numeric when
trustworthy, else the plain sentence) whenever `!fullSourceIncluded`, and — distinctly — a
"fewer cards than requested" explanation when `generatedCardCount < requestedCardCount`:
`fewerCardsFullSource` ("Interval created fewer cards based on the available source material")
for case A, or `fewerCardsPartialSource(WithScope)` ("Created 9 cards using 12 of 143 sections of
this source") for case B. The two never double up: when the combined "fewer cards, partial
source" sentence already cites the chunk scope, the separate plain coverage note is suppressed.
Neither message ever implies the model/provider failed or claims certainty about private model
reasoning — both are deliberately framed as legitimate, non-error outcomes.

**What this does not do:** no RAG, embeddings, vector search, multi-pass summarization,
multi-model generation, automatic chapter summarization, page-range/topic selection, a larger
context limit, retries to fill a requested card count, or a forced minimum card count. No invented
page ranges — `scopeSummary` only ever cites chunk counts, which are always exact (never a
"percent of document" estimate). Whole-document generation for very large sources remains future,
founder-gated work (see "Limitations"). This still holds after the separate count-contract batch
referenced above: `targetMinimumCardCount` is a quality TARGET the model is instructed to aim
for and self-report honestly against, never a mechanically forced minimum — nothing anywhere
retries automatically or locally fabricates/duplicates a card to reach it.

## Mock-provider status

`createMockProvider()` (`mock-v1`) is deterministic, requires no credential, makes no network
call, and prefixes every card front and the deck title with `[MOCK]` so nothing downstream can be
mistaken for real AI output. The options screen and the review screen both show a persistent
**"Development preview"** notice stating that cards come from a local mock, not a production AI
model. The generating state is a short, calm in-place transition — there is **no artificial
multi-second delay** (mock generation is local and near-instant).

**Loading-screen copy correction.** The generating screen's body text previously read "This stays
on your device" — incorrect once the real backend provider is active (selected source text is
sent to Interval's backend/cloud AI service; see `docs/ai-generation-foundation.md`'s "Privacy
model" and "First-use consent" sections, which remain the authoritative disclosure). Corrected to
one generic, provider-neutral sentence ("Reading the selected source material and generating your
cards.") used for both mock and real generation — this batch does not add environment-specific
loading copy, per the mission's own explicit allowance for a single generic, truthful message.

Architecture is preserved end to end: **UI → `runGenerateDeckFlow` → `generateStudyDeck`
(aiService) → `ModelProvider` (mock)**. No screen imports the mock provider or `aiService`
directly.

## Draft model

The draft lives only in memory, in a single-slot module store with a `useSyncExternalStore`
subscription (`src/domain/ai/generateDeckSession.ts`) — no AsyncStorage key, no file, nothing
synced. It holds:

- `deckTitle` — editable, seeded from the generated title
- `cards[]` — `{ id, front, back, sourceChunkIds }`, editable / deletable
- `provenanceByChunkId` — chunk id → real `{ lineRange, page, heading }` from normalization
- `options`, `providerId`, `requestedCardCount`
- `coverage` — `{ fullSourceIncluded, includedChunkCount, totalChunkCount }`, captured once at
  generation time (see "Source coverage disclosure" below)
- `generatedCardCount` — the card count generation itself produced, BEFORE any review-screen
  deletion; distinct from `cards.length`, which shrinks as the user deletes cards
- `targetMinimumCardCount`, `generationStatus` — the tier's quality floor and the AUTHORITATIVE
  (never model-self-report-trusted) shortfall status; see `docs/ai-generation-foundation.md`'s
  "Count contract and insufficient-distinct-content" section. Drives the review screen's
  "fewer cards were created" banner.
- `edited` — set on any title/card change or deletion; drives the discard-confirmation prompt

If the app is killed mid-review the draft is simply gone. That is the intended behavior for
un-accepted AI output.

### Edit / delete

- **Edit card** validates non-empty front and back and enforces the same `MAX_FRONT_LENGTH` (300)
  / `MAX_BACK_LENGTH` (500) ceilings `responseValidation.ts` applies to generated cards, so a
  user edit can never make a card larger than a generated one is allowed to be.
- **Delete** removes the card from the draft immediately (it is only a draft).
- **Provenance is never user-editable.**
- If every card is removed, **Save deck** is disabled with an explanation.
- The deck title must be non-empty to save.

## Save semantics

`saveDraftDeck()` (`src/domain/ai/generateDeckSave.ts`) creates the deck and cards through the
**existing** `decks.ts` / `cards.ts` storage APIs only — no raw AsyncStorage key is touched:

- `addDeck(scope, deck)` with `makeId()`, `rev: 1`, `updatedAt`, `dirty: true` — identical to
  `app/create-deck.tsx`.
- `setCards(scope, deckId, cards)` with a fully-formed `CardRecord[]` — each record `rev: 1`,
  `dirty: true`, `updatedAt` set, no tombstone, i.e. byte-for-byte the shape `addCard` produces.
  `setCards` (one write) rather than N sequential `addCard` calls only to avoid up-to-40
  AsyncStorage round-trips. Cards are built in reviewed (top-to-bottom) order.
- Card difficulty is derived from the generation difficulty option
  (`basic → easy`, `balanced → medium`, `advanced → hard`).

**Scope binding (audit CRITICAL-1).** The draft session captures the active `WorkspaceScope` at
generation time (`GenerateDeckSession.sourceScope`). Save uses **that** scope as the source of
truth — never a scope re-resolved at save time. The review screen also compares the current
active scope against `sourceScope` on focus and immediately before persisting; a mismatch blocks
save and shows a "Workspace changed" recovery state. A draft can never land in a different
workspace/account than it was generated in.

**Idempotency (audit CRITICAL-2).** The review screen holds a synchronous `savingRef` set before
any `await`, and `saveDraftDeck` has its own module-level `saveInFlight` backstop — a second rapid
Save tap is rejected before it can reach `addDeck`, so one draft save produces at most one deck
and one card set.

**Atomicity / rollback (audit HIGH-1).** `saveDraftDeck` never throws — it returns a typed
`SaveDraftOutcome`. If the deck write succeeds but the card write fails, the just-created deck is
hard-removed (`getDecksAll` → `setDecks` filtered, plus best-effort `deleteCardsForDeck`) — a hard
removal, not a soft-delete tombstone, because the deck was created moments ago and never synced,
so it must leave no tombstone/sync garbage. Outcomes: `card-write-failed` (rolled back cleanly,
draft preserved, safe retry), `rollback-failed` (orphan deck may remain — the UI tells the user to
check their decks first), `deck-write-failed` (nothing persisted), `invalid-draft` (final
validation failed — see below), `in-progress` (reentrant call rejected). The draft is preserved on
every non-success outcome.

**Final validation (audit MEDIUM-3).** `validateDraftForSave` re-checks the whole draft at the
domain boundary immediately before persistence — non-empty title, ≥ 1 card, every card front/back
non-empty and within `MAX_FRONT_LENGTH` / `MAX_BACK_LENGTH`, and unique non-empty card ids — so a
malformed in-memory session can never be persisted even if a caller bypassed the review screen's
own field validation.

The result is indistinguishable from a hand-created deck: same id conventions, same
`rev`/`updatedAt`/`dirty`/`deletedAt` shape, same `WorkspaceScope` partitioning, same
offline-first sync path (decks/cards sync exactly as they always have — Production included, since
the deck itself carries no new fields). After a successful save the draft session is cleared and
the user lands on the new deck's detail screen.

## Route / session consistency (audit HIGH-2)

The review and edit-card screens verify that the route's source id matches the active draft
session's `sourceId` before rendering or saving anything. On a mismatch the review screen shows a
"Draft is for a different source" recovery state (offering to open the draft's real source or
discard it); the edit-card screen falls back to its not-found state. A stale session with no route
match is never rendered or saved.

## Provenance behavior

Every generated card carries `sourceChunkIds`. The review screen resolves those to an honest
citation via `resolveProvenanceLabel` (`src/domain/ai/draftCardEditing.ts`):

- **TXT** chunks always carry `lineRange` → **"From line 14"** for one line, **"From lines 12–20"**
  for one contiguous range.
- **Discontiguous ranges are listed, never collapsed** (audit MEDIUM-1). A card drawn from lines
  10–15 and 40–45 shows **"From lines 10–15, 40–45"** — `mergeLineRanges` only joins ranges that
  actually overlap or are directly adjacent (`next.start <= current.end + 1`); separated ranges
  stay separated. No fabricated continuity.
- A future page-aware adapter would populate `page` → **"From page 14"** / **"From pages 3, 7"**
  with no change to this screen.
- If no cited chunk carries location data, the citation is **omitted** — never a fabricated page
  or line number.

## Source relationship & provenance persistence

**Originally deliberately deferred in this batch; now implemented (`feat/source-coverage`,
merged into `v3.3-dev`) — see `docs/source-coverage.md` for the full design.**

`DeckRecord`/`CardRecord` (`src/models/deck.ts`/`src/models/card.ts`) still have no field for an
originating source or chunk — CLAUDE.md still explicitly forbids adding one, and that has not
changed. What changed is that card-level generation provenance is no longer *only* a review-time
affordance that's lost once the deck is saved: `saveDraftDeck`
(`src/domain/ai/generateDeckSave.ts`) now also writes a **local-only, unsynced** link record per
generated card — `GeneratedCardProvenance` (`src/models/generatedCardProvenance.ts`,
`src/storage/generatedCardProvenance.ts`, key `interval.generatedCardProvenance.v1`) — mapping
`cardId → { deckId, sourceId, sourceChunkIds, generatedAt }`. This is exactly the local-only
link-store shape this section used to sketch as future work, built specifically to power Source
Coverage (`docs/source-coverage.md`) — never read by `src/cloud/sync/**`, and the write is
best-effort (never rolls back an already-successful deck/card save). The review-time citation
affordance described above (`provenanceByChunkId`, in-memory only) is unchanged by this.

## Localization & RTL

All UX chrome is added to **all 13 locales** under the `generateDeck` namespace. Generated card
content (from the mock) is **never** translated. Arabic renders RTL through the existing
`useLayoutDirection` plumbing (`Screen` sets `direction`; headers/rows use `row`/`text`).

**Content direction (audit MEDIUM-2).** A card's own front/back text follows **its own** natural
direction, not the UI locale's — `contentDirectionStyle` (`src/i18n/contentDirection.ts`) does a
dependency-free first-strong-character scan (the Unicode Bidi Algorithm's P2/P3 idea, codepoint
ranges only — no string reversal, no bidi control characters). So an English card stays
left-aligned under Arabic UI, and an Arabic card renders right-aligned under English UI, while all
chrome around it still follows the locale. Neutral-only strings (digits/punctuation) default to
LTR.

## Accessibility

- Options are a real `radiogroup` / `radio` tree (`src/ui/OptionRadioGroup.tsx`); selection is
  conveyed by fill + border + a check glyph + bold label, never color alone; every row clears the
  44 pt touch target.
- Edit / Delete controls have text labels; Delete additionally carries a per-card
  `accessibilityLabel` ("Delete card: …").
- The generating state uses `accessibilityLiveRegion="polite"`.
- Card fields use the shared `TextField` (font scaling never disabled).
- Save's disabled state is paired with visible explanatory text.

## Theme

Uses existing theme tokens only (`useTheme`), so light / dark / warm / system all work with no
new colors.

## Error states handled

Normalization not ready, empty, too large, unsupported, resolution failed, mock provider failure,
generation validation failure, no cards remaining, and save failure — each with a friendly,
localized message. No raw error, stack trace, or internal code is ever shown.

## Limitations

- Mock provider only — card content is placeholder text, not real generated study material.
- No deck→source link persisted (see above).
- TXT, PDF with extractable text, DOCX, and XLSX are all generation-eligible (see
  docs/ai-multiformat-generation.md for the full per-format matrix); image / audio / pptx remain
  unsupported — image and audio were investigated in depth for on-device OCR/transcription but
  blocked for this batch (same doc's "Image / OCR" and "Audio / transcription" sections explain
  why), and pptx was out of scope entirely. Scanned/image-only PDFs and image-only DOCX pages
  correctly show "no usable text" (no OCR).
- **Update (Source Generation Scope batch):** a page range (PDF) / generic section range
  (TXT/DOCX/XLSX) / "Uncovered material" / "Entire source" picker now exists on the options
  screen — see `docs/source-generation-scope.md`. Automatic (this bullet's original "whole
  (budgeted) source is used" behavior) remains the default. A partial-context generation is still
  disclosed BEFORE generation on the options screen, and again with chunk-scope detail on the
  review screen (see "Source coverage disclosure"), regardless of which scope was selected.
- **Update (Whole-Source Multi-Batch Generation batch):** "whole-document generation for a
  source larger than one context budget remains future, founder-gated work" (this bullet's
  original claim) is now implemented for Entire source/Uncovered material/Page range/Section
  range — see `docs/whole-source-generation.md`. Not true RAG/multi-pass retrieval — a selected
  scope larger than one context is split into several sequential, bounded `generateStudyDeck`
  calls and the results combined into one review draft, with a truthful pre-flight step-count
  disclosure and real per-batch progress on the generating screen. Automatic still never does
  this — it remains the unchanged, single-request, no-user-opt-in default described above.
- No regenerate / "generate more cards" action, and no "add card" flow — a fully-emptied draft
  must be discarded and regenerated.
- Draft is in-memory only and does not survive an app restart.
- Content-direction detection (audit MEDIUM-2) is applied to card display on the review screen;
  the edit-card `TextField` still follows the shared component's UI-locale direction while typing.
- No automated tests on this branch (see "Verification").

## Future production provider integration

Unchanged from `ai-generation-foundation.md`'s "Next step to real provider integration":

1. Founder selects a provider.
2. Implement one real `ModelProvider` that calls it server-side and returns the same
   `ModelProviderOutcome` shape — no change to `aiService.ts`, `contextPreparation.ts`,
   `responseValidation.ts`, or this shell's screens.
3. Deploy `backend/lambdas/ai-generate-study-deck/**`'s real counterpart via CDK (its own
   founder-approved AWS change) with a real `GenerationRateLimiter`.
4. Swap `createMockProvider()` for the real adapter in `runGenerateDeckFlow` and widen
   `isGenerateStudyDeckEnabled()` to `production`.
5. Replace the "Development preview" notices with real provenance/AI-assisted disclosure copy.

## Verification

As of `v3.3-dev`, the repository has three focused `node:test` suites (`test:sync`, `test:ai`,
`test:docx`) but no broad app-level / UI harness — CLAUDE.md records that flow verification is
founder runtime QA plus local static checks. The AI-foundation helpers this workflow builds on
are covered by `npm run test:ai` (92 tests, including PDF normalization and AI-generate-study-deck
Lambda helpers under the same glob). There is no `test:generate` suite for the Generate-specific
domain logic yet; it is factored into pure, independently-testable functions to make one
straightforward:
`mergeLineRanges` / `resolveProvenanceLabel` (`draftCardEditing.ts`), `validateDraftForSave` /
`rollbackDeck` (`generateDeckSave.ts`), `detectContentDirection` (`i18n/contentDirection.ts`),
`deriveGenerationAvailability` (`generationAvailability.ts`),
`summarizeGenerationCoverage` / `hasTrustworthyChunkScope` / `deriveCardCountHintKind` /
`deriveFewerCardsExplanation` (`generationCoverage.ts`, 14 tests of its own — see "Source coverage
disclosure").

### Founder QA matrix

1. Attach a `.txt` source, open it, choose **Generate study deck**.
2. Select each combination of card count / difficulty / card style at least once.
3. Generate — confirm the generating state is brief and calm, and the draft review appears.
4. Confirm card count, deck title, and source name are shown; provenance reads "From lines …".
5. Edit a card (front + back), save — confirm the change persists in the list.
6. Try to save a card with an empty field — confirm it's blocked.
7. Delete a card — confirm it disappears; delete all — confirm Save is disabled and the copy reads
   "Keep at least one card to save this deck." (no "add card" wording).
8. Edit the deck title.
9. Save — confirm navigation to the new deck's detail screen.
10. Study the new deck normally; open a card; confirm difficulty / scheduling behave like any
    deck.
11. Force Resync (signed in) — confirm the new deck and its cards sync with normal
    `dirty`/`rev` semantics.
12. Repeat with a **PDF** source that has real extractable text — confirm generation proceeds
    normally (see docs/ai-pdf-generation.md's own QA steps for the full PDF-specific checklist).
13. Repeat with a **DOCX** source — confirm the honest "not ready for generation yet" message.
14. Repeat with an **image** source — confirm the "not supported" message.
15. Test light / dark / warm themes.
16. Test Arabic UI — confirm RTL layout of the options and review screens; confirm English card
    text stays left-aligned. Then, English UI + a source whose text is Arabic — confirm the card
    body renders right-aligned while chrome stays LTR.
17. Start a generation, edit the draft, then press back / Discard — confirm the confirmation
    prompt; confirm an *unedited* draft exits without a prompt.
18. **Rapid Save (audit CRITICAL-2):** tap **Save deck** several times as fast as possible —
    confirm exactly one deck appears in your deck list (no duplicates).
19. **Scope change (audit CRITICAL-1):** generate a draft while signed in, then sign out (or
    switch account) and return to the review screen — confirm Save is blocked with a "Workspace
    changed" message and the draft is not written into the new scope. Sign back in and confirm
    Save works.
20. **Partial-save resilience (audit HIGH-1):** best-effort — if a card write can be made to fail
    (e.g. device storage pressure), confirm no orphan deck is left in the deck list and the draft
    is still on screen to retry.
21. **Wrong-source guard (audit HIGH-2):** with a draft open, deep-link or navigate to a different
    source's generate/review route — confirm the "Draft is for a different source" recovery state,
    not the wrong draft.
22. **Source coverage disclosure — small source (full coverage):** attach a short `.txt`/PDF that
    fits comfortably within one generation. Confirm the options screen shows **no** partial-source
    box — only the existing "Development preview" notice — and the card-count caption reads the
    generic "maximum target" hint (`cardCountHintFull`), not the partial-source wording.
23. **Source coverage disclosure — large source (partial coverage):** attach a very large source
    (e.g. a long PDF/book — this is the exact scenario the founder QA finding came from). On the
    options screen, BEFORE tapping Generate, confirm a prominent disclosure box appears
    (`setupPartialTitle`/`setupPartialBody`), the card-count caption switches to the "You
    requested up to N cards… Interval may create fewer" wording, and — if shown — the "Using X of
    Y sections" line has a sane, non-zero `Y`. Generate, then on the review screen confirm the
    coverage note (and, if the result has fewer cards than requested, the partial-source "Created
    N cards using X of Y sections" explanation) appears — and that nothing anywhere claims or
    implies the whole document was read.
24. **Fewer cards, full source (case A):** find or construct a small source that still yields
    fewer cards than requested (e.g. request "Large" from a source with little real content).
    Confirm the review screen shows the full-source explanation
    (`generateDeck.coverage.fewerCardsFullSource`) — never the partial-source wording, and never
    language implying the model failed.
25. **"Up to N" card-count presets:** on the options screen, confirm every preset hint reads "Up
    to N cards" (not "About N cards"), and that a generated deck can legitimately contain fewer
    cards than the selected preset's target in either the full- or partial-source case above.
