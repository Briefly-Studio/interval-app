// Temporary Home identity copy (Batch 1B.1) — a stable, non-rotating, time-of-day greeting.
// Deliberately distinct from both the rotating returning-user pool (welcomeMessages.ts) and the
// transition screen's copy (transitionMessages.ts), per the requirement that Home not repeat
// what the user just saw on the transition screen. Superseded by a proper profile/account
// surface in a later batch.

export type TimeOfDay = "morning" | "afternoon" | "evening";

export function getTimeOfDay(now: Date = new Date()): TimeOfDay {
  const hour = now.getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

const TIME_OF_DAY_LABEL: Record<TimeOfDay, string> = {
  morning: "Good morning",
  afternoon: "Good afternoon",
  evening: "Good evening",
};

export type HomeGreeting = {
  headline: string;
  supporting: string;
};

/** Falls back naturally (no name in the sentence) when givenName is unavailable — never awkward. */
export function getHomeGreeting(givenName: string | undefined, now: Date = new Date()): HomeGreeting {
  const label = TIME_OF_DAY_LABEL[getTimeOfDay(now)];
  const name = givenName?.trim();

  return {
    headline: name ? `${label}, ${name}.` : `${label}.`,
    supporting: "Ready for your next session?",
  };
}
