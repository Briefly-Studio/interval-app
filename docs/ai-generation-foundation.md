# AI Generation Foundation

**Status: implemented and integrated into `v3.2-dev`.** This document describes a domain/service
**contract and boundary**. The only provider is the deterministic local mock
(`src/domain/ai/mockProvider.ts`); **no real AI provider, provider SDK, model API, prompt, or
network AI call exists**, and the reference backend Lambda
(`backend/lambdas/ai-generate-study-deck/`) is a contract stub that is not referenced in `infra/`
and not deployed — see "What is intentionally NOT implemented" below. The user-facing workflow
built on this boundary is [Generate Study Deck](./generate-study-deck-ux.md) (also integrated
into `v3.2-dev`, gated to Development/Staging). Builds on the
[Source Normalization Foundation](./source-normalization-foundation.md)
(`src/domain/normalization/`, also integrated). See CLAUDE.md's Documentation Hierarchy and its
"v3.2 integrated features" section.

## Purpose

The planned first AI feature is:

```
Library Source → Generate → Study Deck → Review generated cards → Save accepted deck
```

This batch does not build that user-facing feature. It builds the **architectural boundary**
underneath it: a provider-neutral, provenance-aware contract that turns a
`NormalizedSourceContent` (already-merged normalization output) into a `GeneratedDeckDraft` a
future review screen could render, validate strictly enough that a malformed or unsafe model
response can never reach the user's real deck storage, and keep every model-provider concern
(credentials, SDKs, network calls) on a server boundary the mobile app never touches directly.

Explicitly **not** built in this batch, regardless of how tempting the adjacency: AI Tutor, "Ask
This Source," summaries, quizzes, Discover-feed generation, embeddings, a vector database,
semantic search, RAG, transcription, OCR, image vision, or any autonomous-agent behavior. The
scope is Source → Generate Study Deck, and only the foundation layer of that.

## Architecture at a glance

```
NormalizedSourceContent (already merged — normalization foundation)
        │
        ▼
prepareGenerationContext()   — bounded, deterministic chunk selection (contextPreparation.ts)
        │
        ▼
GenerateStudyDeckRequest      — safe-to-log request shape (types.ts)
        │
        ▼
ModelProvider.generate()      — the ONE seam a real provider adapter implements (aiService.ts)
        │
        ▼
validateGeneratedDeckResponse() — strict, deterministic structural + safety validation (responseValidation.ts)
        │
        ▼
GeneratedDeckDraft            — review-only draft; never auto-saved to deck/card storage
```

`generateStudyDeck()` (`src/domain/ai/aiService.ts`) is the single orchestration function tying
these together. Everything reachable from `src/domain/ai/` is pure, provider-agnostic TypeScript —
no network call, no provider SDK, no credential exists anywhere in this module tree.

## Provider abstraction

```ts
interface ModelProvider {
  id: string;
  generate(input: { request: GenerateStudyDeckRequest; context: GenerationContext }): Promise<ModelProviderOutcome>;
}
```

This is the **only** seam a real model provider ever occupies. No screen, no domain file outside
`aiService.ts`'s caller, and no other part of the app is permitted to reference a provider SDK,
call a model endpoint, or hold a model credential. `ModelProviderOutcome` is either
`{ status: "ok", raw: unknown }` (an untyped payload — only `validateGeneratedDeckResponse` is
allowed to give it structure) or `{ status: "error", code, message }` using the same stable
`GenerationErrorCode` union the rest of the contract uses.

**Provider credential policy (hard rule, not a preference):** a model API key must never appear in
the mobile app, in an Expo env var shipped to the client, in `app.json`, or in bundled JS. Every
real model call must execute behind a trusted backend the mobile app calls with its existing
Cognito-authenticated session — never a direct client → provider-API call. `mockProvider.ts`
(below) exists specifically so the mobile-side pipeline can be exercised end-to-end today without
ever needing a real credential.

## Data flow

1. A caller (future UI, or a test) has a `NormalizedSourceContent` (from the already-merged
   normalization foundation) and a set of `GenerationOptions`.
2. `generateStudyDeck(provider, input)` checks `content.extraction.status`. Anything other than
   `"ready"` short-circuits to a `GenerationError` — no context preparation, no provider call, no
   partial attempt (see "Extraction-status mapping" below).
