import { collapseGeneratedCardProvenance, mergeGeneratedCardProvenance } from "../cloud/sync/generatedCardProvenanceMerge";
import { isProvenanceTimestamp, parseGeneratedCardProvenanceRecord, upgradeGeneratedCardProvenance,
  type GeneratedCardProvenance, type GeneratedCardProvenanceRecord as Provenance } from "../models/generatedCardProvenance";
import { generatedCardProvenanceKey } from "./generatedCardProvenanceKeys";
import type { WorkspaceScope } from "./workspaceScope";

type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<unknown> };

/** One serialized read/modify/write transaction per scoped array. Reads/migration, local saves,
 * pulls and acknowledgements share the same queue: no concurrent array replacement can erase a
 * newly saved card's provenance. Storage failures propagate; they must never become empty data
 * that a later sync silently overwrites. The generation save caller remains best-effort. */
export function createGeneratedCardProvenanceStore(storage: Storage) {
  const pending = new Map<string, Promise<unknown>>();
  function transaction<T>(scope: WorkspaceScope, action: (records: Provenance[]) => Promise<T>): Promise<T> {
    const key = generatedCardProvenanceKey(scope);
    const task = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const raw = await storage.getItem(key);
      let parsed: unknown = [];
      try { parsed = raw ? JSON.parse(raw) : []; } catch { throw new Error("provenance-invalid-local-json"); }
      if (!Array.isArray(parsed)) throw new Error("provenance-invalid-local-list");
      const records = collapseGeneratedCardProvenance(parsed.map(upgradeGeneratedCardProvenance).filter((r): r is Provenance => r !== null));
      const canonical = JSON.stringify(records);
      if (raw !== null && raw !== canonical) await storage.setItem(key, canonical);
      return action(records);
    });
    pending.set(key, task);
    void task.finally(() => { if (pending.get(key) === task) pending.delete(key); }).catch(() => {});
    return task;
  }
  const persist = (scope: WorkspaceScope, records: Provenance[]) => storage.setItem(generatedCardProvenanceKey(scope), JSON.stringify(records));
  return {
    get: (scope: WorkspaceScope) => transaction(scope, async (records) => records),
    forSource: (scope: WorkspaceScope, sourceId: string) => transaction(scope, async (records) => records.filter((r) => r.sourceId === sourceId && !r.deletedAt)),
    byCard: (scope: WorkspaceScope, cardId: string) => transaction(scope, async (records) => records.find((r) => r.cardId === cardId)),
    record: (scope: WorkspaceScope, entries: GeneratedCardProvenance[]) => transaction(scope, async (records) => {
      if (!entries.length) return;
      const byId = new Map(records.map((r) => [r.id, r]));
      for (const entry of entries) {
        const next = upgradeGeneratedCardProvenance(entry);
        if (!next) throw new Error("provenance-invalid-local-entry");
        const current = byId.get(next.id);
        const merged = mergeGeneratedCardProvenance(current, next).record!;
        byId.set(next.id, current ? merged : { ...next, dirty: true });
      }
      await persist(scope, Array.from(byId.values()));
    }),
    apply: (scope: WorkspaceScope, incoming: Provenance[], syncedAt: string) => transaction(scope, async (records) => {
      const byId = new Map(records.map((r) => [r.id, r]));
      for (const raw of incoming) {
        const record = parseGeneratedCardProvenanceRecord(raw);
        if (!record) throw new Error("provenance-invalid-remote-entry");
        const merged = mergeGeneratedCardProvenance(byId.get(record.id), record).record!;
        byId.set(record.id, merged.dirty ? merged : { ...merged, lastSyncedAt: syncedAt });
      }
      await persist(scope, Array.from(byId.values()));
    }),
    markClean: (scope: WorkspaceScope, revisions: ReadonlyMap<string, number>, syncedAt: string) => transaction(scope, async (records) => {
      await persist(scope, records.map((r) => revisions.get(r.id) === r.rev ? { ...r, dirty: false, lastSyncedAt: syncedAt } : r));
    }),
    // Explicit provenance withdrawal/restore only. Ordinary card/deck soft deletion needs no
    // sidecar writes: synced card/deck truth makes retained provenance inactive for coverage.
    setDeleted: (scope: WorkspaceScope, cardId: string, deleted: boolean, now: string) => transaction(scope, async (records) => {
      if (!isProvenanceTimestamp(now)) throw new Error("provenance-invalid-local-timestamp");
      const updated = records.map((r) => {
        if (r.cardId !== cardId || !!r.deletedAt === deleted) return r;
        if (r.rev >= Number.MAX_SAFE_INTEGER) throw new Error("provenance-revision-exhausted");
        const updatedAt = now > r.updatedAt ? now : new Date(Date.parse(r.updatedAt) + 1).toISOString();
        if (!isProvenanceTimestamp(updatedAt)) throw new Error("provenance-timestamp-exhausted");
        const { deletedAt: _deletedAt, lastSyncedAt: _lastSyncedAt, ...rest } = r;
        return { ...rest, rev: r.rev + 1, updatedAt, dirty: true, ...(deleted ? { deletedAt: updatedAt } : {}) };
      });
      await persist(scope, updated);
    }),
  };
}
