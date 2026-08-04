import type { AppearanceMode, ResolvedTheme, SystemScheme } from "./types";

// The two approved startup-animation treatments (branding/motion/founder-motion-notes.md,
// "Founder decisions formalized here" — production lock). See src/ui/BrandStartup.tsx for the
// actual asset/color values each one renders.
export type StartupTreatment = "light" | "dark";
// The bridge is the very first React Native frame — the one that must visually match whichever
// native splash variant iOS/Android actually displayed (see startupBridgeFor below for when that
// can and can't be guaranteed). Same two values as StartupTreatment; kept as a distinct type so a
// future StartupBridge-only field can never be silently confused with StartupTreatment at the
// type level even though today they happen to share a shape.
export type StartupBridge = "light" | "dark";

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

// Centralized, typed mapping for the FIRST React Native frame — the one that must match whichever
// native splash variant iOS/Android actually displayed. This is deliberately a function of
// `selectedMode` FIRST, `systemScheme` only when the mode is "system" — not of `systemScheme`
// alone. A previous cut derived the bridge purely from systemScheme regardless of selectedMode,
// which meant an explicit Light or Warm selection on a phone with OS-level Dark Mode enabled
// would show a Dark bridge frame before crossfading into the correct Light treatment — a real,
// deterministic bug (not a timing race): systemScheme reflects the PHONE, selectedMode reflects
// Interval's own saved preference, and once JavaScript is ready and that preference is known, the
// explicit choice must win outright, never merely follow the phone. See this batch's report for
// the full trace of the founder-observed "teal splash -> brief Dark frame -> Light animation"
// sequence this replaces.
//
//   system + light system scheme -> light bridge
//   system + dark  system scheme -> dark bridge
//   light  (any system scheme)   -> light bridge
//   dark   (any system scheme)   -> dark bridge
//   warm   (any system scheme)   -> light bridge (Warm has no bridge of its own, same as its
//                                    startup treatment — see startupTreatmentFor above)
//
// Native-level mismatches (e.g. phone Dark + explicit Light, so the OS still shows a Dark native
// splash before JS can influence anything) remain possible and are a known, documented native
// limitation (see src/ui/BrandStartup.tsx) — this function controls only the React Native bridge
// frame that follows, which is the one thing JS actually has authority over.
export function startupBridgeFor(selectedMode: AppearanceMode, systemScheme: SystemScheme): StartupBridge {
  if (selectedMode === "system") return systemScheme;
  return selectedMode === "dark" ? "dark" : "light";
}
