import type { LibrarySourceRecord } from "../models/librarySource";
import { getCardsAll } from "../storage/cards";
import { getProvenanceForSource } from "../storage/generatedCardProvenance";
import type { WorkspaceScope } from "../storage/workspaceScope";
import { normalizeSource } from "./normalization/normalizeSource";
import { computeSourceCoverage, deriveCoveredChunkIds, type SourceCoverage } from "./sourceCoverage";

// The async orchestration half of Source Coverage — see src/domain/sourceCoverage.ts's header
// comment for why this is a separate file (that one is pure/RN-import-free and directly unit
// tested; this one needs real storage + normalization and is exercised only via screen-level
// founder QA, same posture as e.g. src/domain/ai/generateDeckFlow.ts).

/**
 * The one async entry point a screen calls. Re-normalizes the source fresh (see
 * normalizeSource.ts's own "always computed on demand, no cache" contract — deliberately not
 * duplicated here; see docs/source-coverage.md's "Performance" section for why that's acceptable)
 * to get the CURRENT chunk set, loads this source's provenance entries, resolves exactly the
 * decks those entries point at (never every deck in the workspace) to determine which referenced
 * cards are still live, then reduces to a SourceCoverage. Never throws for a normal "no content"/
 * "no cards" outcome — those are just zero-valued results, not errors.
 */
export async function loadSourceCoverage(scope: WorkspaceScope, source: LibrarySourceRecord): Promise<SourceCoverage> {
  const [normalized, provenance] = await Promise.all([normalizeSource(source), getProvenanceForSource(scope, source.id)]);
  const chunkIds = normalized.content.chunks.map((chunk) => chunk.id);

  if (provenance.length === 0) {
    return computeSourceCoverage(chunkIds, []);
  }

  const deckIds = Array.from(new Set(provenance.map((entry) => entry.deckId)));
  const cardsByDeck = await Promise.all(deckIds.map((deckId) => getCardsAll(scope, deckId)));

  const liveCardIds = new Set<string>();
  for (const deckCards of cardsByDeck) {
    for (const card of deckCards) {
      if (!card.deletedAt) liveCardIds.add(card.id);
    }
  }

  const coveredChunkIds = deriveCoveredChunkIds(provenance, liveCardIds);
  return computeSourceCoverage(chunkIds, coveredChunkIds);
}
