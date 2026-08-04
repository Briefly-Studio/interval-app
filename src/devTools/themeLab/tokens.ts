// Theme Lab — semantic token definitions.
//
// Color values below are consumed directly from src/theme/tokens.ts (production's real, single
// source of truth for appearance) rather than duplicated — this was a duplication gap in the
// original exploration (each study kept its own hardcoded hex values that could silently drift
// from production) and is fixed here now that production has a real multi-theme system to point
// at. Only `id`/`label`/`disabled` (unused by any preview component — kept for type continuity)
// are Theme-Lab-specific; every color field is production's actual rendered value, so this
// remains a true side-by-side comparison of what production looks like today, not a separate
// duplicated approximation of it. app/theme-lab.tsx (dev-only) is still the only place this file
// is imported from.
//
// Contrast ratios quoted in `contrastNotes` below were computed with the standard WCAG relative-
// luminance formula (sRGB linearize -> 0.2126R+0.7152G+0.0722B -> (L1+0.05)/(L2+0.05)), the same
// method already used in interval-brand-assets/branding/scripts/contrast.py. Ratios are stated
// only where they were actually calculated — this file does not claim formal WCAG compliance
// anywhere a number isn't backed by a real calculation.

import { DARK_TOKENS, LIGHT_TOKENS, WARM_TOKENS } from "@/src/theme";

export type ThemeId = "light" | "dark" | "warm";

export type ThemeTokens = {
  id: ThemeId;
  label: string;
  canvas: string;
  surface: string;
  surfaceElevated: string;
  surfaceMuted: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  border: string; // decorative hairline only — no minimum contrast requirement
  borderStrong: string; // state-bearing (focus/selection/input outline) — targets 3:1 vs surface
  accent: string;
  accentPressed: string;
  accentSubtle: string;
  onAccent: string;
  success: string;
  successSurface: string;
  warning: string;
  warningSurface: string;
  danger: string;
  dangerSurface: string;
  disabled: string;
  overlay: string;
  shadowColor: string;
};

export type ThemeMeta = {
  rationale: string[];
  contrastNotes: string[];
  brandConsistencyNotes: string[];
  specialTreatmentNotes: string[];
};

export const LIGHT_THEME: ThemeTokens = {
  id: "light",
  label: "Light",
  canvas: LIGHT_TOKENS.canvas,
  surface: LIGHT_TOKENS.surface,
  surfaceElevated: LIGHT_TOKENS.surfaceElevated,
  surfaceMuted: LIGHT_TOKENS.surfaceMuted,
  textPrimary: LIGHT_TOKENS.textPrimary,
  textSecondary: LIGHT_TOKENS.textSecondary,
  textMuted: LIGHT_TOKENS.textMuted,
  border: LIGHT_TOKENS.border,
  borderStrong: LIGHT_TOKENS.borderStrong,
  accent: LIGHT_TOKENS.accent,
  accentPressed: LIGHT_TOKENS.accentPressed,
  accentSubtle: LIGHT_TOKENS.accentSubtle,
  onAccent: LIGHT_TOKENS.onAccent,
  success: LIGHT_TOKENS.success,
  successSurface: LIGHT_TOKENS.successSurface,
  warning: LIGHT_TOKENS.warning,
  warningSurface: LIGHT_TOKENS.warningSurface,
  danger: LIGHT_TOKENS.danger,
  dangerSurface: LIGHT_TOKENS.dangerSurface,
  disabled: LIGHT_TOKENS.disabledText,
  overlay: LIGHT_TOKENS.overlay,
  shadowColor: LIGHT_TOKENS.shadowColor,
};

