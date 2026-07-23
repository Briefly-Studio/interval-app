import { onSyncComplete } from "./syncSignal";

/**
 * Resolves as soon as the next sync-complete event fires, or after `maxMs`, whichever comes
 * first — never both. Does not call SyncService itself; it only observes the sync that was
 * already triggered elsewhere (app/_layout.tsx's workspace-changed listener), so it can never
 * cause a duplicate sync invocation.
 */
export function waitForSyncOrTimeout(maxMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      unsubscribe();
      resolve();
    }, maxMs);

    const unsubscribe = onSyncComplete(() => {
      clearTimeout(timeoutId);
      unsubscribe();
      resolve();
    });
  });
}
