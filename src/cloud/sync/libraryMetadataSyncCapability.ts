import { getEnvironmentConfig } from "../../config/environment";

// Centralized rollout gate for Library metadata cloud sync (librarySource / sourceCollection
// entities only — never source binaries/content, see docs/library-cloud-sync-contract.md).
//
// This is a TEMPORARY rollout restriction, not a permanent architectural boundary. Today it only
// allows `development`, matching this batch's explicit "Development-only for this mission"
// constraint. Enabling Staging and, eventually, Production is expected to happen later as a
// deliberate, founder-approved change to this array — not a rewrite of the feature.
//
// This is intentionally the ONE place this decision is made. The only call sites are
// SyncService.ts's `collectDirty` (so a Staging/Production-pointed build can never even collect,
// let alone push, Library metadata) and `applyChanges` (so any Library change that somehow
// arrives in a pull response while disabled is silently ignored rather than surfaced as a
// warning). Do not add additional scattered `INTERVAL_ENV` checks elsewhere for this feature —
// route any new call site through this function instead.
const ALLOWED_ENVIRONMENTS: readonly string[] = ["development"];

/**
 * Whether Library metadata (librarySource / sourceCollection) cloud sync is enabled for the
 * current environment. Fails closed (returns false) if environment config can't be read at all,
 * e.g. a guest who has never configured `INTERVAL_ENV` — Library metadata sync is opt-in on top
 * of an already-working offline-first Library, never a hard requirement.
 */
export function isLibraryMetadataCloudSyncEnabled(): boolean {
  try {
    const { environment } = getEnvironmentConfig();
    return ALLOWED_ENVIRONMENTS.includes(environment);
  } catch {
    return false;
  }
}
