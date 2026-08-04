import { Platform } from "react-native";

import type { IconSizes, Radii, ResolvedTheme, Spacing, ThemeTokens, TouchTarget } from "./types";

// Non-color tokens are unchanged from the previous static src/ui/theme.ts — appearance support
// must not change sizing, spacing, or type scale, only color.
export const spacing: Spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radii: Radii = { sm: 8, md: 12, lg: 16, pill: 999 };
export const iconSizes: IconSizes = { sm: 16, md: 20, lg: 24 };
export const touchTarget: TouchTarget = { min: 44 };

// Font sizes/weights only — color is intentionally NOT embedded here (unlike the old theme.ts's
// typography export), since the same "title"/"body"/etc. style is now used across four different
// resolved themes and can no longer carry one fixed color. Callers pair a size style with
// `{ color: theme.textPrimary }` (or textSecondary/etc.) at the point of use.
export const typographySizes = {
  title: { fontSize: 28, fontWeight: "700" as const, letterSpacing: -0.3 },
  heading: { fontSize: 20, fontWeight: "600" as const },
  subheading: { fontSize: 17, fontWeight: "600" as const },
  body: { fontSize: 16, fontWeight: "400" as const },
  bodyMedium: { fontSize: 16, fontWeight: "500" as const },
  secondary: { fontSize: 14, fontWeight: "400" as const },
  caption: { fontSize: 13, fontWeight: "400" as const },
  label: { fontSize: 13, fontWeight: "600" as const, letterSpacing: 0.2 },
};

export function cardShadow(shadowColor: string) {
  return (
    (Platform.select({
      ios: { shadowColor, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 2 },
      default: {},
    }) as object) ?? {}
  );
}

// ============================================================================
// LIGHT — the existing approved beta visual language, with three changes:
// (1) accent moved to the branding repo's approved primary teal (#0F6E6A), replacing production's
//     prior #2FA4A3/#1D7B7A split, per explicit founder direction; #0F6E6A clears AA in both
//     directions on its own (6.07:1), so the old two-teal contrast workaround is no longer needed.
// (2) danger/warning/borderStrong corrected to values that actually clear their documented
//     contrast targets (see docs/appearance-system.md for the full before/after).
// (3) success (#2F7A55→#2D7552, ~4% darker) and warning (#8A6220→#896120, ~1% darker) nudged to
//     close a later-found marginal gap against successSurface/warningSurface (previously ~4.44:1,
//     just under the 4.5:1 AA text threshold) — see docs/appearance-system.md's contrast report
//     for the full before/after; both changes are deliberately tiny, same hue family, nowhere
//     near danger-red.
// ============================================================================
export const LIGHT_TOKENS: ThemeTokens = {
  canvas: "#F7F8FA",
  surface: "#FFFFFF",
  surfaceElevated: "#FFFFFF",
  surfaceMuted: "#F0F2F5",

  textPrimary: "#1B2430",
  textSecondary: "#5B6572",
  textMuted: "#7C8794",
  textInverse: "#FFFFFF",

  border: "#E1E4E8",
  borderStrong: "#7F8D96",
  divider: "#E1E4E8",

  accent: "#0F6E6A",
  accentPressed: "#0C5854",
  accentSubtle: "#E3F3F2",
  onAccent: "#FFFFFF",

  success: "#2D7552",
  successPressed: "#245E42",
  successSurface: "#E3F0EA",
  onSuccess: "#FFFFFF",

  warning: "#896120",
  warningPressed: "#6E4E1A",
  warningSurface: "#F7EEDF",
  onWarning: "#FFFFFF",

  danger: "#B03939",
  dangerPressed: "#8E2D2D",
  dangerSurface: "#FBEAEA",
  onDanger: "#FFFFFF",

  disabledSurface: "#F0F2F5",
  disabledText: "#A9B2BA",
  disabledBorder: "#E1E4E8",

  inputBackground: "#FFFFFF",
  inputBorder: "#E1E4E8",
  inputBorderFocused: "#0F6E6A",
  placeholder: "#7C8794",

  navigationBackground: "#FFFFFF",
  navigationBorder: "#E1E4E8",
  navigationActive: "#0F6E6A",
  navigationInactive: "#7C8794",

  overlay: "rgba(15, 23, 32, 0.45)",
  shadowColor: "#0F1720",
};

