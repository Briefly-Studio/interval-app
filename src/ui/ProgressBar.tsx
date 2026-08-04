import { StyleSheet, View } from "react-native";

import { useTheme } from "@/src/theme";

type ProgressBarProps = {
  current: number;
  total: number;
};

// Subtle, real-data progress indicator — no fake mastery/streak, just current index vs. count.
export function ProgressBar({ current, total }: ProgressBarProps) {
  const { colors, radii } = useTheme();
  const pct = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0;

  return (
    <View
      style={[styles.track, { borderRadius: radii.pill, backgroundColor: colors.surfaceMuted }]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: current }}
    >
      <View style={[styles.fill, { width: `${pct * 100}%`, borderRadius: radii.pill, backgroundColor: colors.accent }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 6, overflow: "hidden" },
  fill: { height: "100%" },
});
