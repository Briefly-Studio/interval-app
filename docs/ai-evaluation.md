# AI Generation Evaluation + Quality Telemetry Foundation

Interval has substantial AI generation capability (TXT/PDF/DOCX/XLSX normalization, bounded
single-request and whole-source multi-batch generation, Small/Medium/Large count-quality
semantics, source grounding/provenance, insufficient-distinct-content signaling, AI consent,
backend rate limits, a real Bedrock/Nova 2 Lite provider in Development) but, until this batch,
no disciplined way to answer whether generation is actually *good*. This document covers the
first evaluation harness + privacy-safe quality telemetry foundation built to start answering
that — deliberately scoped as engineering/evaluation infrastructure, not a full analytics
platform.

**Implemented, merged into `v3.3-dev`; not yet founder-QA verified** (the mock-mode CLI run and
every automated test below are fully verified; a real-provider Development run has not been
performed as part of this batch — see "Founder evaluation workflow").

## Two separate concepts — do not conflate them

- **Offline evaluation harness** (`src/domain/ai/evaluation/`) — controlled, repo-owned
  fixtures, reproducible inputs, deterministic scoring where possible, no dependency on real
  user data. Runs in CI against the deterministic mock provider; can optionally run against the
  real Development backend as a deliberate, explicit opt-in.
- **Runtime quality telemetry** (`src/domain/ai/generationTelemetry.ts`,
  `generationAttemptId.ts`) — privacy-safe aggregate metadata from REAL user/founder generation
  sessions. Never a fixture, never source/card text, dev-only console logging today (no
  telemetry backend exists or was built).

These are two different files, two different purposes, and neither one feeds the other.

## Preflight findings (what already existed, what didn't)

- **User-selectable dimensions today:** `CardCountOption` (small/medium/large or a raw number),
  `DifficultyOption` (basic/balanced/advanced), `CardStyleOption` (question-answer/
  concept-definition), `SourceGenerationScope` (automatic/entireSource/uncovered/pageRange/
  sectionRange), plus an optional `language` string. Source types with real text extraction:
  TXT, PDF, DOCX, XLSX (image/audio are structural stubs, no OCR/transcription).
- **Metadata at request time:** `GenerateStudyDeckRequest` (safe to log in full — ids/counts/
  options only, never chunk text) and `GenerationContext` (chunks + `fullSourceIncluded`/
  `excludedChunkCount`).
- **Metadata at result time:** `GenerationMetadata` (requested/target/resulting card counts, the
  AUTHORITATIVE `generationStatus`, `providerId`, coverage fields, validation `issues`). Multi-
  batch additionally tracked `duplicatesRemoved`/`completedBatchCount`/`totalDurationMs` — but,
  before this batch, only in a dev-only console log, never in the function's own return value.
- **Token usage reached mobile: no.** Bedrock's real `usage: {inputTokens, outputTokens,
  totalTokens}` and the Lambda's own `durationMs` were computed and logged to CloudWatch but
  never returned in the HTTP response body. This batch extends the response (and the mobile-side
  `ModelProviderOutcome`/`GenerateStudyDeckOutcome`/`MultiBatchOutcome` types) to surface both —
  additive, never fabricated/estimated when a provider doesn't report them, never part of the
  persisted generation contract (`GenerationMetadata` itself is untouched).
- **Edit/delete decisions observable before save: no.** `GenerateDeckSession` tracked only a
  single `edited: boolean` flag. This batch adds `editedCardIds: string[]` (distinct cards
  edited, deduped) — `deletedCount` needed no new field, since it was already fully derivable as
  `generatedCardCount - cards.length`.
- **Can a saved card be traced to a generation attempt: no.** No session/attempt/request id
  existed anywhere in the pipeline. This batch adds `generateAttemptId()` (a random, opaque,
  secure UUID correlation id — see "Generation attempt identity" below), generated once per
  `runGenerateDeckFlow` invocation and carried on `GenerateDeckSession.attemptId`.
- **Privacy constraints:** never record source text, prompts, generated card text, filenames,
  auth tokens, or (in telemetry) unnecessary full chunk-id arrays. Fixture text is fine to use —
  fixtures are repo-owned test data, not production-user data.
- **No existing fixture corpus** of any kind (no `fixtures/` directory, no sample binaries) —
  every normalization adapter test already synthesizes its input in memory; this batch follows
  the same precedent.

## Evaluation architecture

```
src/domain/ai/evaluation/
  types.ts     — EvaluationFixture, EvaluationCase, GenerationEvaluationResult, MatrixSelection
  fixtures.ts  — the fixture registry + content (10 fixtures, see "Fixture design")
  matrix.ts    — builds EvaluationCase[] from a selection (small defaults, full grid opt-in only)
  scoring.ts   — pure scoring functions (count-check, grounding, concept coverage, duplicates)
  runner.ts    — drives one case through the REAL generation pipeline against an injected
                 ModelProvider (mock or real) — mirrors generateDeckFlow.ts's own bounded/
                 wholeSource logic rather than reimplementing it
  report.ts    — regression checks, JSON report shape, console table
