import { StyleSheet, View } from "react-native";

import { colors, radii } from "./theme";

type ProgressBarProps = {
  current: number;
  total: number;
};

// Subtle, real-data progress indicator — no fake mastery/streak, just current index vs. count.
export function ProgressBar({ current, total }: ProgressBarProps) {
  const pct = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0;

  return (
    <View
      style={styles.track}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: current }}
    >
      <View style={[styles.fill, { width: `${pct * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: radii.pill,
    backgroundColor: colors.accentStrong,
  },
});
