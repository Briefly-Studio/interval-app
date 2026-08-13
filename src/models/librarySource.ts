// Local-only Library metadata model — see docs/library-and-source-architecture.md and
// docs/library-ui-foundation.md for the full product/architecture context.
//
// IMPORTANT: a LibrarySourceRecord is METADATA ONLY. This foundation batch never stores, reads,
// uploads, or processes an actual document/audio binary. There is no file URI, no cloud storage
// key, no extracted text, and no AI-generated content anywhere on this type. `ownerId`/Cognito
// `sub` is deliberately NOT a field here — local records are scoped per-device by the existing
// WorkspaceScope mechanism (see src/storage/libraryKeys.ts), the same way decks/cards already
// are, not by an account identifier attached to the record itself. Account adoption of local
// Library metadata into a real cloud record remains future work — see
// docs/library-and-source-architecture.md §18.

export type SourceType = "pdf" | "docx" | "text" | "image" | "audio" | "pptx" | "xlsx";

// Deliberately narrow. "uploading"/"processing" are NOT included here — this foundation has no
// upload or processing pipeline, so a production user must never see a fake operation in
// progress. "archived" mirrors `archivedAt` for simple, single-field status text/labels; the
// timestamp (not this string) is the source of truth for archived state.
export type SourceProcessingStatus = "ready" | "needsReview" | "archived";

export type LibrarySource = {
  id: string;
  displayTitle: string;
  originalName?: string;
  sourceType: SourceType;
  mimeType?: string;
  extension?: string;
  fileSize?: number;
  createdAt: string;
  lastUsedAt?: string;
  processingStatus: SourceProcessingStatus;
  sourceLanguage?: string;
  pageCount?: number;
  slideCount?: number;
  sheetCount?: number;
  audioDuration?: number;
  collectionIds: string[];
  tags: string[];
  course?: string;
  semester?: string;
};

export type LibrarySourceRecord = LibrarySource & {
  rev: number;
  updatedAt: string;
  archivedAt?: string;
  deletedAt?: string;
  // `dirty` is now read by src/cloud/sync/SyncService.ts (see docs/library-cloud-sync-contract.md)
  // — but only when Library metadata cloud sync is enabled for the current environment (currently
  // `development` only, see src/cloud/sync/libraryMetadataSyncCapability.ts). Every local mutation
  // in src/storage/librarySources.ts already sets this true and nothing has ever cleared it before
  // now, so every pre-existing local record is already correctly flagged for its first sync — no
  // separate migration step was needed for this field.
  dirty?: boolean;
  // Set by SyncService after a push is acknowledged or a pull applies this record — matches
  // DeckRecord/CardRecord/SessionRecord's own field exactly. Never read by any code path itself;
  // kept for diagnostic/shape parity, same as those other entities.
  lastSyncedAt?: string;
};

const SOURCE_TYPES: SourceType[] = ["pdf", "docx", "text", "image", "audio", "pptx", "xlsx"];
const STATUSES: SourceProcessingStatus[] = ["ready", "needsReview", "archived"];

function isSourceType(value: unknown): value is SourceType {
  return typeof value === "string" && (SOURCE_TYPES as string[]).includes(value);
}

function isStatus(value: unknown): value is SourceProcessingStatus {
  return typeof value === "string" && (STATUSES as string[]).includes(value);
}

// Used for both `collectionIds` and `tags`. Trims each entry and deduplicates — a malformed or
// hand-edited stored record could otherwise carry a duplicate collection id (rendered twice in a
// source card) or an untrimmed tag (e.g. `"  foo  "` alongside a clean `"foo"`, silently treated
// as two different tags by anything that compares strings directly).
function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const cleaned = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return Array.from(new Set(cleaned));
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

// Malformed/partial stored records must never crash the app — every field is defensively
// validated and coerced to a safe default on read, matching the existing upgradeDeck/upgradeCard
// convention in src/models/deck.ts and src/models/card.ts. Unknown-but-safe extra fields on the
// raw input are intentionally dropped rather than spread through: this is a brand-new local-only
// key with no legacy shape to preserve compatibility with, so there is nothing "unknown" here
// that could be a future field worth round-tripping yet.
export function upgradeLibrarySource(raw: any): LibrarySourceRecord {
  const now = new Date().toISOString();
  const createdAt = typeof raw?.createdAt === "string" && raw.createdAt ? raw.createdAt : now;
  const updatedAt = typeof raw?.updatedAt === "string" && raw.updatedAt ? raw.updatedAt : createdAt;

  return {
    id: typeof raw?.id === "string" && raw.id ? raw.id : "",
    displayTitle: typeof raw?.displayTitle === "string" ? raw.displayTitle : "",
    originalName: normalizeOptionalString(raw?.originalName),
    sourceType: isSourceType(raw?.sourceType) ? raw.sourceType : "text",
    mimeType: normalizeOptionalString(raw?.mimeType),
    extension: normalizeOptionalString(raw?.extension),
    fileSize: normalizeOptionalNumber(raw?.fileSize),
    createdAt,
    lastUsedAt: normalizeOptionalString(raw?.lastUsedAt),
    processingStatus: isStatus(raw?.processingStatus) ? raw.processingStatus : "ready",
    sourceLanguage: normalizeOptionalString(raw?.sourceLanguage),
    pageCount: normalizeOptionalNumber(raw?.pageCount),
    slideCount: normalizeOptionalNumber(raw?.slideCount),
    sheetCount: normalizeOptionalNumber(raw?.sheetCount),
    audioDuration: normalizeOptionalNumber(raw?.audioDuration),
    collectionIds: normalizeStringArray(raw?.collectionIds),
    tags: normalizeStringArray(raw?.tags),
    course: normalizeOptionalString(raw?.course),
    semester: normalizeOptionalString(raw?.semester),
    rev: typeof raw?.rev === "number" ? raw.rev : 0,
    updatedAt,
    archivedAt: normalizeOptionalString(raw?.archivedAt),
    deletedAt: normalizeOptionalString(raw?.deletedAt),
    dirty: raw?.dirty === true,
    lastSyncedAt: normalizeOptionalString(raw?.lastSyncedAt),
  };
}
