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
  withTiming,
} from "react-native-reanimated";

// Approved app-icon-background token (#0F7A75) — shared with app.json's expo-splash-screen
// config so native splash → this layer → app content never shows a background-color seam.
export const BRAND_STARTUP_TEAL = "#0F7A75";

// Same logical width as app.json's expo-splash-screen imageWidth — keeps this layer's opening
// frame at the same perceived size and position as the native splash it hands off from, so there
// is no visible jump at the handoff point.
const MARK_SIZE = 180;

// ---- Timing (tune here) — standard-motion sequence ----
// Beat 1: hold on the centered mark alone (matches the native-splash frame exactly).
const HOLD_MARK_MS = 250;
// Beat 2: the mark translates left and becomes the wordmark's "i"; "nterval" reveals alongside.
const REVEAL_MS = 1000;
// Beat 3: hold on the completed, settled wordmark.
const HOLD_LOCKUP_MS = 750;
// Beat 4: whole layer fades away, revealing the app underneath.
const FADE_OUT_MS = 400;
const TOTAL_MS = HOLD_MARK_MS + REVEAL_MS + HOLD_LOCKUP_MS + FADE_OUT_MS; // 2400ms

// Within REVEAL_MS, "nterval" starts appearing partway through the mark's own movement and
// finishes slightly before the mark's movement itself settles — see PART C guidance (reveal
// starts ~20–30% in, completes ~85–95% in). Expressed as fractions of REVEAL_MS.
const NTERVAL_REVEAL_START_FRAC = 0.25;
const NTERVAL_REVEAL_END_FRAC = 0.9;
const NTERVAL_DELAY_MS = HOLD_MARK_MS + REVEAL_MS * NTERVAL_REVEAL_START_FRAC; // 500ms
const NTERVAL_REVEAL_DURATION_MS = REVEAL_MS * (NTERVAL_REVEAL_END_FRAC - NTERVAL_REVEAL_START_FRAC); // 650ms

// ---- Timing — reduced-motion sequence (shorter than the standard sequence, never spatial) ----
const REDUCED_HOLD_MARK_MS = 250;
const REDUCED_CROSSFADE_MS = 220;
const REDUCED_HOLD_LOCKUP_MS = 500;
const REDUCED_FADE_OUT_MS = 300;
const REDUCED_TOTAL_MS =
  REDUCED_HOLD_MARK_MS + REDUCED_CROSSFADE_MS + REDUCED_HOLD_LOCKUP_MS + REDUCED_FADE_OUT_MS; // 1270ms

// Founder QA on the previous cut flagged the reveal as reading like "one image replacing
// another," too fast, without genuine ease-in. The approved brand global easing
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
// center (screen center is where the mark sits at t=0, matching the native splash exactly).
const MARK_FINAL_TRANSLATE_X = LOCKUP_FINAL_WIDTH * (0.053448 - 0.5); // ≈ -125.03
const MARK_FINAL_TRANSLATE_Y = LOCKUP_FINAL_HEIGHT * (0.492198 - 0.5); // ≈ -0.51
// Scale needed so the mark's own ink shrinks from its native-splash size (46%-height-fraction
// Candidate B proportions, per branding/splash/manifest.json) down to its correct, smaller size
// within the settled wordmark (10.69%/98.44% of a 280pt-wide lockup) — a real but modest ~23%
// reduction, intentionally subordinate to (driven by the same progress value/easing as) the
// horizontal translation, never animated independently.
const MARK_FINAL_SCALE = 0.7736;

// "nterval" crop: derived mechanically from assets/images/interval-lockup-dark.png (2400×558)
// via `sips -c 558 2138 --cropOffset 0 262`, i.e. a straight rectangular crop — no redrawing, no
// recompression of the kept pixels, no color change. The crop boundary (262px) sits ~5px to the
// right of the mark's own mathematical right edge (≈256.55px) specifically to clear a faint
// sub-pixel anti-aliasing remnant of the mark's stroke that a boundary flush with the mark's edge
// left behind (confirmed by a raw pixel-alpha scan before and after); there is ~34px of the
// approved 110-design-unit mark↔word gap remaining as transparent padding before "n" begins, so
// this adjustment does not touch any letter. See this batch's report for the full derivation.
const NTERVAL_SOURCE = require("../../assets/images/interval-lockup-dark-nterval-only.png");
const NTERVAL_CROP_ASPECT = 558 / 2138; // height / width of the cropped asset itself
const NTERVAL_FINAL_TRANSLATE_X = LOCKUP_FINAL_WIDTH * (262 / 2400 - 0.5); // ≈ -109.43, left edge offset from screen center
const NTERVAL_FINAL_WIDTH = LOCKUP_FINAL_WIDTH * (1 - 262 / 2400); // ≈ 249.43
const NTERVAL_FINAL_HEIGHT = NTERVAL_FINAL_WIDTH * NTERVAL_CROP_ASPECT; // preserves the crop's own aspect, ≈65.1

const MARK_SOURCE = require("../../assets/images/splash-icon.png");

type BrandStartupProps = {
  // Called exactly once, as soon as this layer's first real native layout is confirmed (via
  // onLayout, with a bounded fallback — see effect below). This is the *only* signal app/
  // _layout.tsx uses to decide it is safe to hide the native splash screen, specifically so the
  // native splash is never dismissed before this layer has a confirmed, laid-out, correctly
  // colored frame ready to take over — see this batch's report, Part A.
  onReady?: () => void;
  // Called exactly once, guaranteed, when the whole startup sequence is finished and the layer
  // should be unmounted. Driven by a plain timer independent of whether the visual animation
  // itself completes without error, so the overlay can never get stuck on screen.
  onFinished?: () => void;
};

