import { getEnvironmentConfig } from "../../config/environment";

// Centralized rollout gate for ReviewEvent cloud sync — mirrors
// libraryMetadataSyncCapability.ts's exact shape/rationale. ReviewEvent is the only entity this
// gate covers; CardSchedulingState is never synced at all (see
// docs/spaced-repetition-foundation.md's "Sync considerations" section for why) so it needs no
// capability gate of its own.
//
// This is a TEMPORARY rollout restriction, not a permanent architectural boundary — the backend
// sync Lambdas are already fully entity-agnostic (no change was needed there to support this
// entity at all), so widening this to Production later is a deliberate, founder-approved change
// to this array, not a rewrite of the feature.
//
// This is intentionally the ONE place this decision is made. The only call sites are
// SyncService.ts's `collectDirty` (so a Production-pointed build can never even collect, let
// alone push, review events) and `applyChanges` (so a review event that somehow arrives in a pull
// response while disabled is silently ignored rather than applied). Do not add additional
// scattered `INTERVAL_ENV` checks elsewhere for this feature — route any new call site through
// this function instead.
const ALLOWED_ENVIRONMENTS: readonly string[] = ["development", "staging"];

/**
 * Whether ReviewEvent cloud sync is enabled for the current environment. Fails closed (returns
 * false) if environment config can't be read at all, e.g. a guest who has never configured
 * `INTERVAL_ENV` — review event sync is opt-in on top of an already-working offline-first
 * spaced-repetition system, never a hard requirement (Requirement 8: studying must work fully
 * offline regardless of this gate's value).
 */
export function isReviewEventSyncEnabled(): boolean {
  try {
    const { environment } = getEnvironmentConfig();
    return ALLOWED_ENVIRONMENTS.includes(environment);
  } catch {
    return false;
  }
}
