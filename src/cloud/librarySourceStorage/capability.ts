import { getEnvironmentConfig } from "../../config/environment";

// Centralized rollout gate for private original Library source-file storage — deliberately a
// SEPARATE capability from src/cloud/sync/libraryMetadataSyncCapability.ts, even though both
// currently resolve to the same "development" allow-list. Metadata sync and original-file storage
// are independent capabilities (see docs/library-and-source-architecture.md's "Environment
// boundary" note) — Staging or Production could someday get metadata sync enabled well before
// source storage, or vice versa, and coupling the two gates would make that impossible without a
// rewrite. Do not merge this with isLibraryMetadataCloudSyncEnabled().
//
// The only call sites are meant to be src/cloud/librarySourceStorage/index.ts's
// requestUploadUrl/requestDownloadUrl — route any new call site through this function rather than
// adding a second, scattered INTERVAL_ENV check.
const ALLOWED_ENVIRONMENTS: readonly string[] = ["development"];

/**
 * Whether private original-source-file cloud storage (upload/download URL requests) is enabled
 * for the current environment. Fails closed (returns false) if environment config can't be read
 * at all — source-file storage is opt-in on top of an already-working offline-first Library,
 * never a hard requirement.
 */
export function isLibrarySourceStorageEnabled(): boolean {
  try {
    const { environment } = getEnvironmentConfig();
    return ALLOWED_ENVIRONMENTS.includes(environment);
  } catch {
    return false;
  }
}
