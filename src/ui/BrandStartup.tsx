import { Asset } from "expo-asset";
import { useCallback, useEffect, useRef } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { getAccessibilityPreferences } from "../accessibility/accessibilityPreferences";
import { startupBridgeFor, startupTreatmentFor, useTheme, type StartupTreatment } from "@/src/theme";

// Approved app-icon-background token (#0F7A75) — matches app.json's expo-splash-screen
// LIGHT-appearance config verbatim. Kept as a named export for anything that still wants "the
// brand teal", but the bridge itself is no longer hardcoded to it — see BRIDGE_TREATMENTS below.
const BRIDGE_TEAL = "#0F7A75";
export const BRAND_STARTUP_TEAL = BRIDGE_TEAL;

// Native splash's own calibrated mark size (app.json's expo-splash-screen imageWidth) — the
// bridge frame below uses this exact square box (for either variant) so its first frame is
// pixel-identical to whichever native splash variant iOS/Android actually displayed. Also used to
// derive MARK_DISPLAY_SCALE further down, which sizes the (differently-shaped) treatment mark
// crops to match this same on-screen glyph height.
const ORIGINAL_MARK_SIZE = 180;

// The native splash is adaptive (app.json's expo-splash-screen "dark" config — see this batch's
// report, Phase 2), using the OS's OWN system-appearance signal (the only thing native launch
// resources can observe — they cannot read Interval's persisted Light/Dark/Warm override, which
// lives in JS/AsyncStorage and isn't available until React Native starts). The two possible native
// splash variants:
//   Light-system native splash (unchanged, pre-existing): #0F7A75 teal background, white mark.
//   Dark-system native splash: #1B2024 background, mark recolored to #3FA39D — same source
//     geometry as the white mark (assets/images/splash-icon-dark.png is a pixel-for-pixel recolor
//     of splash-icon.png; alpha channel and bounding box verified byte-identical, only RGB
//     changed — no redrawing), so ORIGINAL_MARK_SIZE applies unchanged to both variants.
// Which of these two this component's OWN bridge frame renders is decided by startupBridgeFor()
// (src/theme/startupTreatment.ts) — a function of BOTH `selectedMode` and `systemScheme`, not
// `systemScheme` alone (see the `bridge` derivation below for why that distinction matters).
const BRIDGE_TREATMENTS: Record<"light" | "dark", { background: string; markSource: number }> = {
  light: { background: BRIDGE_TEAL, markSource: require("../../assets/images/splash-icon.png") },
  dark: { background: "#1B2024", markSource: require("../../assets/images/splash-icon-dark.png") },
};

// Approved startup-animation treatments (branding/motion/founder-motion-notes.md, "Founder
// decisions formalized here" — production lock, not an open comparison):
//   Light: #0F6E6A mark, #0F6E6A "nterval", near-white (#FAFAF8) background.
//   Dark (Treatment B, branded mark emphasis): #3FA39D mark, #FAFAF8 "nterval", #1B2024 background.
// Warm has no approved startup treatment of its own — startupTreatmentFor() (src/theme/
// startupTreatment.ts) maps a resolved Warm theme to "light" here, landing directly into the real
// Warm interface once this layer fades. Mark/word colors are baked into the source PNGs
// themselves (mechanically cropped from the approved lockup exports, see MARK_SOURCES/
// NTERVAL_SOURCES below), not applied here — `background` is the one color actually set by this
// file, and both values are the branding repo's own token hex (near-white / dark-slate,
// branding/tokens/palette.json), not invented.
const TREATMENTS: Record<StartupTreatment, { background: string }> = {
  light: { background: "#FAFAF8" },
  dark: { background: "#1B2024" },
};

// ---- Timing (tune here) ----
// Beat 0: the "bridge" — a frame pixel-identical to the native splash (teal bg, centered white
// mark at the native splash's own size). Exists purely so the native-splash → JS handoff is an
// imperceptible cut: onLayout fires while this bridge frame is showing, so whatever the native
// splash is replaced with is visually identical to it, regardless of which appearance treatment
// is about to follow. See this batch's report, Phase F/G, for why this replaced a direct
// teal-to-treatment cut.
const BRIDGE_HOLD_MS = 150;
// Beat 0.5: the whole surface (background + mark, uniformly) crossfades from the bridge into the
// resolved Light/Dark treatment. A plain opacity crossfade between two full-surface layers, not a
// color interpolation — deliberately simple and restrained, not a "dramatic color morph".
const BRIDGE_CROSSFADE_MS = 220;
const PRE_REVEAL_DELAY_MS = BRIDGE_HOLD_MS + BRIDGE_CROSSFADE_MS; // 370ms
// Beat 1: the mark translates left and becomes the wordmark's "i"; "nterval" reveals alongside.
const REVEAL_MS = 1000;
// Beat 2: hold on the completed, settled wordmark.
const HOLD_LOCKUP_MS = 750;
// Beat 3: whole layer fades away, revealing the app underneath.
const FADE_OUT_MS = 400;
const TOTAL_MS = PRE_REVEAL_DELAY_MS + REVEAL_MS + HOLD_LOCKUP_MS + FADE_OUT_MS; // 2520ms

