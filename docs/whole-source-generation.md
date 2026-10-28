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

Every successful step's submitted chunk IDs are checked against its planned IDs. If context
preparation excluded material, orchestration fails rather than claiming that the whole plan was
processed. Invalid/duplicate/unknown/empty plans fail before provider calls. This is orchestration
validation; the greedy planner and card allocator are unchanged.

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

Any failed step aborts the run: no partial draft, automatic save or whole-selection success.
The flow preserves completed/total-step context for recovery copy, including first/middle/final
failures. Provider exceptions are reduced to safe error categories. A daily-limit failure says
the full selection was not processed and no deck was saved, with guidance to wait for reset.
Other failures retain the existing reason plus the same incomplete/no-save disclosure.

Retry is explicit and restarts at step 1; real-AI copy says daily requests may be used again.
There is no automatic retry, refund, resume or persisted partial deck. Request-level replay is
now implemented behind backend migration modes; see `docs/ai-request-idempotency.md`.
Cancellation wins over simultaneous provider/network errors, so intentional cancellation is
not presented as a failure. Starting an attempt clears any previous in-memory draft; only an
uncanceled successful run publishes a new session.

### Cancellation and lifecycle

A one-tap Cancel is shown only for multi-step generation. It immediately invalidates the run
and shows “Stopping after the current step…”. Checks before dispatch, after every request, and
during combination/review preparation prevent subsequent calls and discard even the final
request's result if cancellation won. Repeated taps are harmless. Once the in-flight request
settles the screen shows a canceled/no-save state; dismissing consent or confirmation returns
to setup without a generation request.

An in-flight request cannot be aborted and may still consume one daily request. This is
disclosed on canceled real-AI runs. The UI run lease remains held until that request settles,
preventing a new attempt from overlapping it. A user can navigate back while waiting; returning
does not restart work. The lease also covers asynchronous consent and confirmation, blocking
rapid Generate taps and concurrent route instances before any dialog or provider call.

Header back, Android hardware back, route blur/unmount, and workspace changes invalidate the
run. Multi-step work is also canceled when AppState enters background (not merely inactive,
which can happen around native dialogs). There is no background execution or automatic resume.
Foregrounding does not reset cancellation. A killed app loses its in-memory run/draft; a server
request already dispatched may finish. Actual HTTP completion timing and native lifecycle
behavior still require device QA; no client transport timeout was added.

## Progress UX and accessibility

The real phases are preparing → generating step N of M → combining → preparing review, with
canceling, canceled and failed presentation states. No estimated percentage or time is shown.
Ordinary one-step generation retains generic loading with no multi-step summary/Cancel.

Status text uses Android's polite live region and one iOS accessibility announcement per changed
status, deduplicated across rerenders. Native alerts supply logical confirmation actions/focus.
Plan and progress text follow existing RTL helpers; numeric step order is not manually reversed.
Stacked summary rows and scrollable progress allow large type without color-only information.
VoiceOver/TalkBack, native dialogs and largest text sizes remain pending device QA.

## Pre-generation summary and confirmation

Multi-step setup shows chosen scope, normalized section count, real pages-with-text count when
every selected chunk supplies a page number, number of steps, and the final Small/Medium/Large
card ceiling. Page counts are extracted-text pages, not inferred chapters or invented page
coverage. “Entire source selected” describes a plan, not completed work. Per-step card allocation
is never shown; Medium still means up to 15 cards TOTAL, not per step.

The setup dry-run is checked again after fresh normalization/scope resolution. The exact plan
is passed through an approval callback before the first provider call. First-use consent comes
first, then an explicit native confirmation for **3 or more steps**, then generation. One/two
steps do not confirm. Three is a deliberate threshold for a noticeable multi-request operation
without adding friction to small runs. Rejecting either dialog consumes no AI request.

The old partial-source warning is now restricted to Automatic. Explicit entire/range/uncovered
plans do not display that contradictory warning. Plan-too-large copy suggests a smaller page or
section range, with distinct wording for too much uncovered material; it does not expose the
internal eight-step cap.

## Quota implications

Real-AI plans show “Planned daily AI requests: up to N.” Every admitted generation step consumes
one quota unit under the existing server limiter, including provider failures after admission;
a rejection before admission consumes none. Early failure/cancel can stop before all N requests.
No remaining allowance is inferred, tracked, or reserved by the client. Mock runs show steps but
no quota-consumption claim. There is no pricing copy or provider/backend jargon in the UI.

