import type { ResolvedTheme } from "./types";

// The two approved startup-animation treatments (branding/motion/founder-motion-notes.md,
// "Founder decisions formalized here" — production lock). See src/ui/BrandStartup.tsx for the
// actual asset/color values each one renders.
export type StartupTreatment = "light" | "dark";

// Centralized, typed mapping — the single place that decides which approved startup treatment a
// resolved production theme uses. Warm has no approved startup treatment of its own (no such
// asset exists anywhere in the branding repository — confirmed by exhaustive search) and maps to
// Light; production's own resolved theme still becomes Warm as soon as the startup overlay fades
// away, per the explicit product requirement that Warm never shows an intermediate Light screen.
// BrandStartup must call this itself (see its own useTheme()/useAppearanceState() call) rather
// than receive a treatment computed elsewhere and handed down as a prop — a value computed once,
// upstream, and frozen at the moment a parent decided to mount BrandStartup is exactly the kind
// of staleness this batch's report identifies as a risk. See that report, Phase B/E.
export function startupTreatmentFor(resolvedTheme: ResolvedTheme): StartupTreatment {
  return resolvedTheme === "dark" ? "dark" : "light";
}
