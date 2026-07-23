// Fixed, non-rotating copy for the sign-in transition screen only. Deliberately separate from
// the rotating returning-user message pool (welcomeMessages.ts) — the transition's job is to
// communicate progress and briefly welcome the user, not to carry personality/variety, and it
// must never show the same line the user is about to see again on Home immediately after.

export const TRANSITION_RESTORING_MESSAGE = "Restoring your workspace…";

export function getTransitionReadyMessage(givenName: string | undefined): string {
  const name = givenName?.trim();
  return name ? `Welcome back, ${name}.` : "Your workspace is ready.";
}