// Within REVEAL_MS, "nterval" starts appearing partway through the mark's own movement and
// finishes slightly before the mark's movement itself settles (reveal starts ~20–30% in,
// completes ~85–95% in). Expressed as fractions of REVEAL_MS.
const NTERVAL_REVEAL_START_FRAC = 0.25;
const NTERVAL_REVEAL_END_FRAC = 0.9;
const NTERVAL_DELAY_MS = PRE_REVEAL_DELAY_MS + REVEAL_MS * NTERVAL_REVEAL_START_FRAC; // 620ms
const NTERVAL_REVEAL_DURATION_MS = REVEAL_MS * (NTERVAL_REVEAL_END_FRAC - NTERVAL_REVEAL_START_FRAC); // 650ms

// ---- Timing — reduced-motion sequence (shorter than the standard sequence, never spatial) ----
// Reduced motion still plays the same bridge beat (Beat 0/0.5 above, shared with standard motion
// — this is necessary handoff infrastructure, not decorative motion, so it is not skipped), then
// a brief hold on the centered treatment-colored mark, then a plain crossfade into the already-
// settled final frame (mark + full "nterval"), then a hold, then fades out.
const REDUCED_HOLD_MARK_MS = 100;
const REDUCED_CROSSFADE_MS = 220;
const REDUCED_HOLD_LOCKUP_MS = 500;
const REDUCED_FADE_OUT_MS = 300;
const REDUCED_TOTAL_MS =
  PRE_REVEAL_DELAY_MS + REDUCED_HOLD_MARK_MS + REDUCED_CROSSFADE_MS + REDUCED_HOLD_LOCKUP_MS + REDUCED_FADE_OUT_MS; // 1490ms

// Founder QA on an earlier cut flagged the reveal as reading like "one image replacing another,"
// too fast, without genuine ease-in. The approved brand global easing
// (branding/motion/motion-spec.md — cubic-bezier(.22,.61,.36,1)) is a *decelerating* curve with
// very little ease-in (its early tangent is already fast), which is exactly the "abrupt
// beginning" that was flagged. Reanimated's built-in symmetric ease-in-out cubic gives a genuine
// gentle start and soft settle on both ends, matching the founder's explicit request — used here
// instead of the brand curve for that reason. The brand curve (Easing.bezier(0.22, 0.61, 0.36, 1))
// remains a good fit for any future beat that specifically wants a decelerate-only feel (e.g. a
// hard stop), just not this one.
const MOTION_EASING = Easing.inOut(Easing.cubic);

// ---- Lockup anchor geometry ----
// Derived from the approved integrated-lockup SVG source
// (branding/wordmark/integrated/interval-integrated-lockup-dark.svg):
//   <svg viewBox="0 0 6609.53 1538.00">
//     <g transform="translate(-569.552,-165.819) scale(28.838095)">   <!-- the mark -->
//       <path d="M24,54 L24,34 L40,26 L40,10" .../>
//     </g>
//     <g transform="translate(816.533,0.000)"> ... "nterval" outlines ... </g>
// Mapping the mark's approved visible-bounds box (x:19.75–44.25, y:5.75–58.25, 64-unit grid)
// through that transform gives the mark's own bounding box *within the full lockup image*:
// width ≈ 10.69% of the lockup's width, height ≈ 98.44% of the lockup's height, centered at
// (5.34%, 49.22%) of the lockup, i.e. offset (-44.66%, -0.78%) from the lockup's own center.
const LOCKUP_ASPECT = 1538.0 / 6609.53; // height / width of the full lockup image
const LOCKUP_FINAL_WIDTH = 280; // kept as-is this iteration, per instruction
const LOCKUP_FINAL_HEIGHT = LOCKUP_FINAL_WIDTH * LOCKUP_ASPECT;

// Mark's final position/scale within that settled LOCKUP_FINAL_WIDTH frame, offset from screen
// center (screen center is where the mark sits throughout the bridge phase, matching the native
// splash exactly).
const MARK_FINAL_TRANSLATE_X = LOCKUP_FINAL_WIDTH * (0.053448 - 0.5); // ≈ -125.03
const MARK_FINAL_TRANSLATE_Y = LOCKUP_FINAL_HEIGHT * (0.492198 - 0.5); // ≈ -0.51
// Scale needed so the mark's own ink shrinks from its native-splash size (46%-height-fraction
// Candidate B proportions, per branding/splash/manifest.json) down to its correct, smaller size
// within the settled wordmark (10.69%/98.44% of a 280pt-wide lockup) — a real but modest ~23%
// reduction, intentionally subordinate to (driven by the same progress value/easing as) the
// horizontal translation, never animated independently.
const MARK_FINAL_SCALE = 0.7736;