scripts/eval-ai.mjs — the CLI entry point (npm run eval:ai)
```

The runner calls the SAME domain functions the real app calls (`generateStudyDeck`,
`runMultiBatchGeneration`, `resolveSourceGenerationScope`, `planGenerationBatches`) — it is not a
second, parallel generation pipeline. A fixture's `NormalizedSourceContent` is produced by the
REAL per-format normalization adapter (`normalizeTextSource`, `normalizePdfTextSource`,
`normalizeStructuredBlocks` for DOCX's generic structured-block entry point, or
`buildSpreadsheetText`+`segmentText` directly for XLSX, since `normalizeSpreadsheetSource` itself
only accepts raw ZIP bytes) — never a hand-rolled fake shape. Chunk ids, provenance, and
`contentKind` are all genuinely produced by this repository's own normalization code.

## Fixture design

Ten small, auditable, entirely internally-authored fixtures (`fixtures.ts`) — no copyrighted
material of any kind, no scraped text, no full books. Every fixture is original prose/data
written specifically for this harness, about plain uncontroversial topics (honeybee colonies,
the solar system, houseplant care, photosynthesis, chemical elements, the water cycle) chosen so
`expectedConcepts` can be defined simply and honestly:

| Fixture | Type | Purpose |
|---|---|---|
| `txt-factual-rich` | TXT | Dense factual prose, rich/varied/unambiguous |
| `txt-sparse` | TXT | Deliberately thin — `designedForInsufficiency: true` |
| `txt-narrative-prose` | TXT | Low-factual-density narrative, observational |
| `txt-ambiguous` | TXT | Deliberately self-contradictory, observational |
| `txt-spanish-baseline` | TXT (es) | Non-English — proves Unicode/localized plumbing |
| `pdf-structured-facts` | PDF | 6 pages, real page-based provenance, no `lineRange` |
| `docx-structured-headings` | DOCX | Headings/lists/table rows — structural variety |
| `docx-repetitive` | DOCX | Same 2 concepts restated 8x — duplicate/near-duplicate handling |
| `docx-large-multibatch` | DOCX | 10 topics padded past one context budget — forces multi-batch |
| `xlsx-spreadsheet-facts` | XLSX | A small reference table — spreadsheet-shaped content |

`npm run eval:ai -- --list-fixtures` prints this same list with full descriptions.

**Known, documented simplification:** fixtures call the real normalization adapter's
"skip the file bytes" entry point (already-extracted PDF pages, generic DOCX blocks, pre-parsed
spreadsheet rows) rather than round-tripping through actual binary ZIP/PDF parsing — that
binary-parsing layer is the job of the existing adapter test suites
(`docxAdapter.test.ts`/`spreadsheetAdapter.test.ts`/`pdfAdapter.test.ts`), not this harness, which
exists to evaluate GENERATION quality downstream of normalization.

## Evaluation matrix

`matrix.ts`'s `buildEvaluationMatrix(selection)` is a plain Cartesian product of EXPLICITLY
SELECTED dimension values — calling it with `{}` (or omitting a dimension) falls back to a
small, documented default (one fixture per source type, `balanced`/`medium`/`bounded`), never
"every value." The full grid (`buildFullMatrix()`) is available but requires an explicit `--all`
CLI flag — this harness never silently executes the full Cartesian product.

## Objective metrics (`GenerationEvaluationResult`)

Every metric is either a deterministic structural check (should always pass given
`responseValidation.ts`'s own guarantees — these are confirmatory invariants, not new rules) or
a simple, honestly-labeled substring match:

- `countCheckStatus` / `countScore` — `within-range`, `valid-insufficiency` (an honest shortfall
  — never a failure, regardless of whether the fixture is specifically `designedForInsufficiency`
  — see `deriveCountCheckStatus`'s own doc comment), `exceeded-maximum`,
  `unexplained-under-target` (status claims complete despite falling short — a real regression),
  `insufficiency-despite-target-met` (status claims incomplete despite meeting the floor — also a
  real regression).
- `groundingScore` / `provenanceValidity` — fraction/boolean confirming every card's
  `sourceChunkIds` are real ids within the selected/candidate set.
- `expectedConceptCoverage` — fraction of a fixture's `expectedConcepts` matched by at least one
  card's front+back text, via plain **case-insensitive substring match**. Deliberately NOT
  semantic/NLP matching — no reliable, honest automated method for that exists, so none is faked.
  `undefined` (never a fabricated 0 or 1) when a fixture defines no expected concepts.
- `exactDuplicateCount` — exact (normalized) duplicate card pairs in the final list, reusing
  `responseValidation.ts`'s own `normalizeForDuplicateCheck`.
- `unsupportedClaimCount` — cards containing a fixture's `forbiddenConcepts`, when defined.
- `latencyMs` / `tokenUsage` — see "Latency and token usage" below.

This harness deliberately does **not** compute a numeric "pedagogical quality" score. There is
no reliable, honest automated method for that; pretending otherwise would be worse than not
measuring it. That judgment is the human-review rubric's job (below).

## Human review rubric

For founder/internal review only — never forced into normal app UX, never a giant admin tool.
Score each reviewed card (or the deck as a whole) 1–5 on:

- **Correctness** — is the stated fact actually true relative to the source?
- **Relevance** — does the card test something the source actually covers?
- **Clarity** — is the question unambiguous; is the answer legible on its own?
- **Difficulty match** — does the card's depth match the requested Basic/Balanced/Advanced level?
- **Redundancy** — does this card duplicate another card's concept, even if not an exact string
  duplicate (fuzzy near-duplicates are exactly what a human reviewer catches that
  `exactDuplicateCount` structurally cannot)?
- **Answer usefulness** — would a learner studying this card actually learn the right thing?

This rubric is documentation only — there is no dedicated scoring UI. A founder reviewing a run's
JSON report / console table fills this in by hand (a spreadsheet, a notes doc, whatever's
convenient) alongside the objective metrics.

## Interpreting Basic / Balanced / Advanced

`DifficultyOption` is passed straight through to the provider as part of `GenerationOptions` —
this harness does not (and cannot honestly) compute an automated "difficulty score." What it DOES
give you, objectively, per case: card count, front/back character lengths, and (via the human
rubric) an explicit "Difficulty match" score. To learn whether the three levels actually differ in
practice, run the SAME fixture/tier across all three difficulties (`--difficulty basic
--difficulty balanced --difficulty advanced` in one invocation, or three separate runs) against
the REAL provider and compare card length/depth and the human rubric's "Difficulty match"/
"Application vs. recall" impression by hand — see "Founder evaluation workflow" below for the
exact command. Do not expect the mock provider to show any difficulty differentiation at all — it
is a deterministic, content-echoing fixture with no notion of difficulty (see "Mock vs. real
provider" below).

## Count-quality evaluation

Directly targets the historical "Medium silently returns 7" class of regression. Each result
carries `requestedMaximum`/`targetMinimum`/`generatedCount`/the authoritative `generationStatus`,
and `countCheckStatus` flags exactly the two genuinely bad cases (`unexplained-under-target`,
`insufficiency-despite-target-met`) while accepting an honest shortfall. Run the mission's own
exact comparisons via `--tier small --tier medium --tier large` in one invocation (or
`--all`) and read the console table's Cards/Target columns directly.

## Source coverage / provenance evaluation

`groundingScore`/`provenanceValidity` distinguish, per result:
- **selected chunks** — `resolveSourceGenerationScope`'s own output for this case.
- **processed chunks** — what the batch(es) actually submitted (`selectedChunkIds` on the
  resulting draft/batch outcome).
- **card-referenced chunks** — what `sourceChunkIds` on the final cards actually cite.

A card citing a chunk outside the selected/candidate set is structurally impossible given
`responseValidation.ts`'s own `"unknown-chunk-id"` rejection — these scores are confirmatory
invariants proving that guarantee holds, not a new check inventing a different one.

## Whole-source evaluation

`scope: "wholeSource"` resolves the ENTIRE fixture via `resolveSourceGenerationScope({type:
"entireSource"})`, plans batches via the real `planGenerationBatches`, and — only when that plan
needs more than one batch — runs the real `runMultiBatchGeneration`. `batchInfo` on the result
reports `plannedBatchCount`/`completedBatchCount`. `docx-large-multibatch` is sized specifically
so its candidate content exceeds one context budget (forcing 2+ batches) and its
`expectedConcepts` deliberately span the FIRST and LAST topical section, so a run's
`expectedConceptCoverage` directly answers "are later source regions actually represented, not
just the first batch" — verified at 100% in this harness's own test suite. This harness does not
require every batch to produce a card (allocation policy doesn't guarantee that); it only detects
systematic starvation when a fixture's own design makes that obvious (see
`runner.test.ts`'s multi-batch tests).

## Latency and token usage

`latencyMs` is `Date.now()`-based wall-clock time around the provider round trip — the SAME
timing convention this repository already uses elsewhere (`multiBatchGeneration.ts`'s own
`totalDurationMs`, the backend Lambda's own `durationMs`), not a new timing API. No fake
precision is claimed. `tokenUsage` is Bedrock's own real `{inputTokens, outputTokens,
totalTokens}` — surfaced end-to-end for the first time by this batch (previously computed and
logged to CloudWatch, never returned to the mobile client) — `undefined`, never estimated, when
a provider (the mock) doesn't report it. Multi-batch aggregates `tokenUsage` by summing every
batch's own usage, but only when EVERY batch reported one (never a partial/misleading sum).

## Request replay and execution metrics

`providerExecutionCount` is optional provider/domain/evaluation performance metadata. New keyed
backend responses report first completion as 1 and replay as 0 through transport headers, while
the cached application payload stays identical. Multi-batch sums only when every returned step
reports a count. Missing/legacy/error/lost-response information remains unknown, never guessed
from HTTP attempts or the preflight planned request estimate. This is observed completed-response
execution data, not a complete account billing meter. Cached `tokenUsage` describes the original
result and must not be interpreted as newly spent replay tokens. No automatic retry was added.

These counts describe application provider executions, not SDK transport attempts or confirmed
service-side model executions. The production Bedrock client uses `maxAttempts: 1`, so one
application call makes at most one explicit SDK invocation attempt. A lost response still cannot
prove whether the service executed; error/unknown cases must not be reported as known zero cost.
See `docs/ai-request-idempotency.md`'s retry audit for the exact guarantee.

Attempt IDs now use the existing Expo OS UUID/Web Crypto sources and are sent as safe correlation
IDs; each provider request has a separate UUID. These IDs contain no source/account data.
See `docs/ai-request-idempotency.md` for rollout modes and failure/retention semantics. The mock
harness and all CI tests remain fake-provider-only; no new source/card text enters telemetry.

## Privacy

Hard rule, enforced by the type shapes themselves, not just convention: nothing in
`GenerationEvaluationResult` or `GenerationReviewOutcome` has a slot for source text, prompts,
generated card text, filenames, auth tokens, or (in telemetry) an unnecessary full chunk-id
array. Fixture text is read internally during a run (fixtures are repo-owned test data, not
production-user data) but never written into any report field, log line, or error message.

`generationTelemetry.ts`'s `emitGenerationReviewOutcome` rebuilds its log payload field-by-field
from the five known fields — never `...outcome`/`JSON.stringify(outcome)` on a caller-supplied
object — so a future caller that accidentally widens the object literal it builds can never leak
an extra field through it (verified by its own test:
`a caller-widened object literal can never leak an extra field through`).

The CLI (`scripts/eval-ai.mjs`) never logs an access token, even partially — it is held only in a
local variable, passed straight into `createBackendProvider`'s injected `getAccessToken`, and
never appears in any `console.log`, the JSON report, or an error message.

## CLI usage (`npm run eval:ai`)

```sh
npm run eval:ai -- --list-fixtures
npm run eval:ai                                                  # default mock smoke matrix
npm run eval:ai -- --fixture txt-factual-rich --difficulty balanced --tier medium
npm run eval:ai -- --fixture docx-large-multibatch --scope wholeSource --tier large
npm run eval:ai -- --tier small --tier medium --tier large       # compare tiers in one run
npm run eval:ai -- --all                                         # full grid, mock only unless --real
```

Every flag except `--all`/`--real`/`--yes`/`--help`/`--list-fixtures`/`--out` is repeatable
(`--fixture` multiple times, etc.). Output: a console table + failure summary, and a JSON report
written to `eval-output/<timestamp>.json` (gitignored — see "Telemetry storage" below). Exit code
is non-zero when any regression check fails.

## Mock vs. real provider

**Mock (the default, always used in CI):** `createMockProvider()` — fully deterministic, zero
network calls, safe to run any number of times. `npm run test:ai`/`npm run test:eval` never touch
Bedrock. This is the mode every automated test in this batch runs in.

**Real (explicit opt-in only):** `--real --base-url <url> --access-token <token>` (or the
`EVAL_AI_BASE_URL`/`EVAL_AI_ACCESS_TOKEN` env vars). Requires BOTH — the CLI refuses to silently
fall back to mock if either is missing. Prints the exact planned backend-request count and the
target URL, then STOPS (no request made) unless `--yes` is also passed — a deliberate two-step
confirmation, never a single flag that can fire 30 Bedrock calls by accident. Runs strictly
sequentially (never parallel) and never bypasses the backend's own rate limiting — every request
goes through the exact same HTTP path and the exact same per-user daily quota / concurrency lease
the real app uses. There is no default base URL — Production is never reachable by omission.

**Why the real backend provider needs manual credentials for this CLI specifically:**
`backendProvider.ts` deliberately takes its access-token getter and base URL as injected
dependencies rather than importing `AuthService`/`getEnvironmentConfig` directly, because those
import chains pull in native Expo modules that cannot load under a plain Node process (confirmed
by this repository's own existing test suite, which exercises `backendProvider.ts` the same way).
This CLI runs under plain Node — there is no live Cognito session to read a token from — so the
founder must supply one obtained from an already-signed-in Development session (see "Founder
evaluation workflow").

## Quota implications

Each bounded case and each multi-batch BATCH consumes one of the signed-in user's 20/UTC-day
backend requests — identical to ordinary app usage, since this harness calls the exact same
backend endpoint. `estimatePlannedRequestCount`/the CLI's pre-flight plan print this exact number
before a real run ever starts. A `--real --all` run across every fixture/difficulty/tier/scope
combination would consume a very large number of requests — review the printed plan before
confirming with `--yes`, every time.

## Regression thresholds

Objective-only, matching the mission's own "avoid brittle thresholds on latency/token usage in
CI": exceeded maximum, invalid provenance, an exact duplicate, an unexplained/inverted count-
status mismatch, and expected-concept coverage below a fixture's own threshold (default 1) are
all hard failures. **Mode-gated once:** a non-ready outcome (`provider-unavailable`,
`rate-limited`, `daily-limit-reached`) is ALWAYS a hard failure in mock mode (the deterministic
mock must never legitimately produce one — if it does, something is genuinely broken), but only
OBSERVATIONAL in real-provider mode (expected, non-fatal resource/infrastructure noise — "real-
provider results should be observational unless explicitly promoted to a benchmark," the
mission's own words). A genuine `validation-failure`/`malformed-model-response` is a hard
failure in BOTH modes — it is never merely infrastructure noise.

## Failure taxonomy

`EvaluationOutcomeCategory`: `ready`, `insufficient-content` (descriptive, not necessarily a
failure — see "Regression thresholds"), `provider-unavailable`, `rate-limited`,
`daily-limit-reached`, `malformed-model-response`, `validation-failure`,
`multi-batch-partial-failure` (one or more batches completed before a later one failed),
`canceled`, `harness-config-error` (a fixture/scope/plan resolution problem, or any unexpected
thrown error — always caught, never propagated out of `runEvaluationCase`).

## Telemetry storage

No AWS analytics infrastructure, no new service, no external telemetry backend — none was built,
none is proposed here (hard out of scope). Evaluation run output is a local JSON file under
`eval-output/` (gitignored — `/eval-output/` in `.gitignore`). Commit the schema, fixtures,
harness code, and this document; never commit an actual run's results by default.

## Generation attempt identity

`generationAttemptId.ts`'s `generateAttemptId()` uses the existing native Expo OS UUIDv4
bridge or Web Crypto; it fails closed if neither is available. Generated once per
`runGenerateDeckFlow` invocation, it spans multi-batch requests and the one review session.
`GenerateDeckSession.attemptId` remains in memory and is not copied to saved decks/cards or
provenance. It is now sent as safe backend correlation metadata and temporarily retained by
activated request idempotency. Each provider request has a separate secure UUID, not the attempt
ID reused as a batch key. See `docs/ai-request-idempotency.md` for retention and rollout.

## Runtime telemetry foundation

`GenerationReviewOutcome` (`generationTelemetry.ts`): `attemptId`, `generatedCount`,
`editedCount` (distinct cards edited — `GenerateDeckSession.editedCardIds.length`,
new instrumentation), `deletedCount` (`generatedCardCount - cards.length` — fully derivable, no
new field needed), `savedCount`, `abandoned`. Emitted via `emitGenerationReviewOutcome` from two
call sites: `generateDeckSave.ts`'s `saveDraftDeck` on success, and the review screen's
`discardAndLeave` on an explicit discard. Dev-only `console.log` (same `typeof __DEV__` guard
convention `multiBatchGeneration.ts`'s own `logAggregateOutcome` already established) — no
telemetry backend exists, so this is the typed domain contract a future real pipeline could
consume without this file's own shape changing, not a working pipeline itself.

## Known limitations

- **Fixtures normalize via each format's "skip the file bytes" adapter entry point, not actual
  binary parsing** — see "Fixture design" above. This harness does not re-test normalization
  correctness; the existing adapter test suites already do.
- **The mock provider's "one card per chunk" behavior is a crude proxy for real generation** — a
  short, single-chunk TXT/XLSX fixture can legitimately read as `insufficient-distinct-content`
  under the mock even though a real model would have no trouble drawing many cards from the same
  short text. Several fixtures (`txt-factual-rich`, `txt-spanish-baseline`,
  `xlsx-spreadsheet-facts`) are deliberately written so their key `expectedConcepts` cluster
  within the mock's own 160-character card-back snippet window — this is an honest adaptation to
  a known mock limitation, not a gamed fixture; a real-provider run is not subject to this
  constraint at all.
- **No automated difficulty-differentiation score** — see "Interpreting Basic/Balanced/Advanced."
  Only a real-provider run plus the human-review rubric can actually judge this.
- **No semantic/fuzzy concept matching or hallucination detection** beyond the one deterministic
  `forbiddenConcepts` substring check — a model could state something false about a fixture's
  topic without using any forbidden keyword, and this harness would not catch it. The human-review
  rubric's "Correctness" score is the only safeguard for that.
- **No real-provider run has been performed as part of this batch** — the mock-mode CLI run and
  every automated test are verified; the Development backend's actual behavior under this harness
  (real latency, real token usage, real difficulty differentiation, real multi-batch timing) is
  unconfirmed until a founder runs one (see "Founder evaluation workflow").
- **`estimatePlannedRequestCount` assumes a case's batch plan is stable between the pre-flight
  estimate and the actual run** — true for this harness (fixtures are static, deterministic
  functions; nothing about them changes between the estimate and the run), but worth stating
  explicitly since the two are two separate calls, not one.
- **No CI wiring was added** (no new GitHub Actions step, no change to any existing pipeline
  config) — `npm run test:eval` is available and documented, but actually running it in CI on
  every push is a separate decision this batch does not make unilaterally.

## Founder evaluation workflow

**A. Cheap deterministic mock evaluation** (safe to run any time, any number of times, zero cost):

```sh
npm run eval:ai
```

**B. One real Development fixture run** (after obtaining a Development access token — sign into
a Development build, then read the access token `AuthService.getAccessToken()` currently holds
via a debugger/console breakpoint, or mint one directly with the AWS CLI against the Development
Cognito user pool; never copy a Production or Staging token for this):

```sh
npm run eval:ai -- --real --base-url https://<development-api-base-url> \
  --access-token "<token>" --fixture txt-factual-rich --tier medium
