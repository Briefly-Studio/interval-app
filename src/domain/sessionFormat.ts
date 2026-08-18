// src/domain/sessionFormat.ts

import type { TranslateFn } from "../i18n/translateFn";

// `language` is the active, explicitly-resolved app language (see src/i18n/index.ts) — never the
// device's raw locale — so this stays consistent with whatever language the user has actually
// selected in Interval, even when it differs from the device's own OS locale.
export function formatTimestamp(value: number, language: string) {
  return new Date(value).toLocaleString(language, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

// Deliberately abbreviated ("3m 45s", not "3 minutes 45 seconds") to fit inline in a compact
// result-summary row — see the `duration.*` keys in src/i18n/locales/en.ts. Shared by deck
// history, review results, and quiz results, which previously each carried their own
// byte-identical copy of this function with hardcoded English "m"/"s" suffixes.
export function formatDuration(startedAt: number, finishedAt: number, t: TranslateFn) {
  const diff = Math.max(0, finishedAt - startedAt);
  const totalSeconds = Math.floor(diff / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return minutes > 0
    ? t("duration.minutesSeconds", { minutes, seconds })
    : t("duration.secondsOnly", { seconds });
}