// "nterval" and mark crops: both derived mechanically from the approved
// assets/images/interval-lockup-{light,dark}.png exports (2400×558, byte-identical to
// interval-brand-assets/branding/wordmark/integrated/interval-integrated-lockup-{light,dark}-2400.png,
// verified by sha256), split at a single shared boundary (x=262) into a left "mark" crop and a
// right "nterval" crop — a straight rectangular pixel copy, no redrawing, no recompression, no
// color change. The boundary sits ~5px to the right of the mark's own mathematical right edge
// (ink measured, alpha-scan, at x=257 in both the light and dark lockup — identical geometry,
// confirmed pixel-for-pixel) specifically to clear a faint sub-pixel anti-aliasing remnant of the
// mark's own stroke; ~34px of the approved 110-design-unit mark↔word gap remains as transparent
// padding before "n" begins, so this boundary does not touch any letter. See this batch's report
// for the full derivation and the pixel-alpha scan that confirmed both lockups share identical
// geometry.
const NTERVAL_SOURCES: Record<StartupTreatment, number> = {
  light: require("../../assets/images/interval-lockup-light-nterval-only.png"),
  dark: require("../../assets/images/interval-lockup-dark-nterval-only.png"),
};
const NTERVAL_CROP_ASPECT = 558 / 2138; // height / width of the cropped asset itself
const NTERVAL_FINAL_TRANSLATE_X = LOCKUP_FINAL_WIDTH * (262 / 2400 - 0.5); // ≈ -109.43, left edge offset from screen center
const NTERVAL_FINAL_WIDTH = LOCKUP_FINAL_WIDTH * (1 - 262 / 2400); // ≈ 249.43
const NTERVAL_FINAL_HEIGHT = NTERVAL_FINAL_WIDTH * NTERVAL_CROP_ASPECT; // preserves the crop's own aspect, ≈65.1

const MARK_SOURCES: Record<StartupTreatment, number> = {
  light: require("../../assets/images/interval-lockup-light-mark-only.png"),
  dark: require("../../assets/images/interval-lockup-dark-mark-only.png"),
};

// Unlike splash-icon.png (1024×1024, glyph inset within a lot of transparent padding), the mark
// crops above (262×558) are tightly cropped to the lockup's own mark column, so the glyph nearly
// fills the crop canvas. Rendering them at the old square ORIGINAL_MARK_SIZE would both distort
// the aspect ratio (262:558 forced into 1:1) and make the glyph read far larger than the bridge
// frame's own calibrated size. This derives a non-square display box that (a) preserves the
// crop's true aspect ratio (no distortion) and (b) reproduces the exact on-screen glyph height
// the bridge frame already uses, so the bridge→treatment crossfade holds the glyph's size and
// position steady and only its color/shape-padding changes — see this batch's report, Phase F,
// "mark-alignment correction" (branding/splash/manifest.json's measured.glyphBBoxHeightPx=472,
// alpha-scanned ink height of the new crop=550px).
const MARK_CROP_WIDTH = 262;
const MARK_CROP_HEIGHT = 558;
const MARK_CROP_INK_HEIGHT = 550; // alpha>10 scan of interval-lockup-{light,dark}-mark-only.png, identical for both
const ORIGINAL_GLYPH_HEIGHT_PX = 472; // branding/splash/manifest.json measured.glyphBBoxHeightPx
const ORIGINAL_CANVAS_PX = 1024;
const TARGET_GLYPH_HEIGHT = ORIGINAL_GLYPH_HEIGHT_PX * (ORIGINAL_MARK_SIZE / ORIGINAL_CANVAS_PX); // ≈82.97, bridge frame's own displayed glyph height
const MARK_DISPLAY_SCALE = TARGET_GLYPH_HEIGHT / MARK_CROP_INK_HEIGHT;
const MARK_BOX_WIDTH = MARK_CROP_WIDTH * MARK_DISPLAY_SCALE; // ≈39.52
const MARK_BOX_HEIGHT = MARK_CROP_HEIGHT * MARK_DISPLAY_SCALE; // ≈84.18
// MARK_FINAL_SCALE above is a ratio (glyph-at-rest / glyph-settled), independent of which source
// asset represents "at rest" as long as its displayed glyph height matches TARGET_GLYPH_HEIGHT —
// which MARK_DISPLAY_SCALE guarantees by construction — so it needs no adjustment here.

