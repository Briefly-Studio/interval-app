// Pure, dependency-free push helpers shared by SyncService (the client) and exercised directly
// by `npm run test:sync`. Kept as `.mjs` (not `.ts`) precisely so the framework-free
// `node --test` runner can import it with no TypeScript loader — SyncService imports it with an
// explicit `./pushHelpers.mjs` specifier, which `moduleResolution: "bundler"` + `allowJs`
// resolve and type-check fine.
//
// This file imports nothing (no React Native, no AWS SDK) — it must stay that way so both sides
// can use it.

// Maximum number of changes the client puts in ONE push request. It MUST stay <=
// backend/lambdas/sync-push/lib.mjs's `MAX_CHANGES_PER_PUSH` (the server rejects anything larger
// with a deterministic 413). A parity test in backend/lambdas/sync-push/lib.test.mjs imports
// both constants and asserts this relationship, so the two cannot silently drift.
export const PUSH_BATCH_SIZE = 500;

/**
 * Partition a list of pending changes into ordered, contiguous batches of at most `size`
 * (default `PUSH_BATCH_SIZE`). Never reorders, never drops, never merges across the boundary.
 * `0` changes → `[]` (the caller skips the push entirely). A non-positive/non-finite `size`
 * falls back to `PUSH_BATCH_SIZE`.
 */
export function partitionPushChanges(changes, size = PUSH_BATCH_SIZE) {
  if (!Array.isArray(changes) || changes.length === 0) return [];
  const cap = Number.isFinite(size) && size > 0 ? Math.floor(size) : PUSH_BATCH_SIZE;
  const out = [];
  for (let i = 0; i < changes.length; i += cap) out.push(changes.slice(i, i + cap));
  return out;
}

/**
 * Normalize a push-response ack list (`accepted` or `rejected`) into an entity-scoped lookup.
 *
 * The canonical wire shape is `[{ entity, id }]` (rejected items may also carry `reason`, which
 * is ignored here). A response element that is not a well-formed `{ entity, id }` object is
 * DROPPED — there is deliberately no legacy `string[]` fallback: an id alone cannot be attributed
 * to an entity, and matching it against every entity is exactly the cross-entity ambiguity this
 * shape exists to remove (audit finding 2). The client and backend are packaged from the same
 * commit and deploy together, so a bare-string response only appears against a stale backend —
 * in which case dropping it is safe (nothing is falsely marked clean; records stay dirty and
 * retry once the backend is updated).
 *
 * Returns `Map<entity, Set<id>>`.
 */
export function parseAckList(raw) {
  const byEntity = new Map();
  if (!Array.isArray(raw)) return byEntity;
  for (const item of raw) {
    if (
      item &&
      typeof item === "object" &&
      typeof item.entity === "string" &&
      item.entity.length > 0 &&
      typeof item.id === "string" &&
      item.id.length > 0
    ) {
      let set = byEntity.get(item.entity);
      if (!set) {
        set = new Set();
        byEntity.set(item.entity, set);
      }
      set.add(item.id);
    }
  }
  return byEntity;
}

/** True if `(entity, id)` appears in a `parseAckList` result. */
export function isAcked(byEntity, entity, id) {
  const set = byEntity.get(entity);
  return set ? set.has(id) : false;
}

/** Total number of `(entity, id)` pairs in a `parseAckList` result. */
export function ackCount(byEntity) {
  let n = 0;
  for (const set of byEntity.values()) n += set.size;
  return n;
}

/**
 * Run `sendAndApply(batch)` for each batch, STRICTLY SEQUENTIALLY — the next batch is not started
 * until the current one's callback has fully resolved.
 *
 * - The callback throwing (an HTTP/network failure inside it) stops the loop immediately: no
 *   further batch is sent, and the error propagates to the caller. Batches already completed
 *   stay completed.
 * - The callback returning the string `"abort"` stops the loop cleanly (no error) — used for the
 *   "active workspace changed mid-push" case, where the run should quietly stop without being
 *   reported as a failure.
 *
 * Returns `{ completed, aborted }`. Deliberately has no knowledge of storage, network, scope, or
 * acknowledgement shapes — the caller injects all of that via `sendAndApply` — so this control
 * flow is unit-testable on its own.
 */
export async function pushBatchesSequentially(batches, sendAndApply) {
  let completed = 0;
  for (const batch of batches) {
    const outcome = await sendAndApply(batch);
    if (outcome === "abort") return { completed, aborted: true };
    completed += 1;
  }
  return { completed, aborted: false };
}
