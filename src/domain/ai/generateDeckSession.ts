import { useSyncExternalStore } from "react";

import type { WorkspaceScope } from "../../storage/workspaceScope";
import type { ChunkProvenance } from "../normalization/types";
import type { GeneratedDeckDraft, GenerationOptions } from "./types";

// In-memory, single-slot holder for the ONE Generate Study Deck draft the user is currently
// reviewing. Deliberately NOT persisted anywhere — no AsyncStorage key, no file, nothing synced.
// A generated draft only becomes durable when the user explicitly taps Save (see
// generateDeckSave.ts), which creates a real DeckRecord/CardRecord[] through the existing
// storage APIs. If the app is killed mid-review the draft is simply gone — that is the intended
// behavior for un-accepted AI output, not a bug.
//
// Lives at module scope with a useSyncExternalStore subscription (same pattern as
// src/theme/index.ts) so the generating screen can populate it and the review/edit screens can
// read and mutate it across navigations without threading a large, non-serializable object
// through expo-router params.

export type DraftCard = {
  /** Stable within this session — the GeneratedCardDraft id from validation, or a locally
   * minted id for a card the user edited (edits change content, so the content-addressed id
   * would otherwise churn). Only used as a React key and an edit/delete target. */
  id: string;
  front: string;
  back: string;
  /** Carried straight through from generation — never user-editable (see the mission's
   * "Do not allow editing provenance manually"). Used only to look up `provenanceByChunkId`. */
  sourceChunkIds: string[];
};

export type DraftProvenanceEntry = Pick<ChunkProvenance, "lineRange" | "page" | "heading">;

export type GenerateDeckSession = {
  sourceId: string;
  /** The workspace/account scope the source was read from AND the draft was generated in,
   * captured once at generation time. Save uses THIS scope — never a scope re-resolved at save
   * time — so a draft can never land in a different workspace if the active scope changed while
   * the user was reviewing (audit CRITICAL-1). The review screen compares the current active
   * scope against this and blocks save on a mismatch. */
  sourceScope: WorkspaceScope;
  sourceTitle: string;
  /** Editable before save; seeded from the generated draft title. */
  deckTitle: string;
  cards: DraftCard[];
  /** chunk id → the real provenance the normalization layer produced for it. Only populated for
   * chunks that actually carry location data (TXT always has `lineRange`); a future page-aware
   * PDF adapter would populate `page` here with no change to this shape. */
  provenanceByChunkId: Record<string, DraftProvenanceEntry>;
  options: GenerationOptions;
  providerId: string;
  requestedCardCount: number;
  fullSourceIncluded: boolean;
  /** Set once the user changes the title or any card, or deletes a card — drives the
   * discard-confirmation prompt so an untouched draft can be abandoned without a nag. */
  edited: boolean;
};

type StartSessionInput = {
  sourceId: string;
  sourceScope: WorkspaceScope;
  sourceTitle: string;
  draft: GeneratedDeckDraft;
  provenanceByChunkId: Record<string, DraftProvenanceEntry>;
  options: GenerationOptions;
};

let session: GenerateDeckSession | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): GenerateDeckSession | null {
  return session;
}

export function startGenerateDeckSession(input: StartSessionInput): void {
  session = {
    sourceId: input.sourceId,
    sourceScope: input.sourceScope,
    sourceTitle: input.sourceTitle,
    deckTitle: input.draft.title,
    cards: input.draft.cards.map((card) => ({
      id: card.id,
      front: card.front,
      back: card.back,
      sourceChunkIds: card.sourceChunkIds,
    })),
    provenanceByChunkId: input.provenanceByChunkId,
    options: input.options,
    providerId: input.draft.generation.providerId,
    requestedCardCount: input.draft.generation.requestedCardCount,
    fullSourceIncluded: input.draft.generation.fullSourceIncluded,
    edited: false,
  };
  emit();
}

export function clearGenerateDeckSession(): void {
  if (session === null) return;
  session = null;
  emit();
}

export function getGenerateDeckSession(): GenerateDeckSession | null {
  return session;
}

export function setDraftDeckTitle(title: string): void {
  if (!session) return;
  if (session.deckTitle === title) return;
  session = { ...session, deckTitle: title, edited: true };
  emit();
}

export function updateDraftCard(id: string, fields: { front: string; back: string }): void {
  if (!session) return;
  let changed = false;
  const cards = session.cards.map((card) => {
    if (card.id !== id) return card;
    if (card.front === fields.front && card.back === fields.back) return card;
    changed = true;
    return { ...card, front: fields.front, back: fields.back };
  });
  if (!changed) return;
  session = { ...session, cards, edited: true };
  emit();
}

export function deleteDraftCard(id: string): void {
  if (!session) return;
  const cards = session.cards.filter((card) => card.id !== id);
  if (cards.length === session.cards.length) return;
  session = { ...session, cards, edited: true };
  emit();
}

export function useGenerateDeckSession(): GenerateDeckSession | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
