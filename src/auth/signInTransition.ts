import { AuthService } from "./AuthService";
import type { UserIdentity } from "./identity";
import { getDecksAll } from "../storage/decks";
import { waitForSyncOrTimeout } from "../cloud/sync/waitForSyncOrTimeout";
import type { WorkspaceScope } from "../storage/workspaceScope";

export const DEFAULT_MIN_DISPLAY_MS = 550;
export const DEFAULT_MAX_WAIT_MS = 2500;
export const DEFAULT_HOLD_MS = 500;

export type SignInTransitionDeps = {
  getActiveScope: () => Promise<WorkspaceScope>;
  getActiveIdentity: () => Promise<UserIdentity | null>;
  restoreWorkspace: (scope: WorkspaceScope) => Promise<unknown>;
  waitForSync: (maxMs: number) => Promise<void>;
  onPhaseChange: (phase: "restoring" | "ready", identity: UserIdentity | null) => void;
  navigate: () => void;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  minDisplayMs?: number;
  maxWaitMs?: number;
  holdMs?: number;
};

export const defaultSignInTransitionDeps: Omit<
  SignInTransitionDeps,
  "onPhaseChange" | "navigate"
> = {
  getActiveScope: () => AuthService.getActiveScope(),
  getActiveIdentity: () => AuthService.getActiveIdentity(),
  restoreWorkspace: (scope) => getDecksAll(scope),
  waitForSync: (maxMs) => waitForSyncOrTimeout(maxMs),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Orchestrates the sign-in -> authenticated-workspace transition: resolve scope/identity, touch
 * local storage for the restored scope (real work, not a fake delay), wait for the sync that
 * app/_layout.tsx already triggered (or a bounded timeout) — never calls SyncService itself, so
 * it can't duplicate a sync run — then navigate. Guarantees a single `navigate()` call and never
 * throws past this function, so a caller can never be left stranded on the transition screen.
 *
 * Every dependency is injectable so this can be tested without React or native modules.
 */
export async function runSignInTransition(deps: SignInTransitionDeps): Promise<void> {
  const minDisplayMs = deps.minDisplayMs ?? DEFAULT_MIN_DISPLAY_MS;
  const maxWaitMs = deps.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const holdMs = deps.holdMs ?? DEFAULT_HOLD_MS;

  const startedAt = deps.now();
  let identity: UserIdentity | null = null;
  let navigated = false;

  const navigateOnce = () => {
    if (navigated) return;
    navigated = true;
    deps.navigate();
  };

  try {
    const [scope, resolvedIdentity] = await Promise.all([
      deps.getActiveScope(),
      deps.getActiveIdentity(),
    ]);
    identity = resolvedIdentity;

    if (scope.kind !== "user") {
      // Nothing to restore for a guest scope — never trap on a screen meant for a just-signed-
      // in user; this is a defensive branch only (this screen is always entered right after a
      // successful sign-in, so scope should already be "user").
      navigateOnce();
      return;
    }

    await deps.restoreWorkspace(scope).catch(() => undefined);
    await deps.waitForSync(maxWaitMs);
  } catch {
    // Never trap on failure — fall through to the minimum-display/hold sequence below and
    // navigate regardless, letting the destination screen's existing error handling take over.
  }

  const elapsed = deps.now() - startedAt;
  const remaining = Math.max(0, minDisplayMs - elapsed);
  if (remaining > 0) await deps.sleep(remaining);

  deps.onPhaseChange("ready", identity);
  await deps.sleep(holdMs);
  navigateOnce();
}
