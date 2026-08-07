// Local-only collection model — see docs/library-and-source-architecture.md §2/§9 and
// docs/library-ui-foundation.md. User-created only in this batch; automatic Canvas/course
// collections are explicitly future work (see docs/library-and-source-architecture.md §16).

export type SourceCollection = {
  id: string;
  name: string;
  createdAt: string;
};

export type SourceCollectionRecord = SourceCollection & {
  rev: number;
  updatedAt: string;
  deletedAt?: string;
  dirty?: boolean;
};

// Same defensive-normalization convention as upgradeLibrarySource — malformed stored records
// must never crash the app.
export function upgradeSourceCollection(raw: any): SourceCollectionRecord {
  const now = new Date().toISOString();
  const createdAt = typeof raw?.createdAt === "string" && raw.createdAt ? raw.createdAt : now;
  const updatedAt = typeof raw?.updatedAt === "string" && raw.updatedAt ? raw.updatedAt : createdAt;

  return {
    id: typeof raw?.id === "string" && raw.id ? raw.id : "",
    name: typeof raw?.name === "string" ? raw.name : "",
    createdAt,
    rev: typeof raw?.rev === "number" ? raw.rev : 0,
    updatedAt,
    deletedAt: typeof raw?.deletedAt === "string" && raw.deletedAt ? raw.deletedAt : undefined,
    dirty: raw?.dirty === true,
  };
}
