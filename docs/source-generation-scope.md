# Source Generation Scope

Lets the user choose WHAT PART of a Library source Generate Study Deck should draw from, before
generation starts, instead of the app always picking an opaque bounded subset with no control.
**Implemented, merged into `v3.3-dev`; not yet founder-QA verified.**

## Why this exists

Before this batch, Generate Study Deck always used `prepareGenerationContext`'s own greedy,
start-of-source selection with no way for the user to influence it. For a large source, this
meant a user who cared about a specific chapter, a specific page range, or just "the parts I
haven't made cards from yet" had no way to ask for that — they got whatever fit starting from the
beginning, every time. See `docs/ai-generation-foundation.md`'s "What is intentionally NOT
implemented" (as of the Count contract batch) for where this was already flagged as pre-planned
future work.

## Scope model

A format-neutral domain type, `SourceGenerationScope` (`src/domain/ai/sourceGenerationScope.ts`):

```ts
export type SourceGenerationScope =
  | { type: "automatic" }
  | { type: "entireSource" }
  | { type: "uncovered" }
  | { type: "pageRange"; startPage: number; endPage: number }
  | { type: "sectionRange"; startSection: number; endSection: number };
```

A single pure resolution function, `resolveSourceGenerationScope({ chunks, scope, coverage?,
pageCount? })`, turns one of these into either `{ status: "ok", chunkIds?: string[] }` (`chunkIds`
omitted means "no restriction — every chunk remains eligible") or `{ status: "error", code }`.
Deterministic, preserves the chunks' own existing document order, dedupes trivially (it only ever
filters an already-deduplicated chunk list), and never falls back from one scope to another — a
scope that can't be satisfied is always a typed, explicit error, never a silent substitution.

**Scope selection and the existing bounded `GenerationContext` (`contextPreparation.ts`) are two
different things, deliberately kept separate:**

- Scope selection decides the CANDIDATE chunk set — which chunks are even eligible for this
  generation.
- `GenerationContext` (completely unchanged by this feature) then still applies the existing safe
  per-request character budget (`DEFAULT_CONTEXT_CHAR_BUDGET` = 24,000 chars) on top of that
  candidate set, exactly as before.

A scope whose candidates exceed one context budget is not an error by itself — it legitimately
resolves to a partial-context generation. This is truthfully disclosed by the SAME
`fullSourceIncluded`/`excludedChunkCount` machinery that already existed before this batch
(`aiService.ts`'s `reconcileFullSourceReporting`, which always recomputes against the TRUE full
chunk count of the source, never just the pre-filtered candidate set) — zero new plumbing was
needed on that side. See "Interaction with bounded context" below.

## Automatic

`{ type: "automatic" }` always resolves to "no restriction" — `generateStudyDeck` behaves exactly
as it did before this batch existed. This is the default for every new generation session, so
existing users see no behavior change unless they actively pick something else.

## Uncovered material

