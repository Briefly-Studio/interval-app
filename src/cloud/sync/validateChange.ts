import type { CardRecord } from "../../models/card";
import type { DeckRecord } from "../../models/deck";
import type { LibrarySourceRecord } from "../../models/librarySource";
import type { SessionRecord } from "../../models/session";
import type { SourceCollectionRecord } from "../../models/sourceCollection";
import type { Change, EntityType } from "./types";

const ENTITY_TYPES: readonly EntityType[] = ["deck", "card", "session", "librarySource", "sourceCollection"];
const OPS: readonly Change["op"][] = ["upsert", "delete"];
const DIFFICULTIES: readonly string[] = ["easy", "medium", "hard"];
const MODES: readonly string[] = ["review", "quiz"];
// Duplicated from src/models/librarySource.ts's private SOURCE_TYPES/STATUSES rather than
// imported, matching this file's existing DIFFICULTIES/MODES precedent (validateChange
// deliberately keeps its own local copy of every enum it checks, rather than importing from the
// model layer, so this file's shape-validation stays self-contained and easy to audit in one
// place).
const SOURCE_TYPES: readonly string[] = ["pdf", "docx", "text", "image", "audio", "pptx", "xlsx"];
const SOURCE_STATUSES: readonly string[] = ["ready", "needsReview", "archived"];

// Diagnostic-only — safe to log. Never carries record content (front/back/title), tokens, or
// any other personal data, only the entity type, the change id, and a fixed rejection reason.
export type RejectedChange = {
  entity?: string;
  id?: string;
  reason: string;
};

export type ValidationResult =
  | { ok: true; change: Change }
  | { ok: false; rejected: RejectedChange };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isDeckRecordShape(record: unknown): record is DeckRecord {
  if (!record || typeof record !== "object") return false;
  const r = record as Record<string, unknown>;
  return (
    isNonEmptyString(r.id) &&
    typeof r.title === "string" &&
    isNonEmptyString(r.createdAt) &&
    isFiniteNumber(r.rev) &&
    isNonEmptyString(r.updatedAt)
  );
}

function isCardRecordShape(record: unknown): record is CardRecord {
  if (!record || typeof record !== "object") return false;
  const r = record as Record<string, unknown>;
  return (
    isNonEmptyString(r.id) &&
    isNonEmptyString(r.deckId) &&
    typeof r.front === "string" &&
    typeof r.back === "string" &&
    typeof r.difficulty === "string" &&
    DIFFICULTIES.includes(r.difficulty) &&
    isFiniteNumber(r.createdAt) &&
    isFiniteNumber(r.rev) &&
    isNonEmptyString(r.updatedAt)
  );
}

function isSessionRecordShape(record: unknown): record is SessionRecord {
  if (!record || typeof record !== "object") return false;
  const r = record as Record<string, unknown>;
  return (
    isNonEmptyString(r.id) &&
    isNonEmptyString(r.deckId) &&
    typeof r.mode === "string" &&
    MODES.includes(r.mode) &&
    isFiniteNumber(r.startedAt) &&
    isFiniteNumber(r.finishedAt) &&
    isFiniteNumber(r.total) &&
    isFiniteNumber(r.rev) &&
    isNonEmptyString(r.updatedAt)
  );
}

// Metadata-only shape check — same shallow depth as the other validators above. Deliberately does
// not validate every optional field (mimeType, pageCount, etc.); only the fields this app relies
// on structurally (id, required strings, enums, array fields, rev/updatedAt) are checked.
function isLibrarySourceRecordShape(record: unknown): record is LibrarySourceRecord {
  if (!record || typeof record !== "object") return false;
  const r = record as Record<string, unknown>;
  return (
    isNonEmptyString(r.id) &&
    typeof r.displayTitle === "string" &&
    typeof r.sourceType === "string" &&
    SOURCE_TYPES.includes(r.sourceType) &&
    isNonEmptyString(r.createdAt) &&
    typeof r.processingStatus === "string" &&
    SOURCE_STATUSES.includes(r.processingStatus) &&
    Array.isArray(r.collectionIds) &&
    Array.isArray(r.tags) &&
    isFiniteNumber(r.rev) &&
    isNonEmptyString(r.updatedAt)
  );
}

function isSourceCollectionRecordShape(record: unknown): record is SourceCollectionRecord {
  if (!record || typeof record !== "object") return false;
  const r = record as Record<string, unknown>;
  return (
    isNonEmptyString(r.id) &&
    typeof r.name === "string" &&
    isNonEmptyString(r.createdAt) &&
    isFiniteNumber(r.rev) &&
    isNonEmptyString(r.updatedAt)
  );
}

/**
 * Validates one raw pulled change before it is ever applied to local storage.
 *
 * This rejects rather than coerces. That's deliberate, and different from the local
 * upgradeDeck/upgradeCard/upgradeSession migration helpers in src/models — those fill in safe
 * defaults for locally-authored data this app already trusts (an older on-disk shape written by
 * an earlier app version). A pulled remote change is untrusted input: silently coercing a
 * malformed field into a plausible-looking default would let corrupted (or truncated, or
 * partially-written) server data land in local storage under a shape that looks valid, which is
 * worse than rejecting it outright. A rejected change is simply skipped for this sync attempt —
 * it is not written anywhere locally, and the tradeoff (see SyncService.ts's applyChanges) is
 * that this app's local copy may omit that one change rather than either crashing sync entirely
 * or storing something we can't vouch for.
 */
export function validateChange(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, rejected: { reason: "not-an-object" } };
  }
  const c = raw as Record<string, unknown>;

  const id = c.id;
  const entity = c.entity;
  const op = c.op;
  const ts = c.ts;
  const record = c.record;

  if (!isNonEmptyString(id)) {
    return {
      ok: false,
      rejected: { entity: typeof entity === "string" ? entity : undefined, reason: "missing-id" },
    };
  }
  if (typeof entity !== "string" || !ENTITY_TYPES.includes(entity as EntityType)) {
    return { ok: false, rejected: { id, reason: "unknown-entity-type" } };
  }
  if (typeof op !== "string" || !OPS.includes(op as Change["op"])) {
    return { ok: false, rejected: { entity, id, reason: "unknown-op" } };
  }
  if (!isNonEmptyString(ts) || !Number.isFinite(Date.parse(ts))) {
    return { ok: false, rejected: { entity, id, reason: "invalid-ts" } };
  }

  const entityType = entity as EntityType;
  const recordIsValid =
    entityType === "deck"
      ? isDeckRecordShape(record)
      : entityType === "card"
        ? isCardRecordShape(record)
        : entityType === "session"
          ? isSessionRecordShape(record)
          : entityType === "librarySource"
            ? isLibrarySourceRecordShape(record)
            : isSourceCollectionRecordShape(record);

  if (!recordIsValid) {
    return { ok: false, rejected: { entity, id, reason: `malformed-${entityType}-record` } };
  }

  // The record's own id must agree with the outer change's id — a mismatch is itself a sign of
  // a malformed or inconsistent change, and applying it could otherwise write a record under the
  // wrong key.
  const recordId = (record as { id?: unknown }).id;
  if (recordId !== id) {
    return { ok: false, rejected: { entity, id, reason: "id-mismatch" } };
  }

  return {
    ok: true,
    change: { id, entity: entityType, op: op as Change["op"], record: record as Change["record"], ts },
  };
}
