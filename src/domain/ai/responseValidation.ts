import { ABSOLUTE_MAX_CARDS_PER_DECK } from "./generationOptions";
import type {
  CardValidationIssue,
  DeckValidationIssue,
  GenerateStudyDeckRequest,
  GeneratedCardDraft,
  GeneratedDeckDraft,
  GenerationContext,
  GenerationStatus,
  ModelGeneratedDeckResponse,
} from "./types";

// Pure, deterministic validation of a model's raw response — this is the ONLY code path allowed
// to turn provider output into a `GeneratedDeckDraft`. Never trusts the shape of `raw`; every
// field is checked before being read. See docs/ai-generation-foundation.md's "Validation rules"
// section for the full rule list and the per-card-exclusion-vs-whole-deck-rejection design
// decision this file implements.

export const MAX_TITLE_LENGTH = 80;
export const MAX_FRONT_LENGTH = 300;
export const MAX_BACK_LENGTH = 500;

export type ValidateGeneratedDeckOutcome =
  | { status: "valid"; draft: GeneratedDeckDraft }
  | { status: "invalid"; deckIssues: DeckValidationIssue[]; cardIssues: CardValidationIssue[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Structural type-guard ONLY — confirms `raw` has the shape `ModelGeneratedDeckResponse` claims
 * (title: string, cards: array of {front: string, back: string, sourceChunkIds: string[]}).
 * Does NOT check content rules (length, emptiness, provenance existence) — those run afterward,
 * once the shape itself is known to be safe to iterate. Returns `null` (not a partial object) the
 * moment any structural expectation is violated — never a best-effort salvage of a malformed
 * shape.
 */
const KNOWN_GENERATION_STATUSES: ReadonlySet<string> = new Set<GenerationStatus>(["complete", "insufficient-distinct-content"]);

/** Accepts only a recognized status string; anything else (missing, malformed, an unrecognized
 * value) becomes `undefined` — never a structural rejection reason on its own, since this field is
 * advisory (see `GenerationStatus`'s doc comment) and an older/malformed response omitting it must
 * still be usable. */
function coerceGenerationStatus(value: unknown): GenerationStatus | undefined {
  return typeof value === "string" && KNOWN_GENERATION_STATUSES.has(value) ? (value as GenerationStatus) : undefined;
}

function coerceToModelResponse(raw: unknown): ModelGeneratedDeckResponse | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.title !== "string") return null;
  if (!Array.isArray(raw.cards)) return null;

  const cards: ModelGeneratedDeckResponse["cards"] = [];
  for (const entry of raw.cards) {
    if (!isPlainObject(entry)) return null;
    if (typeof entry.front !== "string" || typeof entry.back !== "string") return null;
    if (!Array.isArray(entry.sourceChunkIds) || !entry.sourceChunkIds.every((id) => typeof id === "string")) return null;
    cards.push({ front: entry.front, back: entry.back, sourceChunkIds: entry.sourceChunkIds });
  }
  return { title: raw.title, generationStatus: coerceGenerationStatus(raw.generationStatus), cards };
}

/**
 * The single, authoritative derivation of the final `GenerationStatus` a draft carries —
 * deliberately a pure function of the actual accepted card count vs. the tier's quality floor,
 * NEVER the model's own self-reported status. This is the fail-safe design this mission's own
 * "invalid semantics" guardrail calls for: a model claiming `"complete"` while under-delivering
 * (e.g. 7 of a 10-minimum Medium request) must not be silently trusted, and a model claiming
 * `"insufficient-distinct-content"` despite actually meeting the floor must not trigger a
 * shortfall warning the numbers themselves disprove. The model's self-report still matters as a
 * PROMPTING mechanism (see bedrockClient.mjs's buildGenerationPrompt) — it gives the model a
 * disciplined, structured way to decide to stop early — but it is never the gate for what the app
 * does afterward.
 */
export function deriveGenerationStatus(resultingCardCount: number, targetMinimumCardCount: number): GenerationStatus {
  return resultingCardCount >= targetMinimumCardCount ? "complete" : "insufficient-distinct-content";
}