// Mark → wordmark reveal, then a brief hold, then a fade to the app. The standalone mark is a
// single, continuously-visible element throughout (never faded out/replaced) that translates left
// and scales down slightly into its exact position as the wordmark's own "i"; "nterval" is a
// separately-cropped, mechanically-derived asset that reveals in beside it via a growing clip
// window, not by fading in a second copy of the whole lockup. No mark drawing, no morph, no
// looping motion. The later full motion batch (stroke-draw reveal, Return Arc, haptics) is a
// separate, larger effort — this is a raster crossfade/translate, not the approved vector
// animation.
export function BrandStartup({ onReady, onFinished }: BrandStartupProps) {
  // Drives the mark's translateX/Y/scale in standard motion. Set directly to 1 (no animation) in
  // reduced motion, since the moving-mark element is reused as reduced motion's "final" frame.
  const revealProgress = useSharedValue(0);
  // The mark is ALWAYS visible (per founder direction: "the original mark remains visually
  // continuous") — stays at 1 the entire standard-motion sequence and is never animated there.
  const markOpacity = useSharedValue(1);
  // Reduced-motion-only: a second, fixed-position mark frame (matching the native splash exactly)
  // that this crossfades away from.
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

    if (reduced) {
      // Non-spatial: no translation, no scale, no growing width — a plain opacity crossfade from
      // the centered mark frame into the already-settled final frame (mark + full "nterval").
      revealProgress.value = 1;
      ntervalClipWidth.value = NTERVAL_FINAL_WIDTH;
      centeredMarkOpacity.value = 1;
      markOpacity.value = 0;
      centeredMarkOpacity.value = withDelay(
        REDUCED_HOLD_MARK_MS,
        withTiming(0, { duration: REDUCED_CROSSFADE_MS, easing: Easing.linear })
      );
      markOpacity.value = withDelay(
        REDUCED_HOLD_MARK_MS,
        withTiming(1, { duration: REDUCED_CROSSFADE_MS, easing: Easing.linear })
      );
      ntervalOpacity.value = withDelay(
        REDUCED_HOLD_MARK_MS,
        withTiming(1, { duration: REDUCED_CROSSFADE_MS, easing: Easing.linear })
      );
      containerOpacity.value = withDelay(
        REDUCED_HOLD_MARK_MS + REDUCED_CROSSFADE_MS + REDUCED_HOLD_LOCKUP_MS,
        withTiming(0, { duration: REDUCED_FADE_OUT_MS, easing: Easing.linear })
      );
    } else {
      revealProgress.value = withDelay(HOLD_MARK_MS, withTiming(1, { duration: REVEAL_MS, easing: MOTION_EASING }));
      ntervalClipWidth.value = withDelay(
        NTERVAL_DELAY_MS,
        withTiming(NTERVAL_FINAL_WIDTH, { duration: NTERVAL_REVEAL_DURATION_MS, easing: MOTION_EASING })
      );
      ntervalOpacity.value = withDelay(
        NTERVAL_DELAY_MS,
        withTiming(1, { duration: NTERVAL_REVEAL_DURATION_MS, easing: MOTION_EASING })
      );
      containerOpacity.value = withDelay(
        HOLD_MARK_MS + REVEAL_MS + HOLD_LOCKUP_MS,
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

  // The continuously-visible, moving mark. Always opacity 1 in standard motion; in reduced
  // motion it doubles as the "final settled" frame (see markOpacity above).
  const movingMarkAnimatedStyle = useAnimatedStyle(() => {
    const translateX = interpolate(revealProgress.value, [0, 1], [0, MARK_FINAL_TRANSLATE_X], Extrapolation.CLAMP);
    const translateY = interpolate(revealProgress.value, [0, 1], [0, MARK_FINAL_TRANSLATE_Y], Extrapolation.CLAMP);
    const scale = interpolate(revealProgress.value, [0, 1], [1, MARK_FINAL_SCALE], Extrapolation.CLAMP);
    return {
      opacity: markOpacity.value,
      transform: [{ translateX }, { translateY }, { scale }],
    };
  });

  // Reduced-motion only: a second, fixed-position mark frame exactly matching the native splash,
  // that this crossfades away from.
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
      {/* "nterval" — clipped to a growing width from its own fixed left edge. Rendered first
          (behind the mark layers) so it can never visually double/ghost against the mark. */}
      <Animated.View style={[styles.ntervalClip, ntervalClipAnimatedStyle]} pointerEvents="none">
        <View style={styles.ntervalImageWrapper}>
          <Animated.Image
            source={NTERVAL_SOURCE}
            style={styles.ntervalImage}
            resizeMode="contain"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        </View>
      </Animated.View>

      {/* Reduced-motion only: the static centered-mark frame. Opacity 0 for the entire standard-
          motion sequence, so it has no effect there. */}
      <View style={styles.layer} pointerEvents="none">
        <Animated.Image
          source={MARK_SOURCE}
          style={[styles.mark, centeredMarkAnimatedStyle]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      </View>

      {/* The one continuously-visible mark — centered at t=0 (matching the native splash exactly)
          and, in standard motion, smoothly translating/scaling into the wordmark's "i". */}
      <View style={styles.layer} pointerEvents="none">
        <Animated.Image
          source={MARK_SOURCE}
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
    backgroundColor: BRAND_STARTUP_TEAL,
  },
  layer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  mark: {
    width: MARK_SIZE,
    height: MARK_SIZE,
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
