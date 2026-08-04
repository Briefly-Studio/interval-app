import { Platform } from "react-native";

import { LIGHT_TOKENS, radii as themeRadii, spacing as themeSpacing, typographySizes } from "../theme/tokens";

// COMPATIBILITY SHIM — not the source of truth. The real, appearance-aware token system lives in
// src/theme/ (see docs/appearance-system.md). This file exists only so any screen not yet
// migrated to useTheme() keeps compiling and rendering exactly as before (a static LIGHT
// appearance) rather than breaking. Every value here is re-exported directly from
// src/theme/tokens.ts's LIGHT_TOKENS, not independently maintained — there is only one place
// these colors are actually defined.
//
// A screen importing from here will NOT react to the user's selected appearance (System/Light/
// Dark/Warm) — it will always render Light. See this batch's report for the exact list of screens
// still on this shim vs. migrated to useTheme().
export const colors = {
  background: LIGHT_TOKENS.canvas,
  surface: LIGHT_TOKENS.surface,
  surfaceMuted: LIGHT_TOKENS.surfaceMuted,
  border: LIGHT_TOKENS.border,
  borderStrong: LIGHT_TOKENS.borderStrong,
  textPrimary: LIGHT_TOKENS.textPrimary,
  textSecondary: LIGHT_TOKENS.textSecondary,
  textPlaceholder: LIGHT_TOKENS.textMuted,
  textInverse: LIGHT_TOKENS.textInverse,
  accent: LIGHT_TOKENS.accent,
  accentStrong: LIGHT_TOKENS.accent,
  accentPressed: LIGHT_TOKENS.accentPressed,
  accentMuted: LIGHT_TOKENS.accentSubtle,
  danger: LIGHT_TOKENS.danger,
  dangerMuted: LIGHT_TOKENS.dangerSurface,
  success: LIGHT_TOKENS.success,
  warning: LIGHT_TOKENS.warning,
  overlay: LIGHT_TOKENS.overlay,
} as const;

export const spacing = themeSpacing;
export const radii = themeRadii;

export const shadows = {
  card:
    (Platform.select({
      ios: {
        shadowColor: LIGHT_TOKENS.shadowColor,
        shadowOpacity: 0.06,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 2 },
      default: {},
    }) as object) ?? {},
} as const;

// Old shape embedded color per style — reconstructed here for compatibility since the new
// typographySizes are intentionally colorless (a single size scale is now shared by four
// resolved themes). Do not add new consumers of this export; use useTheme().typography plus an
// explicit color instead.
export const typography = {
  title: { ...typographySizes.title, color: colors.textPrimary },
  heading: { ...typographySizes.heading, color: colors.textPrimary },
  subheading: { ...typographySizes.subheading, color: colors.textPrimary },
  body: { ...typographySizes.body, color: colors.textPrimary },
  bodyMedium: { ...typographySizes.bodyMedium, color: colors.textPrimary },
  secondary: { ...typographySizes.secondary, color: colors.textSecondary },
  caption: { ...typographySizes.caption, color: colors.textSecondary },
  label: { ...typographySizes.label, color: colors.textSecondary },
} as const;

export const iconSizes = { sm: 16, md: 20, lg: 24 } as const;
export const touchTarget = { min: 44 } as const;
