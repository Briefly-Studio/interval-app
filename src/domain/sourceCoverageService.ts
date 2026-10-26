import type { LibrarySourceRecord } from "../models/librarySource";
import { getDecksAll } from "../storage/decks";
import { sourceCoverageWithLiveRecords } from "./sourceCoverageLiveness";
import { getCardsAll } from "../storage/cards";
import { getProvenanceForSource } from "../storage/generatedCardProvenance";
import type { WorkspaceScope } from "../storage/workspaceScope";
import { normalizeSource } from "./normalization/normalizeSource";
import { computeSourceCoverage, type SourceCoverage } from "./sourceCoverage";

// The async orchestration half of Source Coverage — see src/domain/sourceCoverage.ts's header
// comment for why this is a separate file (that one is pure/RN-import-free and directly unit
// tested; the actual service and sync loop are exercised with mocked native boundaries in
// generatedCardProvenanceSync.test.ts. Device/normalization QA remains necessary).

/**
 * The one async entry point a screen calls. Re-normalizes the source fresh (see
 * normalizeSource.ts's own "always computed on demand, no cache" contract — deliberately not
 * duplicated here; see docs/source-coverage.md's "Performance" section for why that's acceptable)
 * to get the CURRENT chunk set, loads this source's provenance entries, resolves exactly the
 * decks those entries point at first (with a once-per-query recovery-deck fallback) to determine
 * which referenced cards and parent decks are still live, then reduces to a SourceCoverage.
 * Never throws for a normal "no content"/"no cards" outcome — those are just zero-valued results, not errors.
 */
export async function loadSourceCoverage(scope: WorkspaceScope, source: LibrarySourceRecord): Promise<SourceCoverage> {
  const [normalized, provenance] = await Promise.all([normalizeSource(source), getProvenanceForSource(scope, source.id)]);
  const chunkIds = normalized.content.chunks.map((chunk) => chunk.id);

  if (provenance.length === 0) {
    return computeSourceCoverage(chunkIds, []);
  }

  const decks = await getDecksAll(scope);
  const referenced = new Set(provenance.map((entry) => entry.deckId));
  const relevant = decks.filter((deck) => referenced.has(deck.id));
  const cards = (await Promise.all(relevant.map((deck) => getCardsAll(scope, deck.id)))).flat();
  // A restore may move a card to a recovery deck. Search other decks ONCE only when a cited
  // card is missing/inactive at its original location; never scan all records per card.
  const liveDeckIds = new Set(decks.filter((deck) => !deck.deletedAt).map((deck) => deck.id));
  const liveAtOriginal = new Set(cards.filter((card) => !card.deletedAt && liveDeckIds.has(card.deckId)).map((card) => card.id));
  if (provenance.some((entry) => !liveAtOriginal.has(entry.cardId))) {
    cards.push(...(await Promise.all(decks.filter((deck) => !referenced.has(deck.id)).map((deck) => getCardsAll(scope, deck.id)))).flat());
  }
  return sourceCoverageWithLiveRecords(chunkIds, provenance, decks, cards);
}
