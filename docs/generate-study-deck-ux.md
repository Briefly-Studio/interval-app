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
| `ready` | **TXT** (`text-v1` adapter) | Generation allowed — the gold-standard path |
| `empty` | TXT with no extractable text | "No usable text" — honest, no generation |
| `too-large` | TXT over the 10 MB normalization ceiling | "Source is too large" |
| `pending-extraction` | **PDF**, **DOCX** | "Not ready for generation yet" — honest not-ready state; extraction isn't integrated on this branch |
| `unsupported` | image, audio, pptx, xlsx | "Not supported" |
| `failed` | any text source that couldn't be resolved/read | Friendly failure state with Retry |

Internal `ExtractionStatus` / `GenerationErrorCode` values are never shown to the user — every
state has a localized title/body pair.

## Mock-provider status

`createMockProvider()` (`mock-v1`) is deterministic, requires no credential, makes no network
call, and prefixes every card front and the deck title with `[MOCK]` so nothing downstream can be
mistaken for real AI output. The options screen and the review screen both show a persistent
**"Development preview"** notice stating that cards come from a local mock, not a production AI
model. The generating state is a short, calm in-place transition — there is **no artificial
multi-second delay** (mock generation is local and near-instant).

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
- `options`, `providerId`, `requestedCardCount`, `fullSourceIncluded`
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

## Source relationship & provenance persistence (deliberately deferred)

**This batch does not persist any deck→source or card→chunk link.**

`DeckRecord` (`src/models/deck.ts`) has no field for an originating source, and CLAUDE.md
explicitly forbids adding one — decks are on the live Production sync path, so any new field
reaches Production on the next sync of any signed-in user. Forcing a provenance link into that
model is real product-architecture work, not part of a UX shell.

Card-level generation provenance therefore stays a **review-time affordance only** and is lost
once the deck is saved.

A future implementation would most naturally add a **local-only, unsynced** link store —
`interval.generatedDeckSources.v1`, `scopedKey`-partitioned like decks/cards, mapping
`deckId → { sourceId, generatedAt, providerId, normalizationVersion, generationContractVersion }`
— analogous to `src/storage/librarySourceLocalFiles.ts`. Card-level chunk provenance would need
either a `CardRecord` schema decision or a parallel local store keyed by card id. Both are
explicit, separate, founder-approved work.

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
- PDF / DOCX show an honest not-ready state; image / audio / pptx / xlsx are unsupported.
- No page-range or chunk selection UI — the whole (budgeted) source is used; a partial-context
  generation is disclosed with a note on the review screen.
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

As of `v3.2-dev`, the repository has three focused `node:test` suites (`test:sync`, `test:ai`,
`test:docx`) but no broad app-level / UI harness — CLAUDE.md records that flow verification is
founder runtime QA plus local static checks. The AI-foundation helpers this workflow builds on
are covered by `npm run test:ai` (20 tests). There is no `test:generate` suite for the
Generate-specific domain logic yet; it is factored into pure, independently-testable functions to
make one straightforward:
`mergeLineRanges` / `resolveProvenanceLabel` (`draftCardEditing.ts`), `validateDraftForSave` /
`rollbackDeck` (`generateDeckSave.ts`), `detectContentDirection` (`i18n/contentDirection.ts`),
`deriveGenerationAvailability` (`generationAvailability.ts`).

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
12. Repeat with a **PDF** source — confirm the honest "not ready for generation yet" message.
13. Repeat with an **image** source — confirm the "not supported" message.
14. Test light / dark / warm themes.
15. Test Arabic UI — confirm RTL layout of the options and review screens; confirm English card
    text stays left-aligned. Then, English UI + a source whose text is Arabic — confirm the card
    body renders right-aligned while chrome stays LTR.
16. Start a generation, edit the draft, then press back / Discard — confirm the confirmation
    prompt; confirm an *unedited* draft exits without a prompt.
17. **Rapid Save (audit CRITICAL-2):** tap **Save deck** several times as fast as possible —
    confirm exactly one deck appears in your deck list (no duplicates).
18. **Scope change (audit CRITICAL-1):** generate a draft while signed in, then sign out (or
    switch account) and return to the review screen — confirm Save is blocked with a "Workspace
    changed" message and the draft is not written into the new scope. Sign back in and confirm
    Save works.
19. **Partial-save resilience (audit HIGH-1):** best-effort — if a card write can be made to fail
    (e.g. device storage pressure), confirm no orphan deck is left in the deck list and the draft
    is still on screen to retry.
20. **Wrong-source guard (audit HIGH-2):** with a draft open, deep-link or navigate to a different
    source's generate/review route — confirm the "Draft is for a different source" recovery state,
    not the wrong draft.
