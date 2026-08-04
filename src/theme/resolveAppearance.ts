import type { AppearanceMode, ResolvedTheme } from "./types";

// "warm" is deliberately excluded from what "system" can ever resolve to — it is always an
// explicit, manual choice (see the appearance-mode definitions in Settings → Appearance).
export function resolveAppearance(
  mode: AppearanceMode,
  systemScheme: "light" | "dark" | null | undefined
): ResolvedTheme {
  if (mode === "light" || mode === "dark" || mode === "warm") return mode;
  return systemScheme === "dark" ? "dark" : "light";
}
