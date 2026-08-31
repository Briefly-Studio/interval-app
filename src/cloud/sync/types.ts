import type { CardRecord } from "../../models/card";
import type { DeckRecord } from "../../models/deck";
import type { LibrarySourceRecord } from "../../models/librarySource";
import type { SessionRecord } from "../../models/session";
import type { SourceCollectionRecord } from "../../models/sourceCollection";

export type EntityType = "deck" | "card" | "session" | "librarySource" | "sourceCollection";

export type Change = {
  id: string;
  entity: EntityType;
  op: "upsert" | "delete";
  record: DeckRecord | CardRecord | SessionRecord | LibrarySourceRecord | SourceCollectionRecord;
  ts: string;
};

export type PushRequest = { deviceId: string; changes: Change[] };

/** Canonical acknowledgement identity. An `id` alone is NOT unique — the same id can exist under
 * two entity types (`deck:123` and `card:123`), so acceptance/rejection must always carry
 * `entity` (audit finding 2). Rejected items additionally carry a non-content `reason`. */
export type PushAck = { entity: EntityType; id: string };
export type PushRejection = PushAck & { reason?: string };
export type PushResponse = { accepted: PushAck[]; rejected: PushRejection[] };

export type PullRequest = { deviceId: string; cursor?: string };
export type PullResponse = { cursor: string; changes: Change[] };
