// One UI-owned generation lease across route instances, including consent/confirmation.
// Cancellation invalidates publication immediately but holds the lease until in-flight work
// settles. Navigating back cannot start another request while the old request is still running.
export function createGenerationRunGuard() {
  let occupied = false;
  return {
    start() {
      if (occupied) return null;
      occupied = true;
      let canceled = false, finished = false;
      return {
        cancel: () => { canceled = true; },
        isCanceled: () => canceled || finished,
        finish: () => { if (!finished) { finished = true; occupied = false; } },
      };
    },
  };
}
export type GenerationRun = NonNullable<ReturnType<ReturnType<typeof createGenerationRunGuard>["start"]>>;
export const generationRunGuard = createGenerationRunGuard();
