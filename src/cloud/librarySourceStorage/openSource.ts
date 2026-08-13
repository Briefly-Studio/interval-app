import type { LibrarySourceRecord } from "../../models/librarySource";
import { getPersistedSourceFileUri } from "../../storage/librarySourceFileStorage";
import { openSourceFile } from "../../domain/sourceViewer";
import { isLibrarySourceStorageEnabled } from "./capability";
import { downloadSourceOriginal } from "./index";

// Top-level "open original" orchestrator — the ONLY function Source Detail calls for this
// feature (see docs/library-and-source-architecture.md's "Source open/preview" section for the
// full chain: Source Detail → this service → local-file resolver
// (src/storage/librarySourceFileStorage.ts) → cloud source storage service (./index.ts) →
// platform open/preview adapter (src/domain/sourceViewer.ts)). Keeps AWS/S3 and filesystem
// details entirely out of the UI layer.

export type OpenSourceErrorReason =
  // No local copy exists AND the cloud original was never confirmed uploaded — nothing to open.
  | "unavailable"
  // No local copy, cloud original should exist, but the network request to retrieve it failed
  // (offline or otherwise unreachable) — recoverable by reconnecting and trying again.
  | "offline-no-local"
  | "access-denied"
  | "not-found"
  | "download-failed"
  | "unsupported-viewer"
  | "handoff-failed";

export type OpenSourceOutcome = { status: "opened" } | { status: "error"; reason: OpenSourceErrorReason };

export type OpenSourceStage = "resolving" | "downloading" | "opening";

// Keyed by source id so a rapid double-tap (or a second screen instance) for the SAME source
// shares one in-flight attempt instead of starting a duplicate download — mirrors
// src/cloud/sync/SyncService.ts's inFlightSync convention. A different source id is never
// blocked by another source's in-flight open.
const inFlight = new Map<string, Promise<OpenSourceOutcome>>();

/**
 * Local-first resolution, cloud fallback, then hands off to the platform viewer. Never persists
 * or exposes a presigned URL — see downloadSourceOriginal for why. `onStage` is optional and
 * purely for UI loading-text purposes; the outcome does not depend on it being provided.
 */
export function openSourceOriginal(
  source: LibrarySourceRecord,
  onStage?: (stage: OpenSourceStage) => void
): Promise<OpenSourceOutcome> {
  const existing = inFlight.get(source.id);
  if (existing) return existing;

  const run = performOpen(source, onStage).finally(() => {
    inFlight.delete(source.id);
  });
  inFlight.set(source.id, run);
  return run;
}

async function performOpen(
  source: LibrarySourceRecord,
  onStage?: (stage: OpenSourceStage) => void
): Promise<OpenSourceOutcome> {
  onStage?.("resolving");

  let uri = await getPersistedSourceFileUri(source.id);

  if (!uri) {
    // IMPORTANT PRODUCT RULE: local availability and upload state are independent — a source with
    // a local copy but cloudUploadState "pending"/"failed" is handled above (uri would be
    // non-null). Only when there is genuinely no local copy does upload state matter at all, and
    // only to decide whether a cloud fallback is even worth attempting.
    if (source.cloudUploadState !== "uploaded" || !isLibrarySourceStorageEnabled()) {
      return { status: "error", reason: "unavailable" };
    }

    onStage?.("downloading");
    const result = await downloadSourceOriginal(source.id);
    if (!result.ok) {
      const reason = result.reason === "network-error" || result.reason === "disabled" ? "offline-no-local" : result.reason;
      return { status: "error", reason };
    }
    uri = result.uri;
  }

  onStage?.("opening");
  const opened = await openSourceFile(uri, source);
  if (!opened.ok) {
    return { status: "error", reason: opened.reason };
  }

  return { status: "opened" };
}
