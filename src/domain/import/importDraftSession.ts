import { useSyncExternalStore } from "react";

import type { WorkspaceScope } from "../../storage/workspaceScope";
import type { ImportedCardDraft, ImportedDeckDraft, ImportWarning } from "./types";

// In-memory, single-slot holder for the ONE import draft currently being previewed — mirrors
// generateDeckSession.ts's exact pattern and rationale. Deliberately NOT persisted anywhere: if
// the app is killed mid-preview the draft is simply gone (nothing was ever written), which is the
// intended behavior for an unconfirmed import, not a bug. A draft only becomes durable once the
// user explicitly taps the preview screen's confirm action (see importDeckSave.ts).

export type ImportDraftSession = {
  /** The workspace/account scope active when the file was parsed. The preview screen re-checks
   * this against the current active scope before saving (same CRITICAL-1-style guard
   * generateDeckSession's review screen already uses) so a workspace switch mid-preview can
   * never land the import in the wrong account. */
  sourceScope: WorkspaceScope;
  originalFileName?: string;
  /** Editable before save, seeded from the parser's derived name. */
  deckName: string;
  cards: ImportedCardDraft[];
  warnings: ImportWarning[];
};

let currentSession: ImportDraftSession | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function setImportDraftSession(scope: WorkspaceScope, draft: ImportedDeckDraft): void {
  currentSession = {
    sourceScope: scope,
    originalFileName: draft.metadata?.originalFileName,
    deckName: draft.name,
    cards: draft.cards,
    warnings: draft.warnings,
  };
  emit();
}

export function setImportDraftDeckName(name: string): void {
  if (!currentSession) return;
  currentSession = { ...currentSession, deckName: name };
  emit();
}

export function deleteImportDraftCard(index: number): void {
  if (!currentSession) return;
  currentSession = { ...currentSession, cards: currentSession.cards.filter((_, i) => i !== index) };
  emit();
}

export function clearImportDraftSession(): void {
  currentSession = null;
  emit();
}

function getSnapshot(): ImportDraftSession | null {
  return currentSession;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useImportDraftSession(): ImportDraftSession | null {
  return useSyncExternalStore(subscribe, getSnapshot);
}
