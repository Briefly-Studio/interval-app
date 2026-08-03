// Theme Lab — semantic token definitions.
//
// This module is completely isolated from src/ui/theme.ts (production's real, single, light-only
// token file). Nothing here is imported by any production screen or component. It exists purely
// so the theme-lab preview (app/theme-lab.tsx, dev-only) can render the same mock interface under
// four different visual studies side by side.
//
// Contrast ratios quoted in `contrastNotes` below were computed with the standard WCAG relative-
// luminance formula (sRGB linearize -> 0.2126R+0.7152G+0.0722B -> (L1+0.05)/(L2+0.05)), the same
// method already used in interval-brand-assets/branding/scripts/contrast.py. Ratios are stated
// only where they were actually calculated — this file does not claim formal WCAG compliance
// anywhere a number isn't backed by a real calculation.

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
  canvas: "#F7F8FA",
  surface: "#FFFFFF",
  surfaceElevated: "#FFFFFF",
  surfaceMuted: "#F0F2F5",
  textPrimary: "#1B2430",
  textSecondary: "#5B6572",
  textMuted: "#7C8794",
  border: "#E1E4E8",
  borderStrong: "#7F8D96",
  accent: "#1D7B7A",
  accentPressed: "#175F5E",
  accentSubtle: "#E3F3F2",
  onAccent: "#FFFFFF",
  success: "#2F7A55",
  successSurface: "#E3F0EA",
  warning: "#8A6220",
  warningSurface: "#F7EEDF",
  danger: "#B03939",
  dangerSurface: "#FBEAEA",
  disabled: "#A9B2BA",
  overlay: "rgba(15, 23, 32, 0.45)",
  shadowColor: "#0F1720",
};

export const LIGHT_META: ThemeMeta = {
  rationale: [
    "Baseline is the existing approved beta visual language (src/ui/theme.ts), essentially unchanged — this is the theme users already have today, not a new design.",
    "Restrained teal, near-white canvas, clear card hierarchy via a hairline border + barely-there shadow, no gradients or glassmorphism — matches the current calm, serious study-product tone.",
  ],
  contrastNotes: [
    "Calculated: textPrimary on canvas 14.73:1, textPrimary on surface 15.65:1 (AAA, unchanged from production).",
    "Calculated: textSecondary on surface 5.92:1 (AA, unchanged from production).",
    "Calculated: onAccent (#FFFFFF) on accent (#1D7B7A) 5.04:1 (AA).",
    "Calculated: danger text (#B03939, adjusted — see brand-consistency notes) on dangerSurface 5.17:1 (AA).",
    "Calculated: warning text (#8A6220, adjusted) on warningSurface 4.74:1 (AA), and 5.46:1 on plain white.",
    "Calculated: success (#2F7A55, adjusted) on white 5.2:1 (AA); on successSurface ~4.4:1 — just under the 4.5:1 AA threshold for normal text, close enough that it reads as a minor future tuning item, not treated as compliant here.",
  ],
  brandConsistencyNotes: [
    "Production's current accent (colors.accent = #2FA4A3) does not match interval-brand-assets' approved primary teal (#0F6E6A) — this theme reuses production's actual rendered button color (colors.accentStrong = #1D7B7A) as `accent`, since that is what Button.tsx and ProgressBar.tsx actually paint, not the more decorative #2FA4A3. Worth a future decision on whether Light should converge on the branding repo's #0F6E6A the way Warm does in this study.",
    "Production's current `danger` (#C24444) and `warning` (#B8863B) fail AA (4.3:1 and 2.8:1 respectively) when paired with their own tinted surfaces, and `warning` also fails against plain white (3.23:1). This theme study uses darker text-safe variants (#B03939, #8A6220) instead — a real, pre-existing gap this exploration surfaced, not something introduced by it.",
    "Production's `borderStrong` (#C7CCD1) measures only 1.62:1 on white — below the 3:1 non-text minimum for a state-bearing border. This study uses #7F8D96 instead (3.41:1), which is also literally the branding repo's own published `state-bearing-border` token value.",
  ],
  specialTreatmentNotes: [
    "None — this is the least risky of the three studies since it's closest to shipped production.",
  ],
};

export const DARK_THEME: ThemeTokens = {
  id: "dark",
  label: "Dark",
  canvas: "#1B2024",
  surface: "#232A2F",
  surfaceElevated: "#2B333A",
  surfaceMuted: "#20262A",
  textPrimary: "#FAFAF8",
  textSecondary: "#A7B0B8",
  textMuted: "#7A838A",
  border: "#333B41",
  borderStrong: "#69747B",
  accent: "#3FA39D",
  accentPressed: "#368F8A",
  accentSubtle: "#16302E",
  onAccent: "#1B2024",
  success: "#4FAE83",
  successSurface: "#16302A",
  warning: "#D9A94A",
  warningSurface: "#3A2F1A",
  danger: "#E67C73",
  dangerSurface: "#3A1F1E",
  disabled: "#5A6268",
  overlay: "rgba(0, 0, 0, 0.6)",
  shadowColor: "#000000",
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
  canvas: "#F5EEDC",
  surface: "#FAF1DB",
  surfaceElevated: "#FFF8E8",
  surfaceMuted: "#EFE6D0",
  textPrimary: "#292620",
  textSecondary: "#625C50",
  textMuted: "#8A8272",
  border: "#D8CDB7",
  borderStrong: "#8F7C58",
  accent: "#0F6E6A",
  accentPressed: "#0C5854",
  accentSubtle: "#E1EFEC",
  onAccent: "#FFFFFF",
  success: "#2F7A55",
  successSurface: "#E3EAD9",
  warning: "#8A6220",
  warningSurface: "#F2E7CE",
  danger: "#A63333",
  dangerSurface: "#F6E2DC",
  disabled: "#A79A82",
  overlay: "rgba(41, 38, 32, 0.45)",
  shadowColor: "#3A3226",
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
    "Calculated: danger (#A63333) on dangerSurface family 5.94:1 (AA); warning (#8A6220, reused from the Light fix) on its surface 4.85:1 (AA).",
    "Calculated: borderStrong (#8F7C58) on surface 3.6:1 (clears the 3:1 non-text minimum with margin) — the plain decorative `border` (#D8CDB7) measures only 1.4:1, which is fine since it is never used for anything state-bearing.",
  ],
  brandConsistencyNotes: [
    "Uses the branding repo's approved primary teal (#0F6E6A) rather than production's current app accent (#2FA4A3/#1D7B7A family) — the opposite choice from this study's Light theme, which kept production's existing (non-branding-repo-matching) teal. This inconsistency between studies is itself worth a founder decision: should Light eventually converge on #0F6E6A too?",
    "Warning and success reuse the exact same corrected values derived for Light (#8A6220, #2F7A55) rather than separate warm-tinted versions — deliberate, to keep status-color meaning consistent across themes rather than having danger/warning/success drift in hue per theme.",
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
