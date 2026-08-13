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
export type PushResponse = { accepted: string[]; rejected: string[] };

export type PullRequest = { deviceId: string; cursor?: string };
export type PullResponse = { cursor: string; changes: Change[] };
