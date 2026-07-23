import type { WorkspaceScope } from "../storage/workspaceScope";

const listeners = new Set<(scope: WorkspaceScope) => void>();

export function onWorkspaceChanged(cb: (scope: WorkspaceScope) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function emitWorkspaceChanged(scope: WorkspaceScope): void {
  listeners.forEach((listener) => listener(scope));
}