// Best-effort, fire-and-forget prefetch of every mark/word PNG this component can possibly need,
// kicked off at module-evaluation time (as early as this file is first imported by app/_layout.tsx
// — before BrandStartup ever mounts). This is defense-in-depth for the mark/word IMAGES' own
// decode timing, not for the opacity-coverage guarantee itself: the bridge and treatment
// BACKGROUNDS are plain solid colors applied directly to an always-opaque root (see
// styles.container below and its inline backgroundColor), so screen coverage never depends on
// whether an Image has finished decoding. Deliberately not awaited anywhere and never gates the
// native-splash-hide signal — a slow or failed prefetch just means the mark/word may pop in a few
// ms after an already-opaque, correctly-colored frame is on screen, never a transparent gap.
const DEV = typeof __DEV__ !== "undefined" && __DEV__;
const MODULE_LOADED_AT = Date.now();

Asset.loadAsync([
  BRIDGE_TREATMENTS.light.markSource,
  BRIDGE_TREATMENTS.dark.markSource,
  MARK_SOURCES.light,
  MARK_SOURCES.dark,
  NTERVAL_SOURCES.light,
  NTERVAL_SOURCES.dark,
])
  .then(() => {
    if (DEV) console.log(`[startup] +${Date.now() - MODULE_LOADED_AT}ms (since module load) startup assets ready`);
  })
  .catch(() => {});

// Development-only, removable timestamp instrumentation for diagnosing the brief flash/abrupt
// transition founder QA observed during the native-splash → runtime handoff. Logs elapsed ms
// since this BrandStartup instance mounted (not wall-clock time) so gaps between milestones are
// immediately readable in Metro logs without doing date arithmetic. Never logs secrets or user
// data — only milestone names and millisecond offsets. See this batch's report, Phase 2E.
function startupLog(mountedAt: number, milestone: string) {
  if (!DEV) return;
  console.log(`[startup] +${Date.now() - mountedAt}ms`, milestone);
}

type BrandStartupProps = {
  // Called exactly once, as soon as this layer's first real native layout is confirmed (via
  // onLayout, with a bounded fallback — see effect below). This is the *only* signal app/
  // _layout.tsx uses to decide it is safe to hide the native splash screen, specifically so the
  // native splash is never dismissed before this layer has a confirmed, laid-out bridge frame
  // ready to take over — see this batch's report, Phase A/D.
  onReady?: () => void;
  // Called exactly once, guaranteed, when the whole startup sequence is finished and the layer
  // should be unmounted. Driven by a plain timer independent of whether the visual animation
  // itself completes without error, so the overlay can never get stuck on screen.
  onFinished?: () => void;
};