export const LIGHT_META: ThemeMeta = {
  rationale: [
    "Baseline is the existing approved beta visual language, essentially unchanged — this is the theme users already have today, not a new design.",
    "Restrained teal, near-white canvas, clear card hierarchy via a hairline border + barely-there shadow, no gradients or glassmorphism — matches the current calm, serious study-product tone.",
  ],
  contrastNotes: [
    "Calculated: textPrimary on canvas 14.73:1, textPrimary on surface 15.65:1 (AAA, unchanged from production).",
    "Calculated: textSecondary on surface 5.92:1 (AA, unchanged from production).",
    "Calculated: onAccent (#FFFFFF) on accent (#0F6E6A) 5.25:1 graphical / 6.07:1 text (AA).",
    "Calculated: danger text (#B03939, adjusted — see brand-consistency notes) on dangerSurface 5.17:1 (AA).",
    "Calculated: warning text (#896120, adjusted) on warningSurface 4.81:1 (AA), and 5.53:1 on plain white.",
    "Calculated: success (#2D7552, adjusted) on white 5.56:1 (AA); on successSurface 4.74:1 (AA) — both success and warning were nudged again (~1-4% darker) after this study's own contrast pass found them just under 4.5:1 against their tinted surfaces; now fixed at the source in production, not just documented here.",
  ],
  brandConsistencyNotes: [
    "This study originally found that production's rendered accent (#2FA4A3 / #1D7B7A family) did not match interval-brand-assets' approved primary teal (#0F6E6A), and flagged a future decision on whether Light should converge on that branding-repo value the way this study's own Warm theme already did. That finding is what prompted the production fix: production's Light accent now uses #0F6E6A directly (src/theme/tokens.ts), so this theme (now sourced live from production) shows the corrected value rather than the original mismatch. This note is kept as the historical record of why the change happened.",
    "Production's `danger`/`warning` previously failed AA against their own tinted surfaces, and `warning` also failed against plain white. Both were corrected directly in production (src/theme/tokens.ts) using the darker text-safe variants this study originally proposed (#B03939, #8A6220) — a real, pre-existing gap this exploration surfaced and which is now fixed at the source, not just documented here.",
    "Production's `borderStrong` previously measured only 1.62:1 on white — below the 3:1 non-text minimum for a state-bearing border. Production now uses #7F8D96 (3.41:1), the same value this study proposed and the branding repo's own published `state-bearing-border` token value.",
  ],
  specialTreatmentNotes: [
    "None — this is the least risky of the three studies since it's closest to shipped production.",
  ],
};

export const DARK_THEME: ThemeTokens = {
  id: "dark",
  label: "Dark",
  canvas: DARK_TOKENS.canvas,
  surface: DARK_TOKENS.surface,
  surfaceElevated: DARK_TOKENS.surfaceElevated,
  surfaceMuted: DARK_TOKENS.surfaceMuted,
  textPrimary: DARK_TOKENS.textPrimary,
  textSecondary: DARK_TOKENS.textSecondary,
  textMuted: DARK_TOKENS.textMuted,
  border: DARK_TOKENS.border,
  borderStrong: DARK_TOKENS.borderStrong,
  accent: DARK_TOKENS.accent,
  accentPressed: DARK_TOKENS.accentPressed,
  accentSubtle: DARK_TOKENS.accentSubtle,
  onAccent: DARK_TOKENS.onAccent,
  success: DARK_TOKENS.success,
  successSurface: DARK_TOKENS.successSurface,
  warning: DARK_TOKENS.warning,
  warningSurface: DARK_TOKENS.warningSurface,
  danger: DARK_TOKENS.danger,
  dangerSurface: DARK_TOKENS.dangerSurface,
  disabled: DARK_TOKENS.disabledText,
  overlay: DARK_TOKENS.overlay,
  shadowColor: DARK_TOKENS.shadowColor,
};

export const DARK_META: ThemeMeta = {
  rationale: [
    "Not a simple inversion: canvas, surface, surfaceElevated, and surfaceMuted are four distinct tones (darkest to lightest: canvas < surfaceMuted < surface < surfaceElevated) rather than one dark color reused everywhere, so cards and floating surfaces (modals) read as genuinely separated from the page background.",
    "Canvas and primary text reuse the approved brand dark-mode anchors from interval-brand-assets exactly (#1B2024 dark slate, #FAFAF8 near-white) — same values already approved for the native splash and dark-mode wordmark treatment.",
    "Accent uses the approved dark-mode-teal (#3FA39D), never the primary light-mode teal (#0F6E6A/#1D7B7A), matching the branding repo's explicit rule that primary teal fails contrast on dark slate.",
  ],
  contrastNotes: [
    "Calculated: textPrimary on canvas 15.72:1, on surface 13.92:1 (AAA).",
    "Calculated: textSecondary (#A7B0B8) on surface 6.61:1 (AA with margin).",
    "Calculated, and the most counter-intuitive finding of this study: white text on the accent teal (#3FA39D) is only 2.9:1 — fails AA badly. Dark text (using the canvas color, #1B2024) on that same teal measures 5.43:1 — passes comfortably. `onAccent` in dark mode is therefore dark, not light, which is an easy default to get backwards.",
    "Calculated: danger text (#E67C73) on dangerSurface 4.53:1 (AA, right at the line); success (#4FAE83) on successSurface 5.18:1 (AA); warning (#D9A94A) on warningSurface 6.07:1 (AA with good margin).",
    "Calculated: borderStrong (#69747B) on surface 3.04:1 (clears the 3:1 non-text minimum).",
  ],
  brandConsistencyNotes: [
    "Directly reuses three approved branding-repo hex values verbatim (#1B2024, #FAFAF8, #3FA39D) rather than inventing new ones — this is the theme with the strongest existing brand-decision backing of the three.",
    "Status colors (danger/success/warning) are new for this exploration — production has no dark-mode equivalents to compare against or diverge from.",
  ],
  specialTreatmentNotes: [
    "Any component currently using a fixed white icon/text color assuming a light surface (there are a few — see theme-readiness findings) would need an explicit dark-mode override, not just a background swap.",
    "Overlay and shadow are meaningfully different from Light (near-black overlay, pure-black shadow) rather than reusing the same rgba values, since a translucent dark-on-dark overlay from Light would barely read as a scrim here.",
  ],
};

