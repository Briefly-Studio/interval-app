const listeners = new Set<(signedIn: boolean) => void>();

export function onAuthChanged(cb: (signedIn: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function emitAuthChanged(signedIn: boolean): void {
  listeners.forEach((listener) => listener(signedIn));
}
