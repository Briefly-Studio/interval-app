import { getEnvironmentConfig } from "./environment";

// Centralized gate for founder/developer-only tooling — the app/dev-tools.tsx and app/theme-lab.tsx
// screens, their entry points (app/index.tsx's hidden wordmark long-press + gear icon), and the
// dev-only Library fixture actions Dev Tools triggers (src/domain/librarySeed.ts). Mirrors the
// fail-closed pattern already used by src/domain/ai/generateStudyDeckCapability.ts and
// src/cloud/sync/libraryMetadataSyncCapability.ts — same shape, an independent gate (developer
// tooling visibility is not a rollout capability like those two; it never becomes true in
// Staging or Production).
//
// Deliberately keyed to INTERVAL_ENV via getEnvironmentConfig(), never to `__DEV__` (whether the
// current JS bundle was built in Metro/development mode vs a minified release bundle). Those are
// orthogonal questions: `__DEV__` is a JS-bundle build-mode flag, and INTERVAL_ENV is which AWS
// backend this build talks to. A Staging beta build must never show developer tooling even if,
// for internal founder testing, it happens to be a Debug-configuration build pointed at Staging
// (`__DEV__` would be true there) — and a founder Development build must keep showing it even
// when compiled in a Release configuration (`__DEV__` would be false there). See
// docs/staging-beta-distribution.md's "Dev Tools gating" section.
export function isDevToolsEnabled(): boolean {
  try {
    return getEnvironmentConfig().isDevelopment;
  } catch {
    // Fails closed: an unreadable/misconfigured environment must never show developer tooling.
    return false;
  }
}
