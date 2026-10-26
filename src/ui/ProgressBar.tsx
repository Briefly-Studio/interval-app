import { StyleSheet, View } from "react-native";

import { useTheme } from "@/src/theme";

type ProgressBarProps = {
  current: number;
  total: number;
  accessibilityLabel?: string;
  accessibilityValueText?: string;
  direction?: "ltr" | "rtl";
};

// Subtle, real-data progress indicator — no fake mastery/streak, just current index vs. count.
export function ProgressBar({ current, total, accessibilityLabel, accessibilityValueText, direction = "ltr" }: ProgressBarProps) {
  const { colors, radii } = useTheme();
  const pct = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0;

  return (
    <View
      style={[styles.track, { borderRadius: radii.pill, backgroundColor: colors.surfaceMuted }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: total, now: current, text: accessibilityValueText }}
    >
      <View style={[styles.fill, { width: `${pct * 100}%`, alignSelf: direction === "rtl" ? "flex-end" : "flex-start", borderRadius: radii.pill, backgroundColor: colors.accent }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 6, overflow: "hidden" },
  fill: { height: "100%" },
});