// ============================================================================
// DARK — approved brand dark-mode anchors reused verbatim (#1B2024, #FAFAF8, #3FA39D). Four
// distinct tonal steps (canvas < surfaceMuted < surface < surfaceElevated), not an inversion.
// Important, non-obvious finding: white text on the accent teal fails AA (2.9:1); dark text
// passes comfortably (5.43:1) — onAccent/onSuccess/onWarning/onDanger are all DARK in this theme,
// not white, because every one of those colors is bright enough that dark text reads better.
// ============================================================================
export const DARK_TOKENS: ThemeTokens = {
  canvas: "#1B2024",
  surface: "#232A2F",
  surfaceElevated: "#2B333A",
  surfaceMuted: "#20262A",

  textPrimary: "#FAFAF8",
  textSecondary: "#A7B0B8",
  textMuted: "#7A838A",
  textInverse: "#FFFFFF",

  border: "#333B41",
  borderStrong: "#69747B",
  divider: "#333B41",

  accent: "#3FA39D",
  accentPressed: "#368F8A",
  accentSubtle: "#16302E",
  onAccent: "#1B2024",

  success: "#4FAE83",
  successPressed: "#3E9670",
  successSurface: "#16302A",
  onSuccess: "#1B2024",

  warning: "#D9A94A",
  warningPressed: "#C0913A",
  warningSurface: "#3A2F1A",
  onWarning: "#1B2024",

  danger: "#E67C73",
  dangerPressed: "#D2645B",
  dangerSurface: "#3A1F1E",
  onDanger: "#1B2024",

  disabledSurface: "#20262A",
  disabledText: "#5A6268",
  disabledBorder: "#333B41",

  inputBackground: "#232A2F",
  inputBorder: "#333B41",
  inputBorderFocused: "#3FA39D",
  placeholder: "#7A838A",

  navigationBackground: "#232A2F",
  navigationBorder: "#333B41",
  navigationActive: "#3FA39D",
  navigationInactive: "#7A838A",

  overlay: "rgba(0, 0, 0, 0.6)",
  shadowColor: "#000000",
};

// ============================================================================
// WARM — "paper under warm natural light." Three progressively lighter warm surfaces (verified
// by luminance: canvas 0.857 < surface 0.884 < elevated 0.942), restrained warm-neutral hue (not
// yellow/mustard/sepia/parchment), Interval teal retained at the branding-approved value.
// success/warning reuse LIGHT_TOKENS' same corrected values (#2D7552/#896120) — see LIGHT_TOKENS'
// own comment above for why they were nudged.
// ============================================================================
export const WARM_TOKENS: ThemeTokens = {
  canvas: "#F5EEDC",
  surface: "#FAF1DB",
  surfaceElevated: "#FFF8E8",
  surfaceMuted: "#EFE6D0",

  textPrimary: "#292620",
  textSecondary: "#625C50",
  textMuted: "#8A8272",
  textInverse: "#FFFFFF",

  border: "#D8CDB7",
  borderStrong: "#8F7C58",
  divider: "#D8CDB7",

  accent: "#0F6E6A",
  accentPressed: "#0C5854",
  accentSubtle: "#E1EFEC",
  onAccent: "#FFFFFF",

  success: "#2D7552",
  successPressed: "#245E42",
  successSurface: "#E3EAD9",
  onSuccess: "#FFFFFF",

  warning: "#896120",
  warningPressed: "#6E4E1A",
  warningSurface: "#F2E7CE",
  onWarning: "#FFFFFF",

  danger: "#A63333",
  dangerPressed: "#852828",
  dangerSurface: "#F6E2DC",
  onDanger: "#FFFFFF",

  disabledSurface: "#EFE6D0",
  disabledText: "#A79A82",
  disabledBorder: "#D8CDB7",

  inputBackground: "#FFF8E8",
  inputBorder: "#D8CDB7",
  inputBorderFocused: "#0F6E6A",
  placeholder: "#8A8272",

  navigationBackground: "#FAF1DB",
  navigationBorder: "#D8CDB7",
  navigationActive: "#0F6E6A",
  navigationInactive: "#8A8272",

  overlay: "rgba(41, 38, 32, 0.45)",
  shadowColor: "#3A3226",
};

export const THEME_TOKENS: Record<ResolvedTheme, ThemeTokens> = {
  light: LIGHT_TOKENS,
  dark: DARK_TOKENS,
  warm: WARM_TOKENS,
};