// FNV-1a 32-bit — same deterministic, dependency-free approach as
// src/domain/normalization/chunking.ts's computeChunkId, reused here for consistency rather than
// shared code (these are two independent, small, pure-JS hashes with no reason to couple modules
// across the normalization/AI boundary).
export function computeCardDraftId(index: number, front: string, back: string, sourceChunkIds: string[]): string {
  const input = `${index}|${front}|${back}|${sourceChunkIds.join(",")}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `card_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

// Exported for reuse by multiBatchDedupe.ts — a cross-batch combination pass needs the EXACT same
// exact-match normalization within-batch validation already uses, rather than a second,
// independently-coded (and inevitably slightly different) duplicate definition.
export function normalizeForDuplicateCheck(front: string, back: string): string {
  const collapse = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  return `${collapse(front)}\n${collapse(back)}`;
}

/**
 * Validates a raw model response against the exact context it was generated from and returns
 * either a usable `GeneratedDeckDraft` or the deterministic list of issues that made it unusable.
 *
 * Design decision (documented, not incidental): a STRUCTURAL problem (not the right shape at
 * all, an invalid title, an empty card array, more cards than `ABSOLUTE_MAX_CARDS_PER_DECK`) is a
 * whole-deck failure — "do not silently salvage structurally unsafe responses." A problem with
 * an INDIVIDUAL otherwise-well-formed card (blank front/back, over length, no provenance, a
 * provenance id that isn't in the supplied context, or an exact duplicate of an earlier card) —
 * that one card is EXCLUDED from the draft and the issue is recorded in
 * `generation.issues`, rather than discarding an otherwise-good deck over one bad card. If
 * excluding bad cards would leave zero cards, that IS a whole-deck failure (`no-valid-cards`).
 */
export function validateGeneratedDeckResponse(
  raw: unknown,
  context: GenerationContext,
  request: GenerateStudyDeckRequest,
  providerId: string,
  now: () => string = () => new Date().toISOString()
): ValidateGeneratedDeckOutcome {
  const coerced = coerceToModelResponse(raw);
  if (!coerced) return { status: "invalid", deckIssues: [{ code: "malformed-response" }], cardIssues: [] };

  const title = coerced.title.trim();
  if (title.length === 0 || title.length > MAX_TITLE_LENGTH) {
    return { status: "invalid", deckIssues: [{ code: "invalid-title" }], cardIssues: [] };
  }

  if (coerced.cards.length > ABSOLUTE_MAX_CARDS_PER_DECK) {
    return {
      status: "invalid",
      deckIssues: [{ code: "too-many-cards", detail: `${coerced.cards.length} > ${ABSOLUTE_MAX_CARDS_PER_DECK}` }],
      cardIssues: [],
    };
  }

  // Tier-specific ceiling — distinct from, and always checked before reaching, the global
  // ABSOLUTE_MAX_CARDS_PER_DECK check above. A model badly over-producing relative to what THIS
  // request asked for (e.g. 20 cards for a Small request whose ceiling is 8) is rejected outright
  // rather than silently truncated — truncating would mean the app itself picks which cards
  // survive, an editorial decision this validator deliberately never makes.
  if (coerced.cards.length > request.requestedCardCount) {
    return {
      status: "invalid",
      deckIssues: [{ code: "exceeds-requested-max", detail: `${coerced.cards.length} > ${request.requestedCardCount}` }],
      cardIssues: [],
    };
  }

  const contextChunkIds = new Set(context.chunks.map((c) => c.id));
  const seenNormalized = new Set<string>();
  const cardIssues: CardValidationIssue[] = [];
  const acceptedCards: GeneratedCardDraft[] = [];

  coerced.cards.forEach((card, index) => {
    const front = card.front.trim();
    const back = card.back.trim();

    if (front.length === 0) return cardIssues.push({ cardIndex: index, code: "empty-front" });
    if (back.length === 0) return cardIssues.push({ cardIndex: index, code: "empty-back" });
    if (front.length > MAX_FRONT_LENGTH) return cardIssues.push({ cardIndex: index, code: "front-too-long" });
    if (back.length > MAX_BACK_LENGTH) return cardIssues.push({ cardIndex: index, code: "back-too-long" });
    if (card.sourceChunkIds.length === 0) return cardIssues.push({ cardIndex: index, code: "missing-provenance" });
    if (!card.sourceChunkIds.every((id) => contextChunkIds.has(id))) {
      return cardIssues.push({ cardIndex: index, code: "unknown-chunk-id" });
    }

    const dupKey = normalizeForDuplicateCheck(front, back);
    if (seenNormalized.has(dupKey)) return cardIssues.push({ cardIndex: index, code: "duplicate-card" });
    seenNormalized.add(dupKey);

    // A card's own sourceChunkIds can arrive with repeats (e.g. ["c1", "c1"]) — dedupe rather
    // than reject, so provenance stored on the draft is always canonical.
    const canonicalSourceChunkIds = Array.from(new Set(card.sourceChunkIds));

    acceptedCards.push({
      id: computeCardDraftId(index, front, back, canonicalSourceChunkIds),
      front,
      back,
      sourceChunkIds: canonicalSourceChunkIds,
    });
  });

  if (acceptedCards.length === 0) {
    return { status: "invalid", deckIssues: [{ code: "no-valid-cards" }], cardIssues };
  }

  const draft: GeneratedDeckDraft = {
    title,
    cards: acceptedCards,
    sourceId: request.sourceId,
    generation: {
      generationContractVersion: request.generationContractVersion,
      normalizationVersion: request.normalizationVersion,
      sourceId: request.sourceId,
      selectedChunkIds: request.selectedChunkIds,
      requestedCardCount: request.requestedCardCount,
      targetMinimumCardCount: request.targetMinimumCardCount,
      resultingCardCount: acceptedCards.length,
      generationStatus: deriveGenerationStatus(acceptedCards.length, request.targetMinimumCardCount),
      generatedAt: now(),
      providerId,
      fullSourceIncluded: context.fullSourceIncluded,
      excludedChunkCount: context.excludedChunkCount,
      issues: cardIssues,
    },
  };

  return { status: "valid", draft };
}
