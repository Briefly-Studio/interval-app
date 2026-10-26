# Whole-Source Multi-Batch Generation

Lets a user ask Generate Study Deck to process a selected source scope much larger than one
bounded AI request, by splitting it into several sequential bounded generation batches and
combining the results into one coherent review draft — without ever claiming "entire source" (or
any other scope) was used unless every eligible chunk in that scope was actually sent to the
model across those batches. **Implemented, merged into `v3.3-dev`; not yet founder-QA verified.**

## Why this exists

`docs/source-generation-scope.md` deliberately shipped "Entire source" as available ONLY when the
whole normalized source already fit one bounded context (`DEFAULT_CONTEXT_CHAR_BUDGET` = 24,000
chars), explicitly flagging multi-batch as its own, separate, future work. This batch is that
future work: "Entire source," a large page/section range, or a large uncovered-material set can
now span several sequential bounded requests instead of being gated off or silently truncated.

## Core product principle

> If Interval says a scope was processed, every eligible normalized chunk in that scope was
> actually sent to the model across the batches — never just "the first chunk subset that fit."

This is the thread running through every design decision below. The one deliberate exception,
by product design, not oversight: **Automatic never multi-batches.** It stays the existing fast,
single-request path exactly as it always has — the user never opted into "process everything,"
so it's never silently upgraded into a multi-step operation behind their back.

## Scope selection vs. batch planning vs. model context — three separate concerns

This batch adds a THIRD layer on top of the two `docs/source-generation-scope.md` already
separated:

1. **Scope selection** (`sourceGenerationScope.ts`, unchanged logic, one small exception below) —
   decides WHICH chunks are eligible.
2. **Batch planning** (`batchPlanning.ts`, new) — decides how to GROUP those eligible chunks into
   bounded, sequential units.
3. **Model context** (`contextPreparation.ts`, completely unchanged) — the existing per-request
   character budget, applied identically inside every single batch.