// Bridge frame → uniform whole-surface crossfade into the resolved Light/Dark treatment → mark →
// wordmark reveal → hold → fade to the app. The standalone mark is a single, continuously-visible
// element throughout the reveal (never faded out/replaced there) that translates left and scales
// down slightly into its exact position as the wordmark's own "i"; "nterval" is a separately-
// cropped, mechanically-derived asset that reveals in beside it via a growing clip window, not by
// fading in a second copy of the whole lockup. No mark drawing, no morph, no looping motion.
export function BrandStartup({ onReady, onFinished }: BrandStartupProps) {
  // Derived directly from the canonical appearance store (src/theme/index.ts), not received as a
  // prop computed once by a parent — this is what makes BrandStartup itself just another
  // consumer of the same single source of truth every other themed surface in the app reads, per
  // this batch's report, Phase B. isInitialized gates whether app/_layout.tsx mounts this
  // component at all (see app/_layout.tsx), so selectedMode/resolvedTheme here are always already
  // the real, confirmed values by the time this ever renders.
  const { selectedMode, resolvedTheme, systemScheme } = useTheme();
  const treatment = startupTreatmentFor(resolvedTheme);
  const markSource = MARK_SOURCES[treatment];
  const ntervalSource = NTERVAL_SOURCES[treatment];
  const treatmentBackground = TREATMENTS[treatment].background;

  // Which bridge frame to show first. A PREVIOUS cut derived this from `systemScheme` alone
  // (matching whatever native splash variant the OS happened to display) — that was correct only
  // for System mode, and produced a real, deterministic bug for explicit Light/Warm on a phone
  // with OS-level Dark Mode on: the bridge would show Dark (matching the phone) even though the
  // user's own saved preference — known and final by the time BrandStartup ever mounts — was
  // Light or Warm, producing a spurious Dark frame before the correct Light treatment appeared.
  // startupBridgeFor() fixes this by consulting `selectedMode` first: only "system" still follows
  // the phone; every explicit mode picks its own bridge outright, matching the required product
  // rule (explicit Light/Warm never show a Dark bridge; explicit Dark never shows a Light bridge)
  // — see src/theme/startupTreatment.ts for the full mapping and this batch's report for the trace.
  const bridgeKey = startupBridgeFor(selectedMode, systemScheme);
  const bridge = BRIDGE_TREATMENTS[bridgeKey];

  // ---- Bridge phase ----
  // bridgeOpacity: the pixel-identical-to-native-splash frame. 1 throughout the bridge hold, then
  // crosses to 0 during the bridge→treatment crossfade, then stays 0.
  const bridgeOpacity = useSharedValue(1);
  // treatmentOpacity: the resolved treatment's own full-surface background. 0 throughout the
  // bridge hold, then crosses to 1 during the same crossfade, then stays 1. Shared by both motion
  // paths — only the background layer and (in standard motion only) the moving mark use it
  // directly; reduced motion's own mark crossfade is driven by centeredMarkOpacity/markOpacity
  // below instead, on their own separate timeline.
  const treatmentOpacity = useSharedValue(0);

  // Drives the mark's translateX/Y/scale in standard motion. Set directly to 1 (no animation) in
  // reduced motion, since the moving-mark element is reused as reduced motion's "final" frame.
  const revealProgress = useSharedValue(0);
  // Moving-mark opacity. Standard motion: rises with treatmentOpacity's own timeline (0→1 during
  // the bridge crossfade), then stays 1 — the mark is continuously visible for the entire reveal,
  // per founder direction ("the original mark remains visually continuous"). Reduced motion: 0
  // until the existing centered→final crossfade later in the sequence.
  const markOpacity = useSharedValue(0);
  // Reduced-motion-only: the centered, treatment-colored mark frame that the bridge crossfades
  // into, holds on, then itself crossfades away from into the settled final frame.
  const centeredMarkOpacity = useSharedValue(0);
  const ntervalOpacity = useSharedValue(0);
  const ntervalClipWidth = useSharedValue(0);
  const containerOpacity = useSharedValue(1);

  const readyRef = useRef(false);
  const startedRef = useRef(false);
  const finishedRef = useRef(false);
  const reduceMotionRef = useRef<boolean | null>(null);
  const layoutConfirmedRef = useRef(false);
  // Captured once, at the first render — the reference point every startupLog() call below
  // measures elapsed time from. See startupLog()'s own doc comment (Phase 2E flash instrumentation).
  const mountedAtRef = useRef(Date.now());

  useEffect(() => {
    // One concise, greppable line covering the full decision chain — the exact shape this batch's
    // report specifies, so a founder (or a future debugging session) can see at a glance whether
    // `bridge` ever disagrees with `mode` in a way it shouldn't (e.g. mode=warm bridge=dark would
    // be the bug this batch fixes; mode=warm bridge=light is correct).
    startupLog(
      mountedAtRef.current,
      `mode=${selectedMode} system=${systemScheme} resolved=${resolvedTheme} bridge=${bridgeKey} treatment=${treatment}`
    );
    // Logged once, at mount, so the invariant this batch's report proves (every layer starts at
    // an opacity that keeps the combined surface fully opaque) is visible directly in Metro logs,
    // not just asserted in code comments.
    startupLog(
      mountedAtRef.current,
      `initial opacity — root(container)=${containerOpacity.value} bridge=${bridgeOpacity.value} treatment=${treatmentOpacity.value}; ` +
        `root background=${bridge.background} bridge background=${bridge.background} treatment background=${treatmentBackground}`
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    startupLog(mountedAtRef.current, "overlay removed");
    onFinished?.();
  }, [onFinished]);

  const markReady = useCallback(() => {
    if (readyRef.current) return;
    readyRef.current = true;
    startupLog(mountedAtRef.current, "native splash hidden (onReady fired)");
    onReady?.();
  }, [onReady]);

  // Starts the actual visible sequence. Only runs once, and only once both of its two
  // prerequisites are known: the first real native layout has been confirmed (readiness for the
  // native splash to hide, and for this frame to be trusted as "really on screen"), and whether
  // the user has reduced motion enabled. Whichever of the two resolves last calls this.
  const maybeStart = useCallback(() => {
    if (startedRef.current) return;
    if (!layoutConfirmedRef.current) return;
    if (reduceMotionRef.current === null) return;
    startedRef.current = true;

    markReady();

    const reduced = reduceMotionRef.current;

    // Shared bridge → treatment crossfade — identical timing and easing regardless of motion
    // preference, since this is necessary handoff infrastructure (matching the fixed native
    // splash), not decorative motion.
    bridgeOpacity.value = withDelay(BRIDGE_HOLD_MS, withTiming(0, { duration: BRIDGE_CROSSFADE_MS, easing: Easing.linear }));
    treatmentOpacity.value = withDelay(
      BRIDGE_HOLD_MS,
      withTiming(1, { duration: BRIDGE_CROSSFADE_MS, easing: Easing.linear })
    );

    // JS-thread-observable milestones matching the UI-thread-driven Reanimated timeline above —
    // scheduled with the same delay constants, for Phase 2E flash diagnosis. A few ms of drift
    // from the actual UI-thread paint is expected and acceptable for this purpose.
    setTimeout(() => startupLog(mountedAtRef.current, "bridge → treatment crossfade started"), BRIDGE_HOLD_MS);
    setTimeout(
      () => startupLog(mountedAtRef.current, "bridge → treatment crossfade completed"),
      PRE_REVEAL_DELAY_MS
    );
    if (!reduced) {
      setTimeout(() => startupLog(mountedAtRef.current, "wordmark reveal started"), PRE_REVEAL_DELAY_MS);
      setTimeout(
        () => startupLog(mountedAtRef.current, "overlay fade started"),
        PRE_REVEAL_DELAY_MS + REVEAL_MS + HOLD_LOCKUP_MS
      );
    } else {
      setTimeout(
        () => startupLog(mountedAtRef.current, "overlay fade started"),
        PRE_REVEAL_DELAY_MS + REDUCED_HOLD_MARK_MS + REDUCED_CROSSFADE_MS + REDUCED_HOLD_LOCKUP_MS
      );
    }

    if (reduced) {
      // Non-spatial: no translation, no scale, no growing width — after the shared bridge
      // crossfade above reveals the centered treatment-colored mark, a plain opacity crossfade
      // takes it to the already-settled final frame (mark + full "nterval").
      revealProgress.value = 1;
      ntervalClipWidth.value = NTERVAL_FINAL_WIDTH;
      centeredMarkOpacity.value = withSequence(
        withDelay(BRIDGE_HOLD_MS, withTiming(1, { duration: BRIDGE_CROSSFADE_MS, easing: Easing.linear })),
        withDelay(REDUCED_HOLD_MARK_MS, withTiming(0, { duration: REDUCED_CROSSFADE_MS, easing: Easing.linear }))
      );
      markOpacity.value = withDelay(
        PRE_REVEAL_DELAY_MS + REDUCED_HOLD_MARK_MS,
        withTiming(1, { duration: REDUCED_CROSSFADE_MS, easing: Easing.linear })
      );
      ntervalOpacity.value = withDelay(
        PRE_REVEAL_DELAY_MS + REDUCED_HOLD_MARK_MS,
        withTiming(1, { duration: REDUCED_CROSSFADE_MS, easing: Easing.linear })
      );
      containerOpacity.value = withDelay(
        PRE_REVEAL_DELAY_MS + REDUCED_HOLD_MARK_MS + REDUCED_CROSSFADE_MS + REDUCED_HOLD_LOCKUP_MS,
        withTiming(0, { duration: REDUCED_FADE_OUT_MS, easing: Easing.linear })
      );
    } else {
      // The moving mark's opacity mirrors treatmentOpacity's own bridge-crossfade timing exactly
      // (0→1 during BRIDGE_CROSSFADE_MS, then stays 1) — kept as its own value rather than reused
      // directly in the worklet below for clarity, and because reduced motion needs markOpacity
      // to animate on a completely different, later timeline (see the `if (reduced)` branch).
      markOpacity.value = withDelay(BRIDGE_HOLD_MS, withTiming(1, { duration: BRIDGE_CROSSFADE_MS, easing: Easing.linear }));
      revealProgress.value = withDelay(
        PRE_REVEAL_DELAY_MS,
        withTiming(1, { duration: REVEAL_MS, easing: MOTION_EASING })
      );
      ntervalClipWidth.value = withDelay(
        NTERVAL_DELAY_MS,
        withTiming(NTERVAL_FINAL_WIDTH, { duration: NTERVAL_REVEAL_DURATION_MS, easing: MOTION_EASING })
      );
      ntervalOpacity.value = withDelay(
        NTERVAL_DELAY_MS,
        withTiming(1, { duration: NTERVAL_REVEAL_DURATION_MS, easing: MOTION_EASING })
      );
      containerOpacity.value = withDelay(
        PRE_REVEAL_DELAY_MS + REVEAL_MS + HOLD_LOCKUP_MS,
        withTiming(0, { duration: FADE_OUT_MS, easing: MOTION_EASING })
      );
    }

    const total = reduced ? REDUCED_TOTAL_MS : TOTAL_MS;
    setTimeout(finish, total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finish, markReady]);

  // onLayout confirms the YOGA layout pass has computed this view's bounds — it does NOT confirm
  // the native compositor has actually painted this (already-opaque) frame to the screen. Those
  // are two different stages of the render pipeline; treating layout-computed as paint-committed
  // was the structural gap behind the founder-observed decks-screen blink (this batch's report,
  // Phase A). Two nested requestAnimationFrame calls after onLayout is the standard React Native
  // technique for waiting past that gap: the first rAF fires once the current JS frame's changes
  // have been handed to the native side; the second confirms a full subsequent frame has been
  // composited, meaning the first one (carrying this opaque bridge frame) is now genuinely on
  // screen. Only then is it safe to ask the native splash to hide — see handleLayoutConfirmed's
  // own comment and app/_layout.tsx's hideNativeSplash. No magic milliseconds: this is frame-
  // synchronized, and in practice adds at most ~1-2 display refreshes (well under 33ms) to the
  // fixed 150ms bridge hold, imperceptible.
  const onLayoutEventReceivedRef = useRef(false);

  const handleLayoutConfirmed = useCallback(() => {
    if (layoutConfirmedRef.current) return;
    layoutConfirmedRef.current = true;
    startupLog(mountedAtRef.current, "BrandStartup paint confirmed (2x requestAnimationFrame after onLayout)");
    maybeStart();
  }, [maybeStart]);

  const handleLayout = useCallback(() => {
    if (onLayoutEventReceivedRef.current) return;
    onLayoutEventReceivedRef.current = true;
    startupLog(mountedAtRef.current, "BrandStartup laid out (onLayout fired)");
    requestAnimationFrame(() => {
      startupLog(mountedAtRef.current, "first requestAnimationFrame");
      requestAnimationFrame(() => {
        startupLog(mountedAtRef.current, "second requestAnimationFrame — paint confirmed");
        handleLayoutConfirmed();
      });
    });
  }, [handleLayoutConfirmed]);

  useEffect(() => {
    let cancelled = false;

    // Absolute backstops — independent of each other and of everything above — so this layer can
    // never get permanently stuck even if onLayout never fires, the accessibility check never
    // resolves, or any animation callback fails. This one deliberately skips the two-rAF paint
    // confirmation handleLayoutConfirmed() normally requires: if onLayout itself hasn't fired
    // within 500ms, something is already unusual, and getting the app moving forward safely
    // matters more here than one more paint-timing guarantee on top of an already-degraded path.
    const layoutBackstop = setTimeout(() => {
      if (!layoutConfirmedRef.current) {
        layoutConfirmedRef.current = true;
        maybeStart();
      }
    }, 500);
    const reduceMotionBackstop = setTimeout(() => {
      if (reduceMotionRef.current === null) {
        reduceMotionRef.current = getAccessibilityPreferences().reduceMotionOverride;
        maybeStart();
      }
    }, 300);
    const finishBackstop = setTimeout(finish, TOTAL_MS + 500);

    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduced) => {
        if (cancelled) return;
        if (reduceMotionRef.current === null) {
          // Interval's own in-app "reduce motion" override (see Settings → Accessibility) is
          // combined with the OS-level signal here, never in place of it — either one alone is
          // enough to request the reduced treatment. See accessibilityPreferences.ts's own doc
          // comment for why this exists as an additional opt-in rather than replacing the system
          // preference as the default.
          reduceMotionRef.current = reduced || getAccessibilityPreferences().reduceMotionOverride;
          maybeStart();
        }
      });

    return () => {
      cancelled = true;
      clearTimeout(layoutBackstop);
      clearTimeout(reduceMotionBackstop);
      clearTimeout(finishBackstop);
      cancelAnimation(bridgeOpacity);
      cancelAnimation(treatmentOpacity);
      cancelAnimation(revealProgress);
      cancelAnimation(markOpacity);
      cancelAnimation(centeredMarkOpacity);
      cancelAnimation(ntervalOpacity);
      cancelAnimation(ntervalClipWidth);
      cancelAnimation(containerOpacity);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const containerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
  }));

  const bridgeLayerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: bridgeOpacity.value,
  }));

  const treatmentBackgroundAnimatedStyle = useAnimatedStyle(() => ({
    opacity: treatmentOpacity.value,
  }));

  // The continuously-visible, moving mark. In standard motion, markOpacity rises on the same
  // timing as the bridge crossfade (0→1 during BRIDGE_CROSSFADE_MS, then stays 1) and its
  // transform then animates with revealProgress. In reduced motion, its transform is fixed at the
  // settled position/scale from the start and markOpacity instead animates later, on the existing
  // centered→final crossfade's own timeline, independent of the bridge crossfade.
  const movingMarkAnimatedStyle = useAnimatedStyle(() => {
    const translateX = interpolate(revealProgress.value, [0, 1], [0, MARK_FINAL_TRANSLATE_X], Extrapolation.CLAMP);
    const translateY = interpolate(revealProgress.value, [0, 1], [0, MARK_FINAL_TRANSLATE_Y], Extrapolation.CLAMP);
    const scale = interpolate(revealProgress.value, [0, 1], [1, MARK_FINAL_SCALE], Extrapolation.CLAMP);
    return {
      opacity: markOpacity.value,
      transform: [{ translateX }, { translateY }, { scale }],
    };
  });

  // Reduced-motion only: a second, fixed-position mark frame (treatment-colored) that the bridge
  // crossfades into, and that later crossfades away from into the settled final frame.
  const centeredMarkAnimatedStyle = useAnimatedStyle(() => ({
    opacity: centeredMarkOpacity.value,
  }));

  // Clip container: its WIDTH is what animates (0 → NTERVAL_FINAL_WIDTH), revealing the fixed-
  // size image inside it progressively left-to-right, exactly like a wipe — the image itself
  // never scales or stretches. Positioned with left:'50%' + a fixed translateX so its LEFT edge
  // stays pinned in place as its width grows (flex-centering would instead grow it symmetrically
  // from the center, which is not the intended "letters growing out to the right" reveal).
  const ntervalClipAnimatedStyle = useAnimatedStyle(() => ({
    opacity: ntervalOpacity.value,
    width: ntervalClipWidth.value,
  }));

  return (
    <Animated.View
      // backgroundColor is set directly on this ROOT view (not left to the first child layer
      // below) so the surface is opaque and correctly colored from this component's very first
      // paint, independent of child-layer paint ordering — see this batch's report, Phase C/D,
      // for why relying solely on a child layer's own background was the structural gap behind
      // the founder-observed decks-screen blink. zIndex/elevation guarantee this composites above
      // the Expo Router Stack regardless of paint/mount-order subtleties, not just JSX sibling
      // order (which is correct today but not something to depend on exclusively).
      style={[styles.container, { backgroundColor: bridge.background, zIndex: 1000, elevation: 1000 }, containerAnimatedStyle]}
      onLayout={handleLayout}
      accessible
      accessibilityRole="image"
      accessibilityLabel="Interval"
    >
      {/* Full-surface background layers, crossfading — always behind everything else. */}
      <Animated.View style={[styles.fill, { backgroundColor: bridge.background }, bridgeLayerAnimatedStyle]} pointerEvents="none" />
      <Animated.View
        style={[styles.fill, { backgroundColor: treatmentBackground }, treatmentBackgroundAnimatedStyle]}
        pointerEvents="none"
      />

      {/* "nterval" — clipped to a growing width from its own fixed left edge. Rendered behind the
          mark layers so it can never visually double/ghost against the mark. */}
      <Animated.View style={[styles.ntervalClip, ntervalClipAnimatedStyle]} pointerEvents="none">
        <View style={styles.ntervalImageWrapper}>
          <Animated.Image
            source={ntervalSource}
            style={styles.ntervalImage}
            resizeMode="contain"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        </View>
      </Animated.View>

      {/* The bridge mark — pixel-identical to whichever native splash variant iOS/Android actually
          displayed (see `bridge` above). Visible alone during the bridge hold, then crossfades
          away. */}
      <View style={styles.layer} pointerEvents="none">
        <Animated.Image
          source={bridge.markSource}
          style={[styles.bridgeMark, bridgeLayerAnimatedStyle]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      </View>

      {/* Reduced-motion only: the static centered, treatment-colored mark frame. Opacity 0 for
          the entire standard-motion sequence, so it has no effect there. */}
      <View style={styles.layer} pointerEvents="none">
        <Animated.Image
          source={markSource}
          style={[styles.mark, centeredMarkAnimatedStyle]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      </View>

      {/* The one continuously-visible treatment-colored mark — centered at rest (matching the
          bridge mark's own on-screen glyph size, see MARK_DISPLAY_SCALE) and, in standard motion,
          smoothly translating/scaling into the wordmark's "i". */}
      <View style={styles.layer} pointerEvents="none">
        <Animated.Image
          source={markSource}
          style={[styles.mark, movingMarkAnimatedStyle]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
  layer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  bridgeMark: {
    width: ORIGINAL_MARK_SIZE,
    height: ORIGINAL_MARK_SIZE,
  },
  mark: {
    width: MARK_BOX_WIDTH,
    height: MARK_BOX_HEIGHT,
  },
  ntervalClip: {
    position: "absolute",
    left: "50%",
    top: "50%",
    height: NTERVAL_FINAL_HEIGHT,
    overflow: "hidden",
    transform: [
      { translateX: NTERVAL_FINAL_TRANSLATE_X },
      { translateY: -NTERVAL_FINAL_HEIGHT / 2 },
    ],
  },
  ntervalImageWrapper: {
    width: NTERVAL_FINAL_WIDTH,
    height: NTERVAL_FINAL_HEIGHT,
  },
  ntervalImage: {
    width: NTERVAL_FINAL_WIDTH,
    height: NTERVAL_FINAL_HEIGHT,
  },
});