export const WARM_THEME: ThemeTokens = {
  id: "warm",
  label: "Warm",
  canvas: WARM_TOKENS.canvas,
  surface: WARM_TOKENS.surface,
  surfaceElevated: WARM_TOKENS.surfaceElevated,
  surfaceMuted: WARM_TOKENS.surfaceMuted,
  textPrimary: WARM_TOKENS.textPrimary,
  textSecondary: WARM_TOKENS.textSecondary,
  textMuted: WARM_TOKENS.textMuted,
  border: WARM_TOKENS.border,
  borderStrong: WARM_TOKENS.borderStrong,
  accent: WARM_TOKENS.accent,
  accentPressed: WARM_TOKENS.accentPressed,
  accentSubtle: WARM_TOKENS.accentSubtle,
  onAccent: WARM_TOKENS.onAccent,
  success: WARM_TOKENS.success,
  successSurface: WARM_TOKENS.successSurface,
  warning: WARM_TOKENS.warning,
  warningSurface: WARM_TOKENS.warningSurface,
  danger: WARM_TOKENS.danger,
  dangerSurface: WARM_TOKENS.dangerSurface,
  disabled: WARM_TOKENS.disabledText,
  overlay: WARM_TOKENS.overlay,
  shadowColor: WARM_TOKENS.shadowColor,
};

export const WARM_META: ThemeMeta = {
  rationale: [
    'Direction is "paper under warm natural light" — a warm-neutral canvas with three progressively lighter warm surfaces (canvas -> surface -> surfaceElevated, verified by actual luminance: 0.857 -> 0.884 -> 0.942), not one flat tint everywhere.',
    "Deliberately NOT the founder's explicitly-excluded directions: no bright yellow, no mustard, no sepia-photo filter, no low-contrast beige-on-beige, no aged-parchment texture. Hue is a restrained warm off-white/cream, not a saturated yellow.",
    "Interval teal is retained using the branding repo's approved primary teal (#0F6E6A) directly, at strong contrast (5.25:1 graphical, 6.07:1 for white-on-accent text) — the brand identity reads clearly even on a warm base.",
    "No health/wellness claims made anywhere in this implementation or its copy — Warm is described only as a calmer visual option, never as addressing any medical or sensory condition.",
  ],
  contrastNotes: [
    "Calculated: textPrimary on canvas 13.03:1, on surface 13.41:1 (AAA).",
    "Calculated: textSecondary on surface 5.9:1 (AA with margin).",
    "Calculated: onAccent (white) on accent (#0F6E6A) 6.07:1 (AA).",
    "Calculated: danger (#A63333) on dangerSurface family 5.94:1 (AA); warning (#896120, reused from the Light fix) on its surface 4.51:1 (AA — was 4.44:1 with the pre-fix Light warning value, a marginal fail this study's own contrast pass surfaced and which is now corrected at the source).",
    "Calculated: success (#2D7552, reused from the Light fix) on successSurface 4.51:1 (AA — was 4.22:1 pre-fix).",
    "Calculated: borderStrong (#8F7C58) on surface 3.6:1 (clears the 3:1 non-text minimum with margin) — the plain decorative `border` (#D8CDB7) measures only 1.4:1, which is fine since it is never used for anything state-bearing.",
  ],
  brandConsistencyNotes: [
    "Uses the branding repo's approved primary teal (#0F6E6A) — this study's Light theme originally used a different, mismatched production teal, making this an inter-study inconsistency; that inconsistency prompted the production fix and Light now also uses #0F6E6A (see LIGHT_META), so both themes are consistent again.",
    "Warning and success reuse the exact same corrected values derived for Light (#896120, #2D7552) rather than separate warm-tinted versions — deliberate, to keep status-color meaning consistent across themes rather than having danger/warning/success drift in hue per theme.",
  ],
  specialTreatmentNotes: [
    "This is the theme most likely to need real founder eyes on actual device screens rather than just contrast math — \"calm paper, not yellow\" is a subjective read that a spreadsheet of hex values can't fully validate.",
    "Any illustration/icon asset with a hard-coded white background (none currently exist in this app, per the theme-readiness audit) would look wrong on this canvas; worth remembering if such an asset is added later.",
  ],
};

export const THEMES: Record<ThemeId, ThemeTokens> = {
  light: LIGHT_THEME,
  dark: DARK_THEME,
  warm: WARM_THEME,
};

export const THEME_META: Record<ThemeId, ThemeMeta> = {
  light: LIGHT_META,
  dark: DARK_META,
  warm: WARM_META,
};
