# AI Generation Foundation

**Status: implemented on `feat/ai-generation-foundation`, not yet integrated into `v3.1-dev`.**
This document describes a domain/service **contract and boundary** only. No AI provider, model
API, prompt, or production generation UI exists anywhere in this batch — see "What is
intentionally NOT implemented" below. Builds directly on top of the already-integrated
[Source Normalization Foundation](./source-normalization-foundation.md)
(`src/domain/normalization/`, merged into `v3.1-dev`). See CLAUDE.md's Documentation Hierarchy for
how this fits alongside the rest of the Library/AI documentation once integrated.

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
  requestedCardCount: number;
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
| `cardCount` | `"small"` (≈8) / `"medium"` (≈15) / `"large"` (≈25), or an explicit number |
| `difficulty` | `"basic"` / `"balanced"` / `"advanced"` |
| `cardStyle` | `"question-answer"` / `"concept-definition"` |

`resolveRequestedCardCount()` (`generationOptions.ts`) always clamps to
`[MIN_CARDS_PER_DECK, ABSOLUTE_MAX_CARDS_PER_DECK]` (`1`–`40`) regardless of whether the input was
a preset or a caller-supplied number.

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
  resultingCardCount: number;
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
already be `{ title: string, cards: [{ front: string, back: string, sourceChunkIds: string[] }] }`
or it is rejected outright as `malformed-response`.

**Design decision (documented, not incidental):** a structural problem — wrong shape entirely, an
invalid/empty/overlong title, more cards than `ABSOLUTE_MAX_CARDS_PER_DECK` (40), or zero cards
surviving per-card validation — is a **whole-response rejection**. Interval does not silently
salvage a structurally unsafe response. An individual otherwise-well-formed card with its own
problem (blank front/back, over `MAX_FRONT_LENGTH`/`MAX_BACK_LENGTH`, missing or unknown
provenance, or an exact duplicate of an earlier card in the same response) is **excluded** from the
draft and its issue recorded in `generation.issues` — an otherwise-good 14-of-15-card deck is not
thrown away over one bad card. If exclusion would leave zero cards, that escalates to a whole-deck
failure (`no-valid-cards`).

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
| Cards per deck | `ABSOLUTE_MAX_CARDS_PER_DECK = 40` |

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

```ts
const GENERATION_LIMITS = {
  maxCardsPerRequest: 40,
  maxContextCharsPerRequest: 60_000,
  maxRequestsPerUserPerDay: 20,
  maxConcurrentRequestsPerUser: 1,
  requestTimeoutMs: 30_000,
};
```

(`src/domain/ai/limits.ts`, restated inline in the backend skeleton per the no-shared-module
convention.) These are **beta-safe contract numbers**, not a billing product and not derived from
any real provider's pricing — the mission explicitly asked for the *shape* of rate/cost control
(bounded input, bounded output, bounded requests/user/day, a swappable inexpensive-model seam,
telemetry that excludes source content) before a provider is even chosen, not fabricated precise
cost figures. `GenerationRateLimiter` is an interface only; `NOOP_RATE_LIMITER` (always allows) and
the backend skeleton's `checkRateLimit()` (also always allows) are explicitly **not** real limiters
— a real implementation needs a durable, atomic, per-user counter (e.g. a DynamoDB conditional
update), which is out of scope for this batch ("NO AWS DEPLOYMENT").

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

## What is intentionally NOT implemented

- No real model provider call anywhere (no OpenAI/Anthropic/Bedrock/Gemini SDK, no network
  request). `ModelProvider` is implemented only by the mock.
- No production-visible "Generate" UI/button. Nothing in this batch is reachable from the app's
  real navigation.
- No AI Tutor, "Ask This Source," summaries, quizzes, Discover-feed generation, embeddings, vector
  database, semantic search, RAG, transcription, OCR, image vision, or autonomous-agent behavior.
- No deployed backend — `ai-generate-study-deck/index.mjs` is a reference skeleton only.
- No real rate limiter — `NOOP_RATE_LIMITER` and the skeleton's placeholder always allow.
- No relevance ranking / smarter chunk selection — `rankChunks` is a reserved, unused seam.
- No AWS action of any kind was taken to produce this batch.

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

## Next step to real provider integration

1. Founder selects a provider (see "Provider landscape" above — non-binding input only).
2. Implement one real `ModelProvider` (e.g. `openAiProvider.ts` or similar) that calls the chosen
   provider's structured-output API server-side and maps its response into the same
   `ModelProviderOutcome` shape `mockProvider.ts` already returns — no change needed to
   `aiService.ts`, `contextPreparation.ts`, or `responseValidation.ts`.
3. Deploy `ai-generate-study-deck`'s real counterpart via CDK (its own explicit, founder-approved
   AWS change — new Lambda, new API Gateway route, new IAM policy, the provider credential stored
   as a Lambda environment variable/secret, never in client code) and wire a real
   `GenerationRateLimiter` backed by DynamoDB.
4. Build the production "Generate" UI/review screen — a separate, future UX batch, explicitly out
   of scope here.
5. Build "Save accepted deck" — turning an approved `GeneratedDeckDraft` into a real
   `DeckRecord`/`CardRecord[]` — also explicitly out of scope here.

No AI provider (OpenAI, Anthropic, Bedrock, Gemini, or otherwise) is named, selected, or called
anywhere in this batch's code or in this document as an implemented choice — only referenced
above as non-binding future-decision context.
