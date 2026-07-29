// Fixed, non-rotating copy for the sign-in transition screen only. Deliberately separate from
// the rotating returning-user message pool (welcomeMessages.ts) — the transition's job is to
// communicate progress and briefly welcome the user, not to carry personality/variety, and it
// must never show the same line the user is about to see again on Home immediately after.
//
// Strings now come from src/i18n (Localization Foundation V1) — kept as plain functions taking
// the translator as a parameter so this stays pure/testable, same approach as timeGreeting.ts.

import type { TranslateFn } from "../i18n/translateFn";

export function getTransitionRestoringMessage(t: TranslateFn): string {
  return t("auth.restoringWorkspace");
}

export function getTransitionReadyMessage(t: TranslateFn, givenName: string | undefined): string {
  const name = givenName?.trim();
  return name ? t("auth.welcomeBack", { name }) : t("auth.workspaceReady");
}
