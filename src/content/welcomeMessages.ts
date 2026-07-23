// Interval's returning-user voice: a familiar study partner — warm, lightly witty, never
// trend-dependent, never sassy in sensitive flows (sign-up, confirmation, errors, sync
// failures). Only ever shown after a successful sign-in (the transition screen and the
// authenticated home screen) — never wire this into account-creation, confirmation, or error UI.
//
// Distribution target: ~60% warm, ~30% lightly sassy, ~10% motivational. Selection is
// deterministic per calendar day (see selectWelcomeMessage), not randomized per render.

export type MessageTone = "warm" | "sassy" | "motivational";

export type WelcomeMessage = {
  id: string;
  /** May contain the literal placeholder "{firstName}". */
  headline: string;
  supporting?: string;
  tone: MessageTone;
  /** True if `headline` or `supporting` contains "{firstName}". */
  personalizable: boolean;
};

export const WELCOME_MESSAGES: WelcomeMessage[] = [
  // Warm (6)
  { id: "warm-1", headline: "Good to see you again.", supporting: "Ready to continue?", tone: "warm", personalizable: false },
  { id: "warm-2", headline: "There you are.", supporting: "Ready for another round?", tone: "warm", personalizable: false },
  { id: "warm-3", headline: "Another session? Good choice.", supporting: "Pick up where you left off.", tone: "warm", personalizable: false },
  { id: "warm-4", headline: "Welcome back, {firstName}.", supporting: "Let's pick up where you left off.", tone: "warm", personalizable: true },
  { id: "warm-5", headline: "Ready when you are, {firstName}.", supporting: "Your workspace is ready.", tone: "warm", personalizable: true },
  { id: "warm-6", headline: "Welcome back.", supporting: "Ready for your next session?", tone: "warm", personalizable: false },
  // Lightly sassy (3)
  { id: "sassy-1", headline: "Back already? We like the commitment.", supporting: "Pick up where you left off.", tone: "sassy", personalizable: false },
  { id: "sassy-2", headline: "Thought we lost you, champ.", supporting: "Good to have you back.", tone: "sassy", personalizable: false },
  { id: "sassy-3", headline: "The decks are still here.", supporting: "So are you.", tone: "sassy", personalizable: false },
  // Motivational (1)
  { id: "motivational-1", headline: "Welcome back. Let's make this session count.", supporting: "Continue from your latest deck.", tone: "motivational", personalizable: false },
];

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Deterministic per calendar day (device-local date) — stable across re-renders and app restarts within the same day. */
export function selectWelcomeMessage(
  pool: WelcomeMessage[] = WELCOME_MESSAGES,
  date: Date = new Date()
): WelcomeMessage {
  if (pool.length === 0) {
    throw new Error("selectWelcomeMessage: pool must not be empty");
  }
  const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const index = hashString(dayKey) % pool.length;
  return pool[index];
}

export type RenderedWelcomeMessage = {
  headline: string;
  supporting?: string;
};

/**
 * The main entry point for consumers. Never lets a missing name produce awkward text: when no
 * `firstName` is available, personalizable messages are excluded from the selection pool
 * entirely, rather than rendering with an empty placeholder.
 */
export function getWelcomeMessage(
  firstName: string | undefined,
  date: Date = new Date()
): RenderedWelcomeMessage {
  const name = firstName?.trim();
  const pool = name ? WELCOME_MESSAGES : WELCOME_MESSAGES.filter((message) => !message.personalizable);
  const message = selectWelcomeMessage(pool, date);

  return {
    headline: message.headline.replace("{firstName}", name ?? ""),
    supporting: message.supporting,
  };
}
