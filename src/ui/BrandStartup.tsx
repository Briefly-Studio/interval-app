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

import { startupTreatmentFor, useTheme, type StartupTreatment } from "@/src/theme";

// Approved app-icon-background token (#0F7A75) — matches app.json's expo-splash-screen config
// verbatim. The native splash cannot read the persisted appearance preference before JS starts,
// so it stays this fixed teal in every case, by design. This layer's own opening frame (the
// "bridge" below) deliberately renders pixel-identical to it, so the native-splash → BrandStartup
// handoff is an imperceptible cut, not a color jump — see this batch's report, Phase F/G.
const BRIDGE_TEAL = "#0F7A75";
export const BRAND_STARTUP_TEAL = BRIDGE_TEAL;

// Native splash's own calibrated mark size (app.json's expo-splash-screen imageWidth) — the
// bridge frame below uses this exact square box with the exact same source image
// (splash-icon.png) so its first frame is pixel-identical to the native splash it replaces. Also
// used to derive MARK_DISPLAY_SCALE further down, which sizes the (differently-shaped) treatment
// mark crops to match this same on-screen glyph height.
const ORIGINAL_MARK_SIZE = 180;
const BRIDGE_MARK_SOURCE = require("../../assets/images/splash-icon.png");

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
  // component at all (see app/_layout.tsx), so resolvedTheme here is always already the real,
  // confirmed value by the time this ever renders.
  const { resolvedTheme } = useTheme();
  const treatment = startupTreatmentFor(resolvedTheme);
  const markSource = MARK_SOURCES[treatment];
  const ntervalSource = NTERVAL_SOURCES[treatment];
  const treatmentBackground = TREATMENTS[treatment].background;

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

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinished?.();
  }, [onFinished]);

  const markReady = useCallback(() => {
    if (readyRef.current) return;
    readyRef.current = true;
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

  const handleLayout = useCallback(() => {
    if (layoutConfirmedRef.current) return;
    layoutConfirmedRef.current = true;
    maybeStart();
  }, [maybeStart]);

  useEffect(() => {
    let cancelled = false;

    // Absolute backstops — independent of each other and of everything above — so this layer can
    // never get permanently stuck even if onLayout never fires, the accessibility check never
    // resolves, or any animation callback fails.
    const layoutBackstop = setTimeout(() => {
      if (!layoutConfirmedRef.current) {
        layoutConfirmedRef.current = true;
        maybeStart();
      }
    }, 500);
    const reduceMotionBackstop = setTimeout(() => {
      if (reduceMotionRef.current === null) {
        reduceMotionRef.current = false;
        maybeStart();
      }
    }, 300);
    const finishBackstop = setTimeout(finish, TOTAL_MS + 500);

    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduced) => {
        if (cancelled) return;
        if (reduceMotionRef.current === null) {
          reduceMotionRef.current = reduced;
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
      style={[styles.container, containerAnimatedStyle]}
      onLayout={handleLayout}
      accessible
      accessibilityRole="image"
      accessibilityLabel="Interval"
    >
      {/* Full-surface background layers, crossfading — always behind everything else. */}
      <Animated.View style={[styles.fill, { backgroundColor: BRIDGE_TEAL }, bridgeLayerAnimatedStyle]} pointerEvents="none" />
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

      {/* The bridge mark — pixel-identical to the native splash (same source image, same size,
          same centered position). Visible alone during the bridge hold, then crossfades away. */}
      <View style={styles.layer} pointerEvents="none">
        <Animated.Image
          source={BRIDGE_MARK_SOURCE}
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
