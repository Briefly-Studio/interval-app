// Appearance mode is the user's *choice*; ResolvedTheme is what's actually applied after
// resolving "system" against the current OS appearance. "warm" is never a resolution target for
// "system" — it is always an explicit, manual choice (see resolveAppearance.ts).
export type AppearanceMode = "system" | "light" | "dark" | "warm";
export type ResolvedTheme = "light" | "dark" | "warm";
// The OS's own raw appearance signal — always exactly light or dark, never warm (the OS has no
// concept of Warm). Defined here (not in index.ts, where it previously lived) so both index.ts
// and startupTreatment.ts can depend on it without either importing from the other.
export type SystemScheme = "light" | "dark";

export const APPEARANCE_MODES: readonly AppearanceMode[] = ["system", "light", "dark", "warm"];

export function isAppearanceMode(value: unknown): value is AppearanceMode {
  return typeof value === "string" && (APPEARANCE_MODES as readonly string[]).includes(value);
}

// Semantic token contract — every production surface should read from these names, never from a
// raw hex value. See docs/appearance-system.md for the full rationale and contrast findings
// behind each theme's values.
export type ThemeTokens = {
  canvas: string;
  surface: string;
  surfaceElevated: string;
  surfaceMuted: string;

  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;

  border: string;
  borderStrong: string;
  divider: string;

  accent: string;
  accentPressed: string;
  accentSubtle: string;
  onAccent: string;

  success: string;
  successPressed: string;
  successSurface: string;
  onSuccess: string;

  warning: string;
  warningPressed: string;
  warningSurface: string;
  onWarning: string;

  danger: string;
  dangerPressed: string;
  dangerSurface: string;
  onDanger: string;

  disabledSurface: string;
  disabledText: string;
  disabledBorder: string;

  inputBackground: string;
  inputBorder: string;
  inputBorderFocused: string;
  placeholder: string;

  navigationBackground: string;
  navigationBorder: string;
  navigationActive: string;
  navigationInactive: string;

  overlay: string;
  shadowColor: string;
};

// Non-color tokens are intentionally theme-independent — spacing/type/radii don't change with
// appearance, only color does. Kept here so useTheme() can expose one flat object.
export type Spacing = { xs: number; sm: number; md: number; lg: number; xl: number; xxl: number };
export type Radii = { sm: number; md: number; lg: number; pill: number };
export type IconSizes = { sm: number; md: number; lg: number };
export type TouchTarget = { min: number };
