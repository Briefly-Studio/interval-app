// Temporary Home identity copy (Batch 1B.1) — a stable, non-rotating, time-of-day greeting.
// Deliberately distinct from both the rotating returning-user pool (welcomeMessages.ts) and the
// transition screen's copy (transitionMessages.ts), per the requirement that Home not repeat
// what the user just saw on the transition screen. Superseded by a proper profile/account
// surface in a later batch.
//
// Strings now come from src/i18n rather than being hardcoded here (Localization Foundation
// V1) — this module stays a pure, testable function by taking the translator as a parameter
// instead of importing a React hook directly.

import type { TranslateFn } from "../i18n/translateFn";

export type TimeOfDay = "morning" | "afternoon" | "evening";

export function getTimeOfDay(now: Date = new Date()): TimeOfDay {
  const hour = now.getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export type HomeGreeting = {
  headline: string;
  supporting: string;
};

/** Falls back naturally (no name in the sentence) when givenName is unavailable — never
 * awkward, and never forces a literal fallback word like "there" into every language: the
 * neutral variant is its own translation key. */
export function getHomeGreeting(t: TranslateFn, givenName: string | undefined, now: Date = new Date()): HomeGreeting {
  const timeOfDay = getTimeOfDay(now);
  const name = givenName?.trim();

  const headline = name
    ? t(`home.greeting.${timeOfDay}`, { name })
    : t(`home.greeting.${timeOfDay}Neutral`);

  return {
    headline,
    supporting: t("home.readyForNextSession"),
  };
}
