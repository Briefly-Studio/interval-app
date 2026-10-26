import { MAX_PROVENANCE_CHUNK_IDS, type GeneratedCardProvenanceRecord as Provenance } from "../../models/generatedCardProvenance";

// Canonical payload excludes replica-local dirty/lastSyncedAt and mutable revision envelope.
export function provenancePayload(record: Provenance): string {
  return JSON.stringify([record.id, record.cardId, record.deckId, record.sourceId,
    record.generatedAt, record.normalizationVersion ?? null, record.deletedAt ?? null, [...record.sourceChunkIds].sort()]);
}

function compare(a: Provenance, b: Provenance): number {
  if (a.rev !== b.rev) return a.rev > b.rev ? 1 : -1;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? 1 : -1;
  if (!!a.deletedAt !== !!b.deletedAt) return a.deletedAt ? 1 : -1;
  const left = provenancePayload(a), right = provenancePayload(b);
  return left === right ? 0 : left > right ? 1 : -1;
}

export type ProvenanceMergeResult = {
  record: Provenance | undefined;
  conflict?: "compatible-union" | "identity-conflict" | "chunk-limit" | "lifecycle-conflict";
};

/** Rev first for lifecycle/identity; active metadata with the same source/deck/version can
 * union even across revisions (a lower revision may contain a previously unseen valid chunk).
 * A genuinely new union, or differing equal-revision payloads, create max(rev)+1 dirty repair.
 * That repair must be pushed again through the generic backend: merging only in memory would
 * never converge its last-writer-wins snapshot. Replayed subsets create no repair loop.
 * Tombstones never union; an older active record cannot resurrect one. */
export function mergeGeneratedCardProvenance(local: Provenance | undefined, incoming: Provenance | undefined): ProvenanceMergeResult {
  if (!incoming) return { record: local };
  if (!local) return { record: { ...incoming, dirty: false } };
  if (local.id !== incoming.id) throw new Error("provenance-identity-mismatch");
  const winner = compare(local, incoming) >= 0 ? local : incoming;
  const cleanWinner = winner === local ? local : { ...incoming, dirty: false };
  const different = provenancePayload(local) !== provenancePayload(incoming);
  if (!different) return { record: cleanWinner };
  let resolved = winner;
  let conflict: ProvenanceMergeResult["conflict"];
  const compatible = local.sourceId === incoming.sourceId && local.deckId === incoming.deckId
    && local.normalizationVersion === incoming.normalizationVersion;
  if (!local.deletedAt && !incoming.deletedAt && compatible) {
    const ids = [...new Set([...local.sourceChunkIds, ...incoming.sourceChunkIds])].sort();
    if (ids.length <= MAX_PROVENANCE_CHUNK_IDS) {
      resolved = { ...winner, sourceChunkIds: ids, generatedAt: local.generatedAt < incoming.generatedAt ? local.generatedAt : incoming.generatedAt };
      conflict = "compatible-union";
    } else conflict = "chunk-limit";
  } else conflict = local.deletedAt || incoming.deletedAt ? "lifecycle-conflict" : "identity-conflict";

  if (provenancePayload(resolved) !== provenancePayload(winner) || local.rev === incoming.rev) {
    const rev = Math.max(local.rev, incoming.rev) + 1;
    const time = Math.max(Date.parse(local.updatedAt), Date.parse(incoming.updatedAt)) + 1;
    if (!Number.isSafeInteger(rev) || time > Date.parse("9999-12-31T23:59:59.999Z")) throw new Error("provenance-revision-exhausted");
    const { lastSyncedAt: _lastSyncedAt, ...record } = resolved;
    return { record: { ...record, rev, updatedAt: new Date(time).toISOString(), dirty: true }, conflict };
  }
  return { record: cleanWinner, conflict };
}

/** Duplicate legacy array entries are possible. Collapse deterministically by card identity;
 * same-source unions follow the same bounded rule, never union across different sources. */
export function collapseGeneratedCardProvenance(records: Provenance[]): Provenance[] {
  const byId = new Map<string, Provenance>();
  const ordered = [...records].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : compare(a, b));
  for (const record of ordered) {
    const local = byId.get(record.id);
    if (!local) { byId.set(record.id, record); continue; }
    const merged = mergeGeneratedCardProvenance(local, record).record!;
    byId.set(record.id, { ...merged, dirty: merged.dirty || local.dirty || record.dirty });
  }
  return Array.from(byId.values());
}
