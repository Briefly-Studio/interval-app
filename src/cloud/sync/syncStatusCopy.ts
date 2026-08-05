import type { TranslationKey } from "../../i18n";
import type { SyncStatus } from "./syncState";

// Shared i18n key mapping for SyncStatus, used by every screen that renders sync status text
// (Home, Settings, and the Sync Status detail screen) so the key names stay in exactly one
// place rather than being redefined per screen. Typed against the real TranslationKey union
// (not a bare string) so a typo here is a compile error, and call sites never need an `as
// TranslationKey` cast for a value looked up through this map.
export const SYNC_STATUS_KEYS: Record<SyncStatus, TranslationKey> = {
  unknown: "sync.status.unknown",
  syncing: "sync.status.syncing",
  synced: "sync.status.synced",
  syncedWithWarnings: "sync.status.syncedWithWarnings",
  offline: "sync.status.offline",
  needsAttention: "sync.status.needsAttention",
};
