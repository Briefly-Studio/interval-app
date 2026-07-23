import { Platform } from "react-native";

// Design tokens for Interval's visual system: calm, premium, study-focused.
// Teal is the brand accent, not a full-screen background. Surfaces are near-white with
// dark-slate text for long-session readability. Every text/background pairing below has been
// checked against WCAG AA (4.5:1 for normal text, 3:1 for large/graphical use) except
// `textPlaceholder`, which follows the common (not strictly-required) convention of running
// lighter than real content — it is only ever used for TextInput placeholder text, never for
// text that conveys information.

export const colors = {
  // Backgrounds
  background: "#F7F8FA", // subtly tinted near-white, not harsh pure white
  surface: "#FFFFFF", // clean white surface (cards, inputs)
  surfaceMuted: "#F0F2F5", // recessed surface (disabled fields, pressed states)

  // Borders
  border: "#E1E4E8",
  borderStrong: "#C7CCD1",

  // Text
  textPrimary: "#1B2430", // dark slate, ~13:1 on background/surface
  textSecondary: "#5B6572", // muted secondary, ~5.9:1 on background/surface
  textPlaceholder: "#7C8794", // placeholder-only, ~3.7:1 — do not use for real content
  textInverse: "#FFFFFF",

  // Brand accent (teal). `accent` is for large/graphical use (icons, tints, decorative
  // elements) where the lighter original brand hue reads well. `accentStrong` is a darkened
  // variant used anywhere teal pairs with white text or sits under body-size text, so it
  // clears 4.5:1 — the original brand teal alone measures ~3:1 against white and fails AA
  // for that use.
  accent: "#2FA4A3",
  accentStrong: "#1D7B7A", // ~5:1 against white
  accentPressed: "#175F5E",
  accentMuted: "#E3F3F2", // tinted highlight background, pairs with textPrimary/accentStrong

  // Status
  danger: "#C24444", // ~5:1 against white
  dangerMuted: "#FBEAEA",
  success: "#3B8F6B",
  warning: "#B8863B",

  overlay: "rgba(15, 23, 32, 0.45)",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const shadows = {
  // Kept deliberately subtle — depth comes primarily from spacing, tonal contrast, and the
  // hairline border, with shadow only as a barely-there accent.
  card:
    (Platform.select({
      ios: {
        shadowColor: "#0F1720",
        shadowOpacity: 0.06,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 2 },
      default: {},
    }) as object) ?? {},
} as const;

export const typography = {
  title: { fontSize: 28, fontWeight: "700", color: colors.textPrimary, letterSpacing: -0.3 },
  heading: { fontSize: 20, fontWeight: "600", color: colors.textPrimary },
  subheading: { fontSize: 17, fontWeight: "600", color: colors.textPrimary },
  body: { fontSize: 16, fontWeight: "400", color: colors.textPrimary },
  bodyMedium: { fontSize: 16, fontWeight: "500", color: colors.textPrimary },
  secondary: { fontSize: 14, fontWeight: "400", color: colors.textSecondary },
  caption: { fontSize: 13, fontWeight: "400", color: colors.textSecondary },
  label: { fontSize: 13, fontWeight: "600", color: colors.textSecondary, letterSpacing: 0.2 },
} as const;

export const iconSizes = {
  sm: 16,
  md: 20,
  lg: 24,
} as const;

// Apple HIG / Material minimum recommended touch target.
export const touchTarget = {
  min: 44,
} as const;