The one change to layer 1: `resolveSourceGenerationScope`'s `"entireSource"` case no longer gates
on fitting one context budget — it now always resolves `{status: "ok", chunkIds: <every chunk
id>}` (explicit, never the bare "no restriction" shape `automatic` uses) whenever there is any
content at all. Whether that candidate set needs one request or several is now entirely layer 2's
job. `uncovered`/`pageRange`/`sectionRange` were already size-unbounded at layer 1 (see that
doc's own description) and are unchanged here.

## Batch planning algorithm (`src/domain/ai/batchPlanning.ts`)

`planGenerationBatches(chunks, options?)` partitions an already-resolved candidate chunk list (in
its own stable source order) into `GenerationBatch[]`, each one's own `approxSize` sum staying
within the budget — the exact same `DEFAULT_CONTEXT_CHAR_BUDGET` `contextPreparation.ts` already
uses, never a second, incompatible size model. A single greedy forward pass:

- Deterministic, no backtracking, no possibility of an infinite loop.
- Every chunk is assigned to EXACTLY one batch — nothing is ever silently dropped from the plan.
- No batch is ever empty; source order is preserved both within and across batches.
- A single chunk whose own `approxSize` alone exceeds the budget still gets its own one-chunk
  batch, rather than being silently excluded the way a single bounded `prepareGenerationContext`
  call would exclude it today. See "Known limitations" for what happens when that batch is
  actually sent to the provider.

**`MAX_BATCHES_PER_GENERATION = 8`** — a Development safety cap, not a formula. Chosen
deliberately so that:

- Even in the worst case (exactly 8 batches), the smallest named tier (Small, ceiling 8) can still
  give every batch a real card opportunity without needing to raise its effective ceiling above
  its own nominal one (see "Card allocation" below) — 8 batches × 1 card ≤ 8.
- One multi-batch generation can consume at most 8 of a user's 20/day backend-enforced requests —
  a meaningful fraction, deliberately bounded, never unbounded. See "Quota implications" below.

A plan needing more than 8 batches is refused — `{status: "error", code: "plan-too-large"}` —
before any provider call, never processed as an unbounded marathon. Copy:
*"This source is too large to generate in one deck right now. Try a smaller range."*

`canPlanBatchesFor(chunks)` is the pure eligibility check `buildSourceScopeChoices` uses to decide
whether to offer "Entire source" at all for an oversized source — it's the same
`planGenerationBatches` call, not a separate approximation.

## Card allocation (`src/domain/ai/batchCardAllocation.ts`)

The selected tier (Small/Medium/Large, or a numeric override) is the **FINAL DECK TOTAL** — it
never multiplies by batch count. `allocateCardsAcrossBatches({batchCount, requestedCardCount})`
splits the tier's own ceiling across batches using even positional distribution
(`distributeEvenly`, the standard cumulative-rounding method: entry i =
`floor(total*(i+1)/count) - floor(total*i/count)`), deliberately NOT weighted by chunk/character
count — raw char count doesn't reliably predict how many genuinely distinct, study-worthy facts a
chunk holds, so fabricating that precision would be false confidence, not real signal. This
spreads any remainder across the sequence instead of clustering it at either end, and —
critically — guarantees every batch gets **at least one real card opportunity** whenever the
total being distributed is `>= batchCount`.

Example (the mission's own worked case): Medium (ceiling 15), 4 batches → `[3, 4, 4, 4]`.

**Every batch's own per-request `cardCount` is a plain numeric override**, not a reused Small/
Medium/Large preset — this is deliberate: the existing numeric-override semantics
(`resolveTargetMinimumCardCount`, `generationOptions.ts`) already set that batch's own quality
floor equal to its own ceiling ("try to reach exactly N, quality permitting"), which is the
honest instruction for a batch that might only be allocated 2-4 cards. Reusing Medium's own
target-minimum-10 for a 3-card batch would be nonsensical and was explicitly what this design
avoids — no new request-contract type was needed; the existing numeric path already IS the
"clean internal batch request contract."

**When `batchCount > requestedCardCount`** (only reachable via a raw numeric `cardCount` override
below 8 — never through the shipped Small/Medium/Large UI, since even Small's ceiling of 8 equals
`MAX_BATCHES_PER_GENERATION`), the effective total distributed rises to `batchCount` so no batch
is skipped — bounded by the same hard structural cap, never unbounded. **The aggregate
"insufficient-distinct-content" judgment always compares against the ORIGINAL, unmodified
`targetMinimumCardCount`** — this internal bump never changes what counts as "enough" from the
user's point of view.

## Per-batch AI contract

Unchanged. Every batch is an ordinary `generateStudyDeck` call — same provider, same
source-grounding/`sourceChunkIds` requirement, same count-quality rules
(`docs/ai-generation-foundation.md`'s "Count contract"), same no-filler/no-unsupported-facts
prompt discipline, same per-batch `exceeds-requested-max`/duplicate-card validation. No separate
prompt architecture was forked for this.

## Orchestration (`src/domain/ai/multiBatchGeneration.ts`)

`runMultiBatchGeneration` runs one `generateStudyDeck` call per planned batch, **strictly
sequentially, never in parallel** — this isn't a stylistic choice: the backend's rate limiter
holds a single, fixed-key concurrency lease per user (`maxConcurrent=1`,
`docs/ai-generation-foundation.md`'s "Rate limits" section) — a second in-flight request for the
same user is rejected as `generation-in-progress`, so parallel batches would just fail. Sequential
execution also means predictable cost, simpler cancellation, and deterministic combined ordering.

### Combining results

After every batch succeeds, cards are concatenated (preserving each batch's own order), passed
through cross-batch dedupe (below), then re-stamped with a fresh, globally-unique
content-addressed id (`computeCardDraftId`, `responseValidation.ts`) — batch-local ids aren't
guaranteed unique once combined into one deck. The result is one ordinary `GeneratedDeckDraft` —
the EXACT shape a single-call generation already produces. `startGenerateDeckSession`,
`generateDeckSave.ts`, and `review.tsx` needed **zero changes** to consume it; they only ever
cared about a flat `cards: DraftCard[]` and a handful of scalar metadata fields, never how many
calls produced them.

The aggregate scalars:

- `fullSourceIncluded`/`excludedChunkCount` — relative to the TRUE full normalized source, unioned
  across every batch's own chunk ids. Identical meaning to a single-call draft's own field
  (`aiService.ts`'s `reconcileFullSourceReporting`); a page-range selection that only ever asked
  for part of the source still correctly reports `false` here, exactly as before — this field has
  never claimed "the user's selected scope was covered," only "the source was."
- `resultingCardCount`/`generationStatus` — the AGGREGATE total and its derived status
  (`deriveGenerationStatus`, unchanged), computed ONCE over the combined total vs. the ORIGINAL
  target minimum — **never a copy of any individual batch's own status**. A batch that
  self-reported "complete" while the combined total still falls short is never trusted; see
  `docs/ai-generation-foundation.md`'s "Count contract" for why the model's self-report has always
  been advisory-only, which this generalizes unchanged.

### Duplicate handling (`src/domain/ai/multiBatchDedupe.ts`)

Cross-batch duplicate control reuses the EXACT within-batch definition
(`normalizeForDuplicateCheck`, exported from `responseValidation.ts` for this reuse: trimmed,
lowercased, whitespace-collapsed, exact string equality on `front+back`) — a card that wouldn't
survive within one batch doesn't survive across batches either, and vice versa. Deliberately
**no fuzzy/similarity/semantic/embedding-based matching** — two cards merely similar in wording
are left alone for the user to judge; only byte-for-byte-after-normalization duplicates are ever
merged. When two batches independently produce the "same" card from different chunks, the
retained card's `sourceChunkIds` is the UNION of both — provenance is never silently lost to make
room for a shorter card list.

### Failure policy

**The simplest trustworthy option, as instructed:** if ANY batch fails (provider error,
validation failure, quota/concurrency rejection), the WHOLE orchestration fails — no partial
drafts are ever combined or presented as success, and `startGenerateDeckSession` is never called
(the existing "only populate the session on `status: ready`" invariant in `generateDeckFlow.ts`
already does this for free — no new guard was needed). The surfaced error is the FIRST failing
batch's own, ordinary `GenerationErrorCode` — reusing 100% of the existing error-copy pipeline; the
user is never shown "batch" terminology (e.g. a mid-sequence `daily-limit-reached` shows the exact
same copy a single-call hit of that limit would). **Retry means starting over from batch 1** — see
"Known limitations" for why safe resume isn't implemented yet.

### Cancellation

Checked via an `isCanceled()` callback **BETWEEN batches only, never mid-batch** — an
already-dispatched request to the backend cannot be interrupted from the client (no
`AbortSignal` is wired through `src/cloud/ai/http.ts`'s `fetch` call; this was a deliberate scope
decision, not an oversight — see "Known limitations"). Scheduling simply stops; nothing already
completed is combined, saved, or presented as a partial success. The options screen's "Generate"
state renders a Cancel button during any multi-batch run (never during a single-call generation,
which finishes too fast for it to matter) that sets a ref the orchestrator reads before starting
the next batch. **A request already in flight when Cancel is tapped may still complete
server-side and consume its quota unit** — this is disclosed in code comments, not hidden, exactly
as instructed; it is not shown as a dedicated user-facing warning in this first implementation
(the Cancel action itself already implies "stop as soon as possible," and the quota consequence is
a backend-invisible detail most users have no action to take about anyway).

## Progress UX

Real, truthful batch progress (`MultiBatchProgress`: `"preparing" | "batch" | "combining"`) —
never a fabricated percentage. "Generating cards — step N of M" is real, completed-batch-counted
progress; nothing here estimates latency or extrapolates a percentage from elapsed time. The
single-call path (Automatic, or any scope that resolves to one batch) never shows this — its
existing generic loading copy is unchanged.

## Pre-flight disclosure (options screen)

When the user's current selection would need more than one batch, a plain-language notice
appears before Generate is ever tapped: *"This will take {{count}} AI generation steps."* —
deliberately avoiding "Bedrock calls"/"requests" jargon. This is a LIVE dry-run of the exact same
`resolveSourceGenerationScope` + `planGenerationBatches` pair the real request will use (shared
with the Generate button's own disabled-state check), so the disclosure and the actual behavior
can never disagree. This REPLACES the prior "only part of it will be included" warning that scope
used to show for an oversized restrictive selection — that warning is now false (multi-batch
processes the WHOLE selection, just across several steps), so it was retired rather than left to
coexist confusingly with the new, accurate disclosure.

## Quota implications

**Each batch is a separate backend Lambda invocation and consumes one unit of the user's 20/day
quota** — confirmed from the backend rate limiter's own design
(`docs/ai-generation-foundation.md`'s "Rate limits and cost controls"): there is no
multi-request/batch concept in the quota or concurrency-lease scheme at all. This is never hidden:
the pre-flight disclosure above states the real step count before anything starts, and
`MAX_BATCHES_PER_GENERATION = 8` was deliberately chosen to bound any single generation to at most
40% of a user's daily allowance. **No backend/quota configuration was changed** — the existing
20/day limit and single-concurrency lease are enforced exactly as before; this batch only ensures
the client-side planning step never exceeds what the product considers a safe single-generation
footprint, and fails honestly (never silently retries or bypasses) if the server's quota still
runs out mid-sequence regardless.

## Provenance / coverage interaction

Unchanged, by design — `src/domain/sourceCoverage.ts`/`sourceCoverageService.ts` and
`src/storage/generatedCardProvenance.ts` were not touched. Every combined card still carries its
own real `sourceChunkIds` from whichever batch produced it;
`generateDeckSave.ts`'s existing per-card provenance write (unchanged) is all that's needed for
Source Coverage to see the right chunks once the user saves. **Processing every chunk of a scope
through multi-batch does NOT mark those chunks covered** — only chunks a SAVED card actually
cites become covered, exactly as before. A whole-source multi-batch generation can still result in
less than 100% coverage, because not every chunk necessarily produces a card the user keeps — this
is correct, not a defect. Running "Uncovered material" again after saving resolves against
whatever is STILL truly uncovered, using the same unmodified Source Coverage APIs.

## Safety limits (centralized, not scattered)

| Limit | Value | Enforced by |
| --- | --- | --- |
| Max batches per generation | 8 (`MAX_BATCHES_PER_GENERATION`) | `batchPlanning.ts`, before any provider call |
| Per-batch context budget | 24,000 chars (`DEFAULT_CONTEXT_CHAR_BUDGET`, unchanged) | `contextPreparation.ts`, inside every batch |
| Global per-deck card ceiling | 40 (`ABSOLUTE_MAX_CARDS_PER_DECK`, unchanged) | `responseValidation.ts`, per batch |

No internal token/character limit is ever surfaced to the user — the only user-facing copy is the
plain "too large, try a smaller range" message and the honest step-count disclosure.

## What "entire source" means now

"Generated from the entire selected source" is valid to say once every batch in the plan has
succeeded — because, by the planner's own invariant, every eligible chunk was actually assigned
to a batch and that batch was actually sent to the model. It does **not** mean every chunk
produced a card (see "Provenance / coverage interaction"), and it does not mean the model
"remembered" earlier batches while processing later ones — each batch is an independent, bounded
request exactly like today's single-call generation, just with the whole source's material spread
across several of them instead of one.

## Known limitations

- **No safe resume/idempotency.** A failure mid-sequence means a full restart from batch 1 on
  retry — already-succeeded batches' quota units are not refunded or reused. This mirrors the
  pre-existing, already-documented single-call "no request-level idempotency key" gap
  (`docs/ai-generation-foundation.md`), just compounded across however many batches already ran.
  A future batch could add a resumable plan with per-batch completion tracking; not attempted here.
- **Cancellation cannot interrupt an in-flight batch.** No `AbortSignal` is wired through the HTTP
  layer; Cancel only ever stops the NEXT batch from starting. A request in flight when canceled
  may still complete and consume quota server-side.
- **A single chunk whose own size exceeds the context budget** still gets planned into its own
  batch (never dropped from the plan) but will then fail that one batch's own `generateStudyDeck`
  call with `source-empty` (since a lone oversized chunk is excluded by the UNCHANGED, existing
  `prepareGenerationContext` logic) — failing the whole orchestration per the fail-closed policy
  above. Not reachable through any current adapter's actual chunk-size behavior (typical chunks
  are well under the 24,000-char budget); a theoretical edge case, documented rather than
  specially handled.
- **No change to backend quota, concurrency scheme, or any AWS resource.** The 8-batch cap is a
  purely client-side planning safety limit, not a server-enforced one — the server's existing
  20/day + single-concurrency enforcement is the real backstop either way.

## Future resume/idempotency opportunities

A later batch could add a request-level idempotency key (closing the gap noted above for both
single- and multi-batch generation at once) and/or a persisted, resumable plan — "batches 1-3
already succeeded; retry from batch 4" — without changing this batch's planner/allocator/dedupe
logic, only the orchestrator's own failure-handling branch.

## Founder QA

See the delivery report for this batch's proposed device QA checklist.

## What this batch deliberately does not change

`src/domain/sourceCoverage.ts`/`sourceCoverageService.ts` (Source Coverage math — a different
branch's territory), `src/storage/generatedCardProvenance.ts`, `contextPreparation.ts`'s budget or
algorithm, the count-quality contract (`responseValidation.ts`'s validation rules,
`generationOptions.ts`'s presets), any normalization adapter, the backend Lambda's quota/
concurrency scheme or any AWS/CDK resource, the AI model/provider, Staging/Production AI
enablement. No new npm dependency.
