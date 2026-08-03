import { Image, StyleSheet, View } from "react-native";

// Approved app-icon-background token (#0F7A75) — shared with app.json's expo-splash-screen
// config and app/_layout.tsx's root background so native splash → this layer → app content
// never shows a background-color seam.
export const BRAND_STARTUP_TEAL = "#0F7A75";

// Same logical width as app.json's expo-splash-screen imageWidth — keeps this layer's mark at
// the same perceived size and position as the native splash it hands off from, so there is no
// visible jump at the handoff point.
const MARK_SIZE = 180;

// Static bridge only — no drawing, no movement, no "nterval" reveal, no morph, no timing
// choreography, no reanimated worklets, no looping motion. Renders the same background and mark
// as the native splash so app/_layout.tsx can hide the native splash and show this layer with no
// visible difference, then swap to real app content shortly after. The later motion batch
// replaces this component with the approved mark-to-wordmark sequence — see docs referenced in
// that batch's handoff, not here.
export function BrandStartup() {
  return (
    <View
      style={styles.container}
      accessible
      accessibilityRole="image"
      accessibilityLabel="Interval"
    >
      <Image
        source={require("../../assets/images/splash-icon.png")}
        style={styles.mark}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BRAND_STARTUP_TEAL,
    alignItems: "center",
    justifyContent: "center",
  },
  mark: {
    width: MARK_SIZE,
    height: MARK_SIZE,
  },
});
