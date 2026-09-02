import { getEnvironmentConfig } from "../../config/environment";

// Centralized rollout gate for the user-facing "Generate Study Deck" UX shell (the Source →
// Generate → Review → Edit → Save workflow in app/library/[id]/generate/**).
//
// Deliberately mirrors src/cloud/sync/libraryMetadataSyncCapability.ts and
// src/cloud/librarySourceStorage/capability.ts — same "development"/"staging" allow-list, same
// fail-closed behavior — but is its OWN capability, not merged with either of those. Generation
// is an independent surface: it currently runs entirely on the deterministic local mock provider
// (src/domain/ai/mockProvider.ts) with no network and no AWS, and a future production provider is
// its own separate, founder-approved change. Widening this array to "production" must be a
// deliberate decision made here, alongside real provider wiring — never a side effect of enabling
// some other capability.
//
// The only call sites are meant to be the Library Source Detail entry point
// (app/library/[id]/index.tsx) and the generate screens' own route guard — route any new call
// site through this function rather than adding a scattered INTERVAL_ENV check.
const ALLOWED_ENVIRONMENTS: readonly string[] = ["development", "staging"];

/**
 * Whether the Generate Study Deck UX shell is exposed in the current environment. Fails closed
 * (returns false) if environment config can't be read at all, e.g. a guest in a build with no
 * INTERVAL_ENV configured — generation is an enhancement layered on top of the offline-first
 * Library, never a hard requirement, and a Production build must never surface the mock-backed
 * shell.
 */
export function isGenerateStudyDeckEnabled(): boolean {
  try {
    const { environment } = getEnvironmentConfig();
    return ALLOWED_ENVIRONMENTS.includes(environment);
  } catch {
    return false;
  }
}