# review the printed plan (should say "1 planned backend request(s)"), then re-run with --yes:
npm run eval:ai -- --real --base-url https://<development-api-base-url> \
  --access-token "<token>" --fixture txt-factual-rich --tier medium --yes
```

**C. Compare Basic vs. Balanced vs. Advanced** (one real fixture, one tier, all three
difficulties — review the resulting cards' depth/length and fill in the human rubric's
"Difficulty match" column by hand):

```sh
npm run eval:ai -- --real --base-url <url> --access-token "<token>" --yes \
  --fixture txt-factual-rich --tier medium --difficulty basic --difficulty balanced --difficulty advanced
```

**D. Compare Small vs. Medium vs. Large** (same idea, across tiers):

```sh
npm run eval:ai -- --real --base-url <url> --access-token "<token>" --yes \
  --fixture pdf-structured-facts --tier small --tier medium --tier large
```

**E. Whole-source fixture** (exercises real multi-batch generation):

```sh
npm run eval:ai -- --real --base-url <url> --access-token "<token>" --yes \
  --fixture docx-large-multibatch --scope wholeSource --tier large
```

**F. Review the generated JSON/report** — open `eval-output/<timestamp>.json`; the console table
printed during the run is the same data in a quicker-to-scan form.

**G. Manually score cards using the rubric** — for each card in the saved/reviewed deck, score
Correctness/Relevance/Clarity/Difficulty match/Redundancy/Answer usefulness 1–5 (see "Human
review rubric" above) in a notes doc or spreadsheet of your own choosing — this harness does not
provide a scoring UI.

**H. Avoid accidentally burning the daily quota** — ALWAYS run without `--yes` first to see the
printed plan; `--all` against `--real` can easily plan more requests than the 20/day quota
allows (the full fixture/dimension grid is large) — prefer a small, explicit `--fixture`/`--tier`/
`--difficulty` selection for any real-provider run, and remember every whole-source case with
more than one batch consumes one request PER BATCH, not one per case.