3. `prepareGenerationContext()` selects a bounded, deterministic, in-document-order subset of
   `content.chunks` within a character budget — never a token budget (see "Provider-neutral
   sizing").
4. `buildRequest()` assembles a `GenerateStudyDeckRequest` — safe to log in full.
5. The injected `ModelProvider.generate()` is called with `{ request, context }`. In this batch,
   that's always `mockProvider.ts`; a future batch swaps in a real backend-calling adapter without
   changing anything upstream or downstream of this one call.
6. `validateGeneratedDeckResponse()` is the only code path allowed to turn the provider's raw
   output into a `GeneratedDeckDraft`. A structural failure (wrong shape, invalid title, zero
   surviving cards, too many cards) is a whole-response rejection. An individual bad card (blank
   front/back, over length, missing/unknown provenance, an exact duplicate) is excluded from the
   draft and recorded in `generation.issues`, not fatal on its own.
7. The caller receives a `GenerateStudyDeckOutcome` — either `{ status: "ready", draft }` or
   `{ status: "error", error }`. A draft is **never** written to real deck/card storage by this
   layer; that remains an explicit, separate, future user action ("Review generated cards → Save
   accepted deck").

### Extraction-status mapping

`NormalizedSourceContent.extraction.status` is `"ready" | "empty" | "unsupported" |
"pending-extraction" | "too-large" | "failed"` (normalization foundation). This batch's
`GenerationErrorCode` union has no dedicated code for a genuine extraction *failure* — the mission
scope for this contract enumerates a fixed set of codes, and none of them is
`"extraction-failed"`. `failed` is deliberately folded into `"unsupported-source"`
(`aiService.ts`'s `EXTRACTION_STATUS_TO_ERROR`): either way there is no usable source content to
generate from, and treating a failure the same as "format not supported" is the conservative
choice — reject outright, never guess at partial content. The rest map directly:
`empty → source-empty`, `unsupported → unsupported-source`, `pending-extraction →
normalization-not-ready`, `too-large → source-too-large`.

## Generation request contract

```ts
type GenerateStudyDeckRequest = {
  sourceId: string;
  sourceTitle: string;
  normalizationVersion: number;
  generationContractVersion: number;
  selectedChunkIds: string[];
  requestedCardCount: number;        // the ceiling — "up to this many"
  targetMinimumCardCount: number;    // the quality floor — see "Count contract" below
  options: GenerationOptions;   // { cardCount, difficulty, cardStyle }
  language?: string;
};
```

Deliberately safe to log **in full** — it carries ids, counts, and options only, never chunk text.
`GenerationContext` (the actual chunk *text* payload) is a separate type that only ever travels
alongside a request, never in place of it, and is never itself logged.

### Generation options

Kept deliberately small — a user picks a size/difficulty/style, never a prompt:

| Option | Values |
| --- | --- |
| `cardCount` | `"small"` / `"medium"` / `"large"`, or an explicit number — see "Count contract" below for the exact target range each tier maps to |
| `difficulty` | `"basic"` / `"balanced"` / `"advanced"` |
| `cardStyle` | `"question-answer"` / `"concept-definition"` |

`resolveRequestedCardCount()` (`generationOptions.ts`) always clamps to
`[MIN_CARDS_PER_DECK, ABSOLUTE_MAX_CARDS_PER_DECK]` (`1`–`40`) regardless of whether the input was
a preset or a caller-supplied number. `resolveTargetMinimumCardCount()` is its companion,
resolving the same input to the tier's quality floor.

## Count contract and insufficient-distinct-content

Each named tier is a **range**, not a single number (`CARD_COUNT_PRESETS`, `generationOptions.ts`):

| Tier | User-facing ceiling ("Up to N cards") | Internal target minimum |
| --- | --- | --- |
| Small | 8 | 5 |
| Medium | 15 | 10 |
| Large | 25 | 18 |

The ceiling is unchanged from before this contract existed — it is still the exact number sent as
`requestedCardCount` and still the exact copy shown in the options screen ("Up to 8/15/25
cards"). The **target minimum** is new: a genuine quality floor the tier should normally satisfy
when the supplied material has enough distinct content — never exposed in the selector UI (the
user's expectation is enforced by generation *behavior*, not by showing them an internal range),
and never permission for the app itself to fabricate, duplicate, or locally split cards to reach
it. The one explicit exception for an unnamed numeric override (no preset tier, so no range
exists): the target minimum equals the requested number itself — a caller bypassing the presets
gets no implicit slack.

**Why this exists.** Before this contract, the ONLY instruction the model received about count was
"produce up to N — fewer if the source doesn't support that many," with no stated floor, no
target framing, and no requirement to explain an undershoot. A low-temperature extraction model
given that instruction has every incentive to stop at a small, safely-non-duplicate number —
founder QA observed Medium (15) returning 7 cards from source material that could have supported
far more, with literally no explanation anywhere in the app for why. "Produce up to N" was a
ceiling-only instruction masquerading as a quality bar.

**`GenerationStatus` — `"complete" | "insufficient-distinct-content"`.** The model is asked to
self-report, as a structured field on its own JSON response (`generationStatus`), whether it
judges the supplied material sufficient to meet the tier's target minimum. This is a genuine
machine-readable signal, not prose — never "Sorry, there wasn't enough information…" parsed out
of free text. But it is **advisory only**: `deriveGenerationStatus()` (`responseValidation.ts`,
restated independently in the backend Lambda's `index.mjs` — no shared module between Lambdas/
mobile, same convention as every other validation rule here) computes the AUTHORITATIVE status
purely from the actual accepted card count vs. `targetMinimumCardCount`, and that always wins:

- A model claiming `"complete"` while under-delivering (e.g. 7 of a 10-minimum Medium request) is
  never silently trusted — the authoritative status is overridden to
  `"insufficient-distinct-content"`, and the cards are still kept (see "User experience" below);
  this is never a whole-deck rejection by itself.
- A model claiming `"insufficient-distinct-content"` despite actually meeting the floor (e.g. 12
  of 10) is overridden to `"complete"` — the numbers already disprove the claim.
- A missing, unrecognized, or otherwise malformed `generationStatus` value is treated exactly like
  an absent one; it is never a structural rejection reason by itself (`coerceGenerationStatus`
  returns `undefined` rather than failing the whole response).

Why trust the count over the model's own claim? Because the alternative — trusting
self-reported metadata as the gate for user-facing behavior — is exactly the kind of inconsistent-
metadata risk a fail-safe validator must not accept (see "Invalid semantics" examples: a model
could return 7 cards and still claim `"complete"`, or claim insufficiency despite having met the
target). The self-report still matters as a **prompting mechanism**: it gives the model an
explicit, disciplined way to decide to stop early, with instructions on exactly when that's
legitimate (see the prompt text below) — it just never becomes the sole arbiter of what the app
does with the result.

**Preventing the escape hatch from becoming a new excuse to under-generate.** The system prompt
(`bedrockClient.mjs`'s `buildGenerationPrompt`) states the range as a real target, not merely a
ceiling, and is explicit that `"insufficient-distinct-content"` is for a genuine content shortfall
only — never for "reaching the minimum would take extra effort":

> "Produce between {targetMinimumCardCount} and {requestedCardCount} distinct, source-grounded
> cards. Treat this as a real target range, not merely a ceiling: make a serious, genuine effort
> to identify at least {targetMinimumCardCount} distinct, study-worthy concepts in the supplied
> material before concluding there are not enough. Do not pad the count by splitting one fact into
> multiple trivial cards, duplicating a concept under different wording, or inventing content not
> present in the supplied chunks — quality always comes before hitting the number. Only when the
> supplied material genuinely cannot support {targetMinimumCardCount} distinct, non-duplicate,
> well-supported cards without resorting to those shortcuts, produce as many good cards as the
> material actually supports and set "generationStatus" to "insufficient-distinct-content" —
> otherwise set it to "complete". Never use "insufficient-distinct-content" merely because
> reaching {targetMinimumCardCount} would take extra effort; use it only when doing so would
> require unsupported facts, substantial duplication, meaningless fragmentation, or low-value
> filler. Never exceed {requestedCardCount} cards under any circumstance."

The zero-usable-material fallback (previously `{"title": "...", "cards": []}`) now also sets
`"generationStatus": "insufficient-distinct-content"` — a genuinely empty result is always,
definitionally, the insufficient case, never a silent empty "complete."

**A new structural rejection: `exceeds-requested-max`.** Distinct from the existing
`too-many-cards` (which guards the GLOBAL `ABSOLUTE_MAX_CARDS_PER_DECK` safety ceiling, 40,
regardless of tier), this rejects a response whose raw card count exceeds THIS request's own
`requestedCardCount` — e.g. 20 cards for a Small request whose ceiling is 8. Checked before any
per-card work, same whole-deck-rejection design as every other structural check in this file.
Rejected outright, never silently truncated — truncating would mean the app itself edits which
cards survive, an editorial decision this validator deliberately never makes.

**User experience when below target.** The review screen (`app/library/[id]/generate/review.tsx`)
shows a distinct, non-blocking informational banner — never an intrusive alert — specifically when
the AUTHORITATIVE status is `"insufficient-distinct-content"`, positioned near the existing
"Created X cards using Y of Z sections" coverage note (which it replaces when both would otherwise
apply, to avoid explaining the same shortfall twice). Copy deliberately avoids implying the whole
*source* lacks material when only the bounded `GenerationContext` was ever supplied — "the source
sections used for this generation," never "this book only supports 7 cards." The user can still
keep, edit, or save every card; nothing about this status blocks or alters the existing
generation → review → explicit Save workflow.

**A merely-below-maximum result is never flagged.** 13 cards for a Medium (10–15) request is an
ordinary, unremarked success — the authoritative status is `"complete"` because 13 ≥ 10. Only
falling below the target MINIMUM triggers the new banner; falling below the ceiling never did and
still doesn't need to.

**What this batch deliberately does not change.** Bounded `GenerationContext` sizing
(`contextPreparation.ts`, `DEFAULT_CONTEXT_CHAR_BUDGET`/`MAX_CONTEXT_CHAR_BUDGET`) is completely
untouched — "19 of 193 sections used" and "7 cards generated" are two different concepts, and this
batch only fixes the second. **Generation today still does not guarantee coverage of an entire
large source** — only of whatever bounded context fit the existing budget; a future chapter/page-
range/source-section picker and multi-batch whole-source generation (neither implemented here)
would be how a user eventually directs which material a generation draws from, and/or generates
from more than one bounded context per deck. Nothing in this batch hard-codes an assumption that
`GenerationContext` represents "the beginning of a source" — the count/status contract is
agnostic to how the context was selected, so a future selection feature can plug in without a
schema change here. No local filler/duplication/fabrication was added anywhere, and no automatic
retry loop exists — a below-target result is reported honestly exactly once per generation
attempt, never silently re-requested.

### `generationContractVersion`

Starts at `1` (`GENERATION_CONTRACT_VERSION`, `types.ts`) — independent of and unrelated to
`normalizationVersion`. Exists so a future prompt/schema change can be told apart from "the
underlying normalized source content changed," the same reasoning
`source-normalization-foundation.md`'s "Normalization version" section applies one layer down.

## Context preparation (provider-neutral sizing)

`prepareGenerationContext()` (`contextPreparation.ts`) selects chunks **sequentially, in the
source's own deterministic order**, greedily including whole chunks until a character budget
(`DEFAULT_CONTEXT_CHAR_BUDGET = 24,000`, capped at `MAX_CONTEXT_CHAR_BUDGET = 60,000`) would be
exceeded. Rules, matching the mission's explicit requirements:

- **Deterministic ordering** — same input always selects the same chunks in the same order.
- **Provenance preserved** — selected chunks retain their original `ChunkProvenance` untouched.
- **Explicit size ceiling, no silent truncation** — a chunk is either fully included or fully
  excluded; a chunk's *text* is never cut to fit the remaining budget.
- **Honest "full source" reporting** — `fullSourceIncluded` is `false` the instant even one chunk
  had to be excluded, and `excludedChunkIds`/`excludedChunkCount` are always populated, so nothing
  downstream can present a partial-context generation as if the whole source was used.
- **No embeddings, no relevance ranking in this batch.** The `rankChunks` parameter is a reserved,
  documented extension seam for a future smarter-selection pass — v1 always uses identity
  ordering.

Sizing is measured in **JS string character count only** — the same provider-neutral choice
`chunking.ts` already made for `approxSize`. No tokenizer, and no provider name, appears anywhere
in `src/domain/ai/`. A real provider adapter is free to perform its own exact token accounting on
top of whatever context this layer selects; that accounting never needs to leak back into this
domain layer.

## Provenance

Every `GeneratedCardDraft` carries `sourceChunkIds: string[]` — **required**, never optional, and
never fabricated. `validateGeneratedDeckResponse` rejects (excludes) any card whose
`sourceChunkIds` is empty (`missing-provenance`) or references a chunk id that wasn't actually in
the supplied context (`unknown-chunk-id`). `confidence?` exists on the type only for a future
provider adapter that receives a genuine model-reported confidence value — nothing in this batch
ever invents one.

Because `ChunkProvenance` (from the normalization foundation) already carries real `lineRange`/
`charRange`/`page`/`heading` data for the formats that support it, a future review UI can trace a
generated card back through its `sourceChunkIds` to say "Generated from lines 220–260" or
"Generated from page 14" — the data this claim needs already exists today; this batch just carries
the chunk ids through, it doesn't yet render that UI.

## Generated deck draft contract

```ts
type GeneratedDeckDraft = {
  title: string;
  cards: GeneratedCardDraft[];   // { id, front, back, sourceChunkIds, confidence? }
  sourceId: string;
  generation: GenerationMetadata;
};

type GenerationMetadata = {
  generationContractVersion: number;
  normalizationVersion: number;
  sourceId: string;
  selectedChunkIds: string[];
  requestedCardCount: number;
  targetMinimumCardCount: number;    // echoed from the request
  resultingCardCount: number;
  generationStatus: GenerationStatus; // AUTHORITATIVE — see "Count contract" above
  generatedAt: string;
  providerId: string;
  fullSourceIncluded: boolean;
  excludedChunkCount: number;
  issues: CardValidationIssue[];   // per-card issues that caused exclusion, if any
};
```

A `GeneratedDeckDraft` is **never** written into real deck/card storage by anything in this batch —
no `DeckRecord`/`CardRecord` is created, no `AsyncStorage` key is touched. "Review generated cards
→ Save accepted deck" remains a separate, future, explicit user action outside this contract's
scope.

`GeneratedCardDraft.id` is a deterministic, content-addressed fingerprint (FNV-1a 32-bit over
`index | front | back | sourceChunkIds`, mirroring `chunking.ts`'s `computeChunkId` approach) —
never a random UUID.

## Structured output schema and validation

`validateGeneratedDeckResponse()` (`responseValidation.ts`) is the **only** code path allowed to
turn a provider's raw response into a `GeneratedDeckDraft`. It never parses prose — a response must
already be `{ title: string, generationStatus?: "complete" | "insufficient-distinct-content",
cards: [{ front: string, back: string, sourceChunkIds: string[] }] }` or it is rejected outright as
`malformed-response`. `generationStatus` is optional and advisory only — see "Count contract and
insufficient-distinct-content" above for why it's never blindly trusted.

**Design decision (documented, not incidental):** a structural problem — wrong shape entirely, an
invalid/empty/overlong title, more cards than `ABSOLUTE_MAX_CARDS_PER_DECK` (40), more cards than
THIS request's own `requestedCardCount` (`exceeds-requested-max`), or zero cards surviving
per-card validation — is a **whole-response rejection**. Interval does not silently salvage a
structurally unsafe response. An individual otherwise-well-formed card with its own problem (blank
front/back, over `MAX_FRONT_LENGTH`/`MAX_BACK_LENGTH`, missing or unknown provenance, or an exact
duplicate of an earlier card in the same response) is **excluded** from the draft and its issue
recorded in `generation.issues` — an otherwise-good 14-of-15-card deck is not thrown away over one
bad card. If exclusion would leave zero cards, that escalates to a whole-deck failure
(`no-valid-cards`). A below-target-minimum card COUNT, by contrast, is never a whole-deck
rejection on its own — see "Count contract" above.

### Duplicate detection

Deterministic, not semantic: front/back are trimmed, lowercased, and whitespace-collapsed before
comparison. Two cards that are the same question/answer pair modulo obvious formatting differences
are treated as duplicates; no embeddings, no fuzzy/semantic similarity — exactly the
mission's "do not over-engineer semantic similarity yet" instruction.

### Bounds

| Field | Limit |
| --- | --- |
| Deck title length | `MAX_TITLE_LENGTH = 80` |
| Card front length | `MAX_FRONT_LENGTH = 300` |
| Card back length | `MAX_BACK_LENGTH = 500` |
| Cards per deck (global safety ceiling) | `ABSOLUTE_MAX_CARDS_PER_DECK = 40` |
| Cards per deck (this request's own tier ceiling) | `requestedCardCount` — see "Count contract" above |

## Error model

```ts
type GenerationErrorCode =
  | "normalization-not-ready" | "source-empty" | "source-too-large" | "unsupported-source"
  | "context-too-large" | "rate-limited" | "generation-timeout" | "provider-unavailable"
  | "malformed-model-output" | "unsafe-output" | "validation-failed";
```

A `GenerationError` always carries one of these stable codes plus a message safe to show a user —
never a raw provider error, stack trace, or provider-specific error shape passed through directly.
A validation failure additionally carries the structured `deckIssues`/`cardIssues` that caused it,
for a future debug/review surface — never raw provider output.

## Privacy model

Only the chunks `prepareGenerationContext()` actually selected leave the device (today; in the
future, leave the device *and* cross the backend boundary to a provider). Specifically excluded
from ever crossing that boundary by this contract's own shape:

- Any other Library source's content or metadata.
- Account-wide metadata (email, Cognito attributes, other decks/cards/sessions).
- The source's raw filename (`GenerateStudyDeckRequest` carries `sourceTitle` — the user-facing
  display title — never `originalName`).
- Any personal profile data not already part of the normalized chunk text itself.

`GenerateStudyDeckRequest` is safe to log in full for exactly this reason — it is deliberately
built to contain no source text, so logging it for debugging can never leak source content.

## First-use consent

Before a user's FIRST real cloud-AI generation (never for mock generation — "do not interrupt
mock generation unnecessarily"), `app/library/[id]/generate/index.tsx`'s `onGenerate` shows a
plain-language disclosure and requires an explicit, active choice before any backend request is
made.

**Gate:** `src/domain/ai/providerSelection.ts`'s `isRealProviderActive()` — a pure boolean mirror
of `selectModelProvider()`'s own mock/real decision (`USE_BACKEND_PROVIDER && isDevelopment`), so
this gate tracks that decision automatically if Staging/Production are ever flipped to real AI
later. No second place decides this. Today: Development → consent required; Staging (still mock)
and Production (Generate gated) → never shown.

**Copy (all 13 locales, `generateDeck.consent.*`):** "Generate with AI" / "To create cards,
Interval sends the text selected from this source to its cloud AI service. Your original file is
not sent to the AI model. AI-generated cards may contain mistakes, so you'll review them before
saving." — deliberately provider-neutral ("Interval's cloud AI service," never "Bedrock" or
"Nova" in user-facing copy — this document and `docs/cdk-infrastructure.md` are where the real
provider name lives), and deliberately silent on claims this implementation doesn't guarantee:
never "fully private," never "never leaves your device," never a specific retention promise about
the underlying provider, never "your entire document is sent" (bounded-context partial-source
disclosure — `generateDeck.coverage.*` — is separate and unchanged by this).

**Mechanism:** a native `Alert.alert` (`src/ui/aiConsentDialog.ts`) — the same Cancel/explicit-
action convention already used throughout this app (action sheets, the existing "discard draft"
confirmation), not a new custom modal. This gets a meaningful title, logical read order, clearly
exposed actions, RTL layout, and focus handling for free from the OS. Cancel has no `onPress` at
all — dismissing the alert any other way a platform allows is equally inert. **Only an explicit
tap on Continue** calls back into the generate flow; nothing is ever inferred from merely opening
the screen, and no checkbox is ever pre-checked (there is no checkbox at all).

**If canceled:** nothing happens. No backend request, no quota consumed, no lease acquired, no
generation starts — the consent check runs entirely before `runGenerateDeckFlow` is ever called.

**Persistence (`src/storage/aiConsent.ts`):** `interval.aiGenerationConsent.v1`, scoped per
account via the existing `scopedKey(WorkspaceScope, ...)` mechanism (same convention as Discover
progress) — **local-only, per-account, not synced**. A second device signed into the same account
re-prompts once, exactly like a fresh install would; no backend preference infrastructure was
added for this. Record shape: `{version, acceptedAt}` (`src/domain/ai/aiConsent.ts`'s
`AiConsentRecord`), versioned so a future *materially different* data-sharing behavior (not a
wording tweak) can require renewed acknowledgment by raising `CURRENT_AI_CONSENT_VERSION` —
existing accepted records below that version simply stop satisfying `hasCurrentAiConsent` and the
prompt reappears exactly once per such change. A malformed/corrupted stored record is rejected,
never coerced, and treated identically to "no consent yet."

**Settings/privacy disclosure:** `app/privacy-notice.tsx`'s existing Beta Privacy Notice screen
gained a new `aiGeneration` section explaining the same thing in the same place users already go
for data-use information; the old `futureFeatures` section's claim that "AI-powered features...
are not yet active" was corrected (removed) to stop contradicting this, without redesigning that
screen or touching its Library/Canvas claims (separate, unrelated staleness — out of scope here).

**No new logging was added for this feature.** The consent decision and dialog are pure
client-side UI state; nothing about it is logged anywhere (so there is nothing to audit for
source text, prompts, card contents, tokens, or filenames — the general logging guardrail is
satisfied by having no new log line at all, not by a careful one).

## Backend architecture (design only — not deployed)

Preferred flow, matching the mission's own diagram:

```
Mobile (authenticated) → Interval API → authenticated generation endpoint
    → server-side request validation + rate limiting
    → provider adapter (server-side only)
    → structured model response
    → server-side response validation
    → mobile receives GeneratedDeckDraft
```

A **reference skeleton** demonstrating this shape exists at
`backend/lambdas/ai-generate-study-deck/index.mjs` — **not deployed, not wired into any CDK stack,
API Gateway route, or IAM policy.** It reuses the existing `getUserSub()` dual v1/v2 JWT-claims
pattern (identical to `sync-push`/`sync-pull`/`library-source-storage`) for authentication — no new
identity system — and mirrors (not imports; per this repository's existing "no shared module
exists between Lambdas" convention) the same structural/safety validation rules
`responseValidation.ts` implements, so a real deployment would reject exactly the same malformed or
unsafe model output the mobile-side mock pipeline already exercises in tests. Its
`callModelProvider()` function is an explicit, isolated placeholder that always returns
`provider-unavailable` — the entire, single point where a real provider integration plugs in later
without touching auth, request validation, rate limiting, or response validation.

Deploying this Lambda, wiring a real API Gateway route to it, or adding any real provider
credential to it requires its own separate, explicit founder approval and AWS change — exactly
like any other AWS mutation described in CLAUDE.md's "Environment Safety" section. Nothing in this
batch performed any AWS action.

## Rate limits and cost controls

**Backend-authoritative rate limiting is now implemented** (`backend/lambdas/ai-generate-study-deck/rateLimiter.mjs`
+ `index.mjs`'s `checkRateLimit`), Development-only, replacing the previous always-allow NOOP.
Mobile-reported counters are never trusted — this is the sole source of truth.

```ts
const GENERATION_LIMITS = {
  maxCardsPerRequest: 40,
  maxContextCharsPerRequest: 60_000,
  maxRequestsPerUserPerDay: 20,
  maxConcurrentRequestsPerUser: 1,
  requestTimeoutMs: 25_000,
};
```

(`src/domain/ai/limits.ts`, restated inline in the backend Lambda as `LIMITS`/`RATE_LIMIT_CONFIG`
per the no-shared-module convention — `RATE_LIMIT_CONFIG.DAILY_REQUEST_LIMIT`/
`MAX_CONCURRENT_REQUESTS`/`LEASE_TTL_SECONDS` are the three centralized knobs a future tuning pass
would touch.) These remain **beta-safe contract numbers**, not derived from any real provider's
pricing or a billing product — this batch implements the *enforcement*, not a pricing decision.

### Storage

One new DynamoDB table, `<env>-ai-rate-limits` (Development-only — same conditional as the AI
Lambda itself; see `docs/cdk-infrastructure.md`'s "AI rate-limit table" section for the full CDK
design), holding exactly two ephemeral record kinds, both keyed `PK = U#<Cognito sub>`:

- **Daily quota bucket** — `SK = QUOTA#<UTC-date>`, `{count, ttl}`. The UTC-date-scoped sort key
  IS the reset mechanism — a new day is a structurally distinct item, never a mutation of the
  previous day's count. `ttl` (DynamoDB native TTL) is cleanup only, generous (2 days), never the
  correctness mechanism.
- **Concurrency lease** — `SK = LEASE` (one fixed key per user — at most one lease per user by
  construction), `{leaseToken, expiresAt, ttl}`. `expiresAt` (checked explicitly in the acquiring
  conditional write, independent of whether DynamoDB's own background TTL sweep has run yet) is
  what makes a crashed/timed-out Lambda self-healing: the next request's own acquisition attempt
  reclaims an expired lease, with no sweeper and no permanent lockout.

No source content, prompt, generated card text, auth token, or filename is ever stored — only a
user id, a UTC date or the fixed string `"LEASE"`, and a count/token/expiry.

### Concurrency: atomic, race-free by construction

A single conditional `PutItem` (`attribute_not_exists(PK) OR :now > expiresAt`) acquires the
lease; DynamoDB serializes writes to the same item, so two simultaneous requests for the same user
can never both see "absent." Release is a conditional `DeleteItem` keyed on the exact lease token
the acquirer was given — never unconditional — so a request whose own lease already expired and
was stolen by a later request can never evict that later request's legitimate lease on its own
(delayed) release attempt.

### Daily quota: atomic, race-free by construction

A single conditional `UpdateItem`
(`SET count = if_not_exists(count,0) + 1` with `ConditionExpression: attribute_not_exists(count) OR count < :limit`)
— the identical conditional-write idiom `backend/lambdas/sync-push/index.mjs` already relies on
for its own Records table. The 21st request in a day sees the already-incremented value from the
20th and fails its own condition; there is no window where two concurrent requests both read a
pre-limit count.

### What consumes quota, and why

The concurrency lease is acquired **first**; only a request that wins the slot then consumes a
daily-quota unit — a request rejected purely for concurrency never spends part of the user's daily
allowance on an attempt that was never allowed to begin. Once the lease is held, quota is consumed
**before** the Bedrock call, not after a successful response: a provider failure, a timeout, or a
response that later fails validation still cost a real (billable) Bedrock call, so it is charged
exactly the same as a success. This is a single, deterministic charging point — never multiple
times for one attempt, never zero times for a real one. A request rejected by request validation
(malformed body, mismatched chunk ids) or authentication never reaches this point at all, so it
never consumes quota or a concurrency slot.

### Fail-closed, not fail-open

If the rate-limit table isn't configured, or either DynamoDB call throws anything other than a
condition-check failure (table outage, throttling, an unexpected error), `checkRateLimit` denies
the request (mapped to the existing `provider-unavailable` code, HTTP 503) — it never falls back
to allowing generation through. "Limiter state could not be determined" and "limiter explicitly
denied" are different failure reasons internally, but both result in a denial.

### Error categories

Two new `GenerationErrorCode` values (`src/domain/ai/types.ts`), deliberately distinct from the
pre-existing `rate-limited` (which stays reserved for the underlying Bedrock *provider* itself
throttling — a transient, retry-soon condition):

- **`daily-limit-reached`** — "You've reached today's AI generation limit. Try again tomorrow."
- **`generation-in-progress`** — "Another deck is already being generated. Finish that request
  before starting another."

Both are wired through the existing taxonomy end-to-end: `backendProvider.ts`'s
`KNOWN_ERROR_CODES`/`MESSAGE_FOR`, `generateDeckFlow.ts`'s `GENERATION_ERROR_COPY_KEYS`, and new
`generateDeck.error.dailyLimitReached` / `generateDeck.error.generationInProgress` keys in all 13
locale files.

### Usage metering

Real, provider-reported token usage (`bedrockClient.mjs`'s `extractUsage` — Bedrock's Converse API
response's own top-level `usage: {inputTokens, outputTokens, totalTokens}`) is logged
server-side only (category-level `console.log`, alongside provider outcome and duration) when
Bedrock actually returns it — **never fabricated or estimated** when absent. Nothing here is
returned to the mobile client or persisted beyond CloudWatch's own retention; this is operational
metering to support a future cost/quota UX, not a product analytics pipeline.

A second, separate log line (`index.mjs`, right after response validation succeeds) records only
`requestedMax`, `targetMinimum`, `generatedCount`, and the AUTHORITATIVE `generationStatus` —
again category-level aggregate numbers only, never source text, prompts, or card content. This
exists specifically so a future pass can measure whether Small/Medium/Large are actually behaving
as the "Count contract" section above intends (e.g. is Medium routinely landing near 15, or still
clustering near 7?) without needing a dedicated analytics pipeline — none was built here.

### Request-level idempotency

The request now carries separate optional attempt/request UUIDs for contract-v1 rollout.
`docs/ai-request-idempotency.md` is the authority for durable claims, exact response replay,
atomic quota/provider-start admission, unknown outcomes, retention/privacy and migration.
Committed mode remains legacy until an approved backend optional → client → required rollout.
When activated, same-key replay does not invoke the provider or consume quota; full user restart
uses new keys and remains a new charged logical request. No batch resume or automatic HTTP retry.
The daily limit remains 20 and concurrency remains one. The generation Bedrock client now
uses `maxAttempts: 1`, preventing SDK resends after ambiguous outcomes; wrapper/mobile retry
loops remain absent. Its API is Converse, not InvokeModel. The original nontransactional limiter
continues serving compatibility-mode keyless requests; keyed mode uses the same policy atomically
with its durable provider-start marker. See the new doc for crash/admission limitations.

## Mock adapter

`mockProvider.ts`'s `createMockProvider()` returns a `ModelProvider` that:

- Makes no network call and requires no credential.
- Is fully deterministic — identical `(request, context)` input always produces identical output.
- Produces one card per included context chunk (capped at the requested count), each card's
  `sourceChunkIds` citing exactly that chunk's real id, and back-text derived directly from that
  chunk's own text (never fabricated content unrelated to the supplied source).
- Prefixes every card's front and the deck title with `"[MOCK]"` specifically so nothing
  downstream could ever mistake this for real AI-generated content.

This exists purely so the pipeline (`generateStudyDeck` → validation → draft) can be exercised
end-to-end today, in tests and in a future dev-only harness, without a real model call. It is never
presented as production AI capability.

### Running the focused tests

`npm run test:ai` runs the mobile-side domain tests (`src/domain/ai/*.test.ts`) plus the backend
skeleton's request-validation tests (`backend/lambdas/ai-generate-study-deck/index.test.mjs`) via
Node's built-in test runner (`node --test`) — no test framework dependency added. A small
test-only ESM loader (`scripts/ai-test-loader.mjs`) lets Node resolve this repository's existing
extensionless relative imports directly; it is never loaded by the app itself. Coverage includes
context-budget selection/ordering, extraction-status mapping, structural and per-card response
validation (including duplicate-provenance-id and duplicate-card handling), and the backend
skeleton's size-ceiling and selected-chunk-id consistency checks.

## What is intentionally NOT implemented

- No real model provider call anywhere (no OpenAI/Anthropic/Bedrock/Gemini SDK, no network
  request). `ModelProvider` is implemented only by the mock.
- No production-visible "Generate" UI/button. Nothing in this batch is reachable from the app's
  real navigation.
- No AI Tutor, "Ask This Source," summaries, quizzes, Discover-feed generation, embeddings, vector
  database, semantic search, RAG, transcription, OCR, image vision, or autonomous-agent behavior.
- `ai-generate-study-deck/index.mjs` now implements the real backend path (Bedrock + rate
  limiting) in code and in CDK (Development-only) — whether it has actually been deployed to a
  live AWS account via `cdk deploy` is not confirmable from source alone; see "Next step to real
  provider integration — status" below.
- `NOOP_RATE_LIMITER` (`src/domain/ai/limits.ts`) still exists and is still used by the mobile-side
  mock pipeline's own tests — it was never the real limiter and still isn't; the real one now
  lives entirely server-side (`rateLimiter.mjs`), never on the mobile client.
- No relevance ranking / smarter chunk selection — `rankChunks` is a reserved, unused seam.
- No AWS action of any kind was taken to produce this batch.
- **Count-contract/insufficient-content batch (see "Count contract and insufficient-distinct-
  content" above) deliberately does NOT implement**: chapter/heading detection, a page-range or
  source-section picker, "uncovered sections only" generation, whole-source multi-batch
  generation, automatic iterative AI retries (no "if too few cards, ask again" loop exists
  anywhere — a below-target result is reported exactly once, honestly), RAG, embeddings, a context-
  window expansion, or any model/provider switch. None of these change the bounded
  `GenerationContext` sizing this batch left untouched.
  - **Update (Source Generation Scope batch):** a page-range (PDF)/generic-section-range picker
    and "Uncovered material" generation are now implemented — see `docs/source-generation-scope.md`.
    Chapter/heading-based selection and automatic retries remain not implemented; the bounded
    `GenerationContext` sizing/budget itself is still completely unchanged by that batch too.
  - **Update (Whole-Source Multi-Batch Generation batch):** whole-source multi-batch generation
    is now also implemented — see `docs/whole-source-generation.md`. A selected scope larger than
    one bounded context can now be processed across several sequential, bounded
    `generateStudyDeck` calls, combined into one review draft. The per-batch request/response
    contract, count-quality validation, and this section's own `GenerationContext` sizing are all
    still completely unchanged — multi-batch is a new orchestration layer ABOVE the existing
    per-call contract, not a change to it. Automatic intentionally never multi-batches. Chapter/
    heading-based selection and automatic retries remain not implemented.

## Provider landscape (non-binding — informs, does not select)

Recorded here only as MVP-planning context for a future, separate, founder-approved provider
decision. **Nothing in `src/domain/ai/` is hard-wired to any of these** — the contract is provider-
neutral by construction (character-based sizing, no provider SDK, no provider name anywhere in the
domain layer), so choosing among these later requires writing one new `ModelProvider`
implementation, not a redesign.

Dimensions worth weighing when that decision is made (qualitative only — this batch does not
select a provider or fabricate pricing figures for one):

- **Structured-output support** — whether the provider has a native "constrained/schema-conforming
  output" mode (reduces, but never eliminates, the need for `validateGeneratedDeckResponse` — that
  validation stays regardless, since a provider's schema guarantee is not a security boundary this
  app controls).
- **Context window headroom** relative to `MAX_CONTEXT_CHAR_BUDGET` (60,000 chars ≈ well within
  every mainstream current-generation model's window, so this is unlikely to be a differentiator).
- **Backend SDK maturity** for whatever runtime the eventual Lambda/backend uses (Node.js, matching
  every other Lambda in this repository).
- **Data-handling/retention policy** for submitted content — relevant given this feature's own
  privacy model above (only selected chunks ever leave the device/backend boundary).
- **Swappability** — since the contract is already provider-neutral, this matters less than it
  would in a tightly-coupled design, but a provider with an unusually bespoke request/response
  shape still costs more per adapter to integrate and maintain.
- **Cost controls available at the API level** (hard per-key spend caps, usage alerts) — relevant
  to enforcing `GENERATION_LIMITS` in a real deployment, independent of which model is chosen.

No recommendation is made or implied by this section beyond "the contract above does not need to
change regardless of which provider is chosen later" — an actual provider selection is explicit
future, founder-approved work.

## Next step to real provider integration — status

This section originally described five future steps. The founder has since selected a provider,
and the first two steps are now implemented code (still undeployed, still fail-closed/inactive on
the mobile side) — see the Bedrock integration's own Phase A and Phase B reports for the full
record. Updated status:

1. **Done.** Founder selected **AWS Bedrock, Amazon Nova 2 Lite** as the first real model
   (`us.amazon.nova-2-lite-v1:0`, a cross-Region inference profile — Nova 2 Lite has no direct
   in-region invocation path from `us-east-2`; verified against AWS's own documentation, not
   guessed — see `docs/cdk-infrastructure.md`'s "Bedrock model/region verification" section).
2. **Done (Phase A).** `src/domain/ai/backendProvider.ts` implements the real, backend-calling
   `ModelProvider`; `backend/lambdas/ai-generate-study-deck/bedrockClient.mjs` implements the real
   Bedrock Converse API call. No change was needed to `aiService.ts`, `contextPreparation.ts`, or
   `responseValidation.ts` — exactly as this section originally predicted. The model identifier is
   read only from `BEDROCK_MODEL_ID` at runtime, never hardcoded as a product constant, so a
   future model/provider change (e.g. routing some requests to Claude Haiku) does not require
   touching this seam again.
3. **Done (Phase B), including rate limiting.** The CDK change — new dedicated IAM role, new
   Lambda, new API Gateway route, and (this batch) a new DynamoDB rate-limit table — is
   **implemented in `infra/lib/interval-sync-stack.ts`, Development-only**; whether `cdk deploy`
   has actually been run against a live AWS account is not something this repository's source can
   confirm by itself (see `docs/cdk-infrastructure.md`'s "AI Generate Study Deck Lambda" section).
   Bedrock requires no stored provider credential — IAM alone is sufficient, so no Lambda
   environment-variable secret or Secrets Manager entry was needed. **A real, DynamoDB-backed,
   atomic per-user daily quota and concurrency lease is now implemented**
   (`backend/lambdas/ai-generate-study-deck/rateLimiter.mjs`) — `checkRateLimit()` is no longer a
   NOOP. See this document's own "Rate limits and cost controls" section above for the full
   design; this was the disclosed gap `docs/cdk-infrastructure.md`'s "Rate limiting" section
   previously flagged as required before any Staging deployment, now closed for Development.
4. Build the production "Generate" UI/review screen — still a separate concern from this
   foundation document; see `docs/generate-study-deck-ux.md` for its own status.
5. Build "Save accepted deck" — also tracked separately; see `docs/generate-study-deck-ux.md`.

**Remaining before the mobile app can ever make a real Bedrock-backed generation call:** an
explicit, founder-approved `cdk deploy IntervalDevelopmentStack` (not yet run), followed by
flipping `src/domain/ai/providerSelection.ts`'s `USE_BACKEND_PROVIDER` to `true` (also not yet
done) — both remain deliberate, separate, founder-gated steps, not a side effect of Phase A or
Phase B landing. Amazon Nova 2 Lite via AWS Bedrock is now named, selected, and implemented in
code in this repository — it is not deployed, and the mobile app cannot reach it yet.
