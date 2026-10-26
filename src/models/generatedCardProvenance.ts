// Separate metadata entity: never source text, card content, prompts, filenames, or a field on
// CardRecord/DeckRecord. id === cardId. See docs/sync-generated-card-provenance.md.
export type GeneratedCardProvenance = {
  cardId: string;
  /** Original saved deck; a lookup hint. Card restore can move the card to a recovery deck. */
  deckId: string;
  sourceId: string;
  sourceChunkIds: string[];
  generatedAt: string;
  normalizationVersion?: number;
  deletedAt?: string;
};

export type GeneratedCardProvenanceRecord = GeneratedCardProvenance & {
  id: string;
  rev: number;
  updatedAt: string;
  dirty: boolean;
  lastSyncedAt?: string;
};

// At most the normalizer's 5,000 chunks can contribute to one source. ASCII identifiers of at
// most 64 bytes keep even the maximum array comfortably below DynamoDB's 400 KiB item ceiling.
export const MAX_PROVENANCE_CHUNK_IDS = 5000;
export const MAX_PROVENANCE_CHUNK_ID_LENGTH = 64;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const CHUNK_ID = /^[A-Za-z0-9_-]{1,64}$/;
const FIELDS = new Set(["id", "cardId", "deckId", "sourceId", "sourceChunkIds", "generatedAt",
  "normalizationVersion", "rev", "updatedAt", "dirty", "deletedAt", "lastSyncedAt"]);

export function isProvenanceTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

/** Strict remote shape; drops no malformed fields and accepts no arbitrary content fields.
 * Returns only whitelisted metadata, with canonical sorted/deduplicated chunk ids. */
export function parseGeneratedCardProvenanceRecord(raw: unknown): GeneratedCardProvenanceRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some((key) => !FIELDS.has(key))) return null;
  for (const field of ["id", "cardId", "deckId", "sourceId"] as const) {
    if (typeof r[field] !== "string" || !ID.test(r[field])) return null;
  }
  if (r.id !== r.cardId || !Number.isSafeInteger(r.rev) || (r.rev as number) < 1) return null;
  if (!isProvenanceTimestamp(r.generatedAt) || !isProvenanceTimestamp(r.updatedAt)) return null;
  if (r.deletedAt !== undefined && (!isProvenanceTimestamp(r.deletedAt) || r.deletedAt > r.updatedAt)) return null;
  if (r.lastSyncedAt !== undefined && !isProvenanceTimestamp(r.lastSyncedAt)) return null;
  if (r.dirty !== undefined && typeof r.dirty !== "boolean") return null;
  if (r.normalizationVersion !== undefined && (!Number.isSafeInteger(r.normalizationVersion) || (r.normalizationVersion as number) < 1)) return null;
  if (!Array.isArray(r.sourceChunkIds) || r.sourceChunkIds.length === 0 || r.sourceChunkIds.length > MAX_PROVENANCE_CHUNK_IDS) return null;
  if (!r.sourceChunkIds.every((id) => typeof id === "string" && CHUNK_ID.test(id))) return null;
  return {
    id: r.id as string, cardId: r.cardId as string, deckId: r.deckId as string, sourceId: r.sourceId as string,
    sourceChunkIds: [...new Set(r.sourceChunkIds as string[])].sort(), generatedAt: r.generatedAt,
    rev: r.rev as number, updatedAt: r.updatedAt, dirty: r.dirty === true,
    ...(r.normalizationVersion !== undefined ? { normalizationVersion: r.normalizationVersion as number } : {}),
    ...(r.deletedAt !== undefined ? { deletedAt: r.deletedAt as string } : {}),
    ...(r.lastSyncedAt !== undefined ? { lastSyncedAt: r.lastSyncedAt as string } : {}),
  };
}

/** Legacy local records lack sync metadata. Preserve trustworthy fields, initialize rev 1,
 * dirty true, and use generatedAt as updatedAt: migration is deterministic and idempotent.
 * No normalization version is guessed from a hash. Native storage persists this lazily. */
export function upgradeGeneratedCardProvenance(raw: unknown): GeneratedCardProvenanceRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if ("rev" in r || "id" in r || "updatedAt" in r || "dirty" in r || "deletedAt" in r) return parseGeneratedCardProvenanceRecord(raw);
  if (!Array.isArray(r.sourceChunkIds) || r.sourceChunkIds.length > MAX_PROVENANCE_CHUNK_IDS) return null;
  const sourceChunkIds = [...new Set(r.sourceChunkIds.filter((id): id is string => typeof id === "string" && CHUNK_ID.test(id)))].sort();
  return parseGeneratedCardProvenanceRecord({
    id: r.cardId, cardId: r.cardId, deckId: r.deckId, sourceId: r.sourceId, sourceChunkIds,
    generatedAt: r.generatedAt, updatedAt: r.generatedAt, rev: 1, dirty: true,
    ...(r.normalizationVersion !== undefined ? { normalizationVersion: r.normalizationVersion } : {}),
  });
}