The existing 20/day policy and concurrency lease are unchanged. Calls remain sequential. A
second UI run is blocked locally; backend concurrency still protects other devices/callers.

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

- **No batch resume.** User Retry still restarts from batch 1 with a fresh attempt/request set,
  so already-succeeded steps can consume quota again. This differs from retained same-request
  retry: each batch now has its own UUID, and activated backend idempotency replays the same
  batch's authoritative response without another provider execution or quota unit. No automatic
  retry/resume loop was added. See `docs/ai-request-idempotency.md` for activation/retention limits.
- **Cancellation cannot interrupt an in-flight request.** Its result is discarded and no later
  step/session is published, but the server request may finish and consume quota. The local
  lease remains occupied until it settles; network/lifecycle timing is not guaranteed.
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

## Request identity and future resume

Every run shares one attempt UUID and preallocates a distinct provider request UUID per step.
Retries of a retained prepared call reuse its UUID; a full restart uses new IDs. Cancellation
continues discarding late client results even if the backend caches success. Activated backend
replay protects per-request quota without changing allocation, dedupe, card targets or provenance.

A persisted resumable plan (“steps 1–3 succeeded; continue at 4”) remains separate future work.
Request replay alone does not provide a resume UI or recover an app-killed run.

## Founder QA

Use existing Staging mock generation to check planning, native confirmation, localization and
review cheaply; do not enable real Staging AI or change provider configuration for this work.
No established screen-level slow/failure override exists, so no hidden debug UI or new runtime
flag was added. `npm run test:generation-ux` exercises deferred fake requests, late cancellation,
network errors and daily-limit failures without any real AI requests. It uses Node module mocks
only for native boundaries; pure presentation/orchestration tests also run under `test:ai`.

For a native multi-step fixture, import a plain-text source around 30–45k characters (two steps)
or 100–115k characters (roughly five), select Entire source, and verify the ACTUAL displayed
plan: paragraph/chunk boundaries determine the exact count. Repeat distinct factual paragraphs
for layout/progress QA; mock results are not evidence of real-model quality. Mock steps may be
too fast to manually cancel mid-request; use the deterministic deferred tests for those races
and a limited Development real-provider pass for final device/network/lease verification.

Device checklist:

1. Small one-step source: no multi-step summary, confirmation or Cancel. Test Small/Medium/Large.
2. Two-step source: accurate summary, final deck ceiling, no confirmation.
3. Four/five-step source: chosen scope, sections/pages, steps and final tier match the native
   confirmation. First real attempt shows consent before confirmation; cancel either → no calls.
4. Real-provider planned quota appears without a remaining count; mock has no quota claim.
5. Cancel early, mid-run and in the final request; repeated taps, back navigation and reopening
   must not create another orchestration, partial draft, saved deck or stale review navigation.
6. Test provider failure, quota exhaustion and network loss. Expect incomplete/no-save copy;
   retry restarts at step 1 and can consume requests again. No resume or automatic save.
7. Background/foreground while a step runs: no automatic restart or phantom review. Kill/reopen
   loses the run; this is not background generation.
8. Entire source, Uncovered, page range and section range: no contradictory Automatic warning;
   too-large selections offer range guidance. Processing all material is not saved-card coverage.
9. A fully processed source producing few cards retains neutral shortfall copy, including after
   exact dedupe; no filler or claim that the source necessarily lacks useful information.
10. Arabic RTL, VoiceOver/TalkBack, large Dynamic Type, native dialog focus and all themes.

No real-device or live-provider QA is claimed by this change.

## What this batch deliberately does not change

`src/domain/sourceCoverage.ts`/`sourceCoverageService.ts` (Source Coverage math — a different
branch's territory), `src/storage/generatedCardProvenance.ts`, `contextPreparation.ts`'s budget or
algorithm, the count-quality contract (`responseValidation.ts`'s validation rules,
`generationOptions.ts`'s presets), any normalization adapter, the backend Lambda's quota/
concurrency scheme or any AWS/CDK resource, the AI model/provider, Staging/Production AI
enablement. No new npm dependency.