`{ type: "uncovered" }` resolves to exactly the current source's `SourceCoverage.uncoveredChunkIds`
(`src/domain/sourceCoverage.ts`, unchanged — this batch reuses that domain API rather than
duplicating coverage math, per the mission's own explicit instruction). Strict semantics, kept
deliberately simple for this first implementation:

- Only actual uncovered chunk ids are ever included — a chunk already covered by a live card is
  never pulled in, even to pad out a small selection.
- A coverage id that no longer exists in the CURRENT chunk list (stale provenance — e.g. the
  source was re-normalized under a new `NORMALIZATION_VERSION`) is silently ignored, never
  trusted blindly — the resolver filters FROM the current chunk list, not from the coverage list.
- Zero uncovered chunks is an explicit `uncovered-unavailable` error. The options screen never
  even offers this choice when there is nothing uncovered (`buildSourceScopeChoices`), so this
  error path is a defensive backstop, not the normal user path.
- "Uncovered" is never a mastery or learning claim — it only means no saved card's provenance
  currently cites that chunk. Existing `docs/source-coverage.md` language about this is unchanged.

When generated cards from this scope are saved, the existing `GeneratedCardProvenance` write
(`generateDeckSave.ts`, unchanged) naturally makes those chunks covered on the next coverage
check — no new coverage counter or write path was added.

## Entire source

`{ type: "entireSource" }` is only ever offered/resolved when the ENTIRE normalized source already
fits inside one generation's context budget — checked via `fitsContextBudget`, which sums every
chunk's `approxSize` and compares it against `DEFAULT_CONTEXT_CHAR_BUDGET`. This is provably
equivalent to running `prepareGenerationContext` and checking `fullSourceIncluded`, without
needing to call it or fabricate a `NormalizedSourceContent` wrapper (see the function's own doc
comment for the short proof: its selection loop is a single forward pass with a monotonically
non-decreasing running total and no backtracking).

When it fits, "Entire source" resolves identically to "Automatic" (no restriction) — the two
differ only in this upfront truthfulness guarantee, never in the resulting candidate set.

**Update (Whole-Source Multi-Batch Generation batch):** "this batch never implements multi-batch
whole-source generation" (this section's original claim) is no longer true — multi-batch
generation is now implemented, see `docs/whole-source-generation.md`. `resolveSourceGenerationScope`'s
`"entireSource"` case no longer gates on `fitsContextBudget` at all; it always resolves an
explicit chunk-id list whenever there is any content, and a NEW batch-planning layer
(`batchPlanning.ts`) decides whether that candidate set needs one request or several, up to a
hard `MAX_BATCHES_PER_GENERATION` safety cap. The options screen now offers "Entire source"
whenever the source can be PLANNED at all (one request or several sequential batches), not only
when it fits one request — see that doc's "Scope selection vs. batch planning vs. model context"
section for the full three-layer design this introduced.

## Page range (PDF only)

`{ type: "pageRange"; startPage; endPage }` is offered only for a PDF whose normalization reports
a trustworthy, multi-page `metadata.pageCount` (`NormalizedSourceContent.metadata.pageCount`,
populated by `pdfAdapter.ts` from the real native page count — never invented). This is reliable
because of a guarantee already built into the PDF adapter before this batch: **a chunk never spans
a page boundary** — each page is independently segmented, so every chunk's `provenance.page` is a
single, real page number. A page-range filter (`chunk.provenance.page >= start && <= end`) is
therefore always exactly correct, with no ambiguity about chunks straddling the boundary.

- `startPage <= endPage`, both within `[1, pageCount]` — anything else is `invalid-range`.
- A valid range that happens to match zero chunks (e.g. the selected pages were entirely blank,
  which `pdfAdapter.ts` already skips without renumbering later pages) is `empty-selection`, not
  silently treated as "nothing changed."
- Original page provenance is preserved unchanged on every resulting card exactly as before —
  this feature only restricts WHICH chunks are eligible, never how they're represented.

If the PDF extraction layer could not reliably expose a total page count, this scope would not be
offered at all for that source (falls back to no range scope, same as any other non-PDF format) —
there is no fuzzy "best guess" page range.

## Generic section range (TXT / DOCX / XLSX)

`{ type: "sectionRange"; startSection; endSection }` is the ordinal fallback for formats without
trustworthy page/chapter structure. "Section" = one normalized chunk, 1-based — deliberately the
SAME vocabulary the existing coverage disclosure already uses ("Using 19 of 193 source sections",
`generateDeck.coverage.scopeSummary`), never a raw, developer-looking chunk id. Offered only when
a source has more than one section (a single-section source has nothing to range over).

Validation mirrors page range exactly: `startSection <= endSection`, both within
`[1, totalSectionCount]`, with the same `invalid-range`/`empty-selection` error codes.

## Semantic structure foundation; selection UI deferred

`docs/source-structure.md` documents the new derived structure API. DOCX normalization now
preserves real Heading1–Heading3 levels; heading nodes represent deterministic parent/child
chunk intervals, including repeated titles. XLSX now retains actual worksheet names, tab order,
visibility and empty sheets as structured metadata rather than requiring text parsing.

`extractSourceStructure(normalizedContent)` and `resolveStructureNodeChunks(content, structure,
nodeId)` provide the seam for a future semantic scope picker. The resolver rejects stale/empty
nodes and discloses known worksheet chunk overlap. Existing XLSX chunks can span sheets: a
future picker must handle warnings/coarse boundaries before claiming exclusive worksheet scope.

No `structureNode` scope variant or new picker was added. Automatic, Entire source, Uncovered,
PDF page ranges and generic section ranges remain unchanged. TXT has no semantic structure;
the installed PDF extractor exposes no outline API, so PDF retains only its real page selection.
No headings/chapters are inferred from typography, capitalization or text patterns.

## Interaction with bounded context

A selected scope's candidates can exceed one generation's context budget — e.g. "Pages 20–100" on
a dense PDF. **Update (Whole-Source Multi-Batch Generation batch):** this is no longer handled by
silently permitting a partial-context single call with a warning (`generateDeck.scope.
partialContextNote`, which this section originally described — that key has since been removed
from all 13 locales, not left dead). It is now handled by actually processing the WHOLE candidate
set across several sequential, bounded batches — see `docs/whole-source-generation.md` for the
full design (batch planning, card allocation, sequential orchestration, the pre-flight step-count
disclosure that replaced the old warning, and the one remaining scalar truthfulness point below).

The one thing that did NOT need to change: `selectedChunkIds` (now, for a multi-batch run, the
UNION of every batch's own chunks) still flows into the existing, unchanged `generateStudyDeck` →
`prepareGenerationContext` → `reconcileFullSourceReporting` pipeline for each individual batch,
and the combined draft's own `fullSourceIncluded`/`excludedChunkCount` are aggregated the same
way — against the TRUE full source chunk count — so the pre-existing "Using X of Y sections"
disclosure on the review screen is automatically correct regardless of which scope, or how many
batches, produced the request.

**Scope selection and the model's context limit are never the same decision** — this is stated
explicitly here and in code comments precisely because it would be easy to conflate "the user
picked a range" with "the user's range is guaranteed to fully reach the model," which is not true
and must never be implied by any copy this feature shows.

## Interaction with count-quality

Completely unaffected. The selected scope only controls candidate source material; Small/Medium/
Large's target-minimum/ceiling semantics and the `generationStatus`/"insufficient-distinct-content"
contract (`docs/ai-generation-foundation.md`'s "Count contract" section) are unchanged. A sparse,
narrow page range combined with "Medium" may legitimately produce fewer cards and report
`insufficient-distinct-content` — exactly the same honest outcome as a sparse full-source
generation would, nothing scope-specific was added to that logic.

## UX

A compact "Generate from" `OptionRadioGroup` control on the existing Generate Study Deck setup
screen (`app/library/[id]/generate/index.tsx`), with inline `TextField` "From"/"To" inputs shown
only for Page range / Section range. Which choices are even offered is computed per-source by
`buildSourceScopeChoices` (`src/domain/ai/sourceGenerationScopeUi.ts`) — Automatic is always
present; Uncovered/Entire source/Page range/Section range each appear only when truthfully
available for this specific source. A pre-generation summary line always states, in plain
language, what will happen ("Using the full source.", "Pages 20–40.", …) before the user taps
Generate. The Generate button is disabled whenever the current selection doesn't resolve
successfully (invalid range, etc.) — the same resolver call used for this live validation is the
one `runGenerateDeckFlow` calls again, fresh, at actual generation time.

## Persistence

The selected scope is never persisted — every fresh generation session (screen mount) defaults to
Automatic, same posture as `cardCount`/`difficulty`/`cardStyle` on the same screen. No new backend
setting, no new AsyncStorage key.

## Error states

| Code | Meaning |
| --- | --- |
| `entire-source-too-large` | "Entire source" selected but it would not fit one generation's context budget. |
| `uncovered-unavailable` | "Uncovered material" selected but zero uncovered chunks exist. |
| `page-range-unavailable` | A page range was selected but no trustworthy page count exists for this source. |
| `invalid-range` | The requested range is reversed, out of bounds, zero/negative, or non-integer. |
| `empty-selection` | A structurally valid range/scope resolves to zero actual chunks. |

Every one of these is reachable live on the options screen (disables Generate, shows the matching
copy) before it would ever reach `runGenerateDeckFlow`'s own defensive re-check (a new
`"scope-error"` `GenerateDeckFlowOutcome` variant, distinct from `GenerationErrorCode` — resolved
before any provider is ever called, so it is never confused with a provider/validation failure).

## Future work

- **Multi-batch whole-source generation** — ~~processing a source larger than one context budget
  across several linked requests. Explicitly not implemented~~ **now implemented** — see
  `docs/whole-source-generation.md` for the full design (batch planning, card allocation,
  sequential orchestration, cross-batch dedupe, failure/cancellation policy, quota implications).
- **Chapter/heading-based selection** — the derived heading-node foundation now exists (see
  `docs/source-structure.md`), with scope/UI integration still deferred.
- **XLSX worksheet selection** — actual worksheet metadata/node APIs now exist; shared boundary
  chunks need explicit handling before a picker can promise exclusive selection.
- Any future selection UI (chapter picker, worksheet picker, etc.) plugs into the exact same seam
  this batch introduced — `SourceGenerationScope` gains a new variant,
  `resolveSourceGenerationScope` gains a new case, and `generateStudyDeck`'s existing
  `selectedChunkIds` plumbing (unchanged by this batch, already existed before it) needs no
  further changes.

## Founder QA

Not yet performed. See the delivery report for this batch's proposed checklist.

## What this batch deliberately does not change

No backend/AWS/CDK/EAS/Staging/Production change. No change to `contextPreparation.ts`'s budget
or algorithm. No change to Source Coverage's own calculations (`sourceCoverage.ts`,
`sourceCoverageService.ts` — reused as-is). No change to the count-quality contract
(`responseValidation.ts`, `generationOptions.ts`). No change to any normalization adapter's
provenance shape. No new npm dependency.
