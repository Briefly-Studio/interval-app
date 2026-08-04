import { StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/src/theme";

type ResultMetricProps = {
  label: string;
  value: string;
};

// A single labeled number in a results summary — real data only, supplied by the caller.
export function ResultMetric({ label, value }: ResultMetricProps) {
  const { colors, spacing, typography } = useTheme();
  return (
    <View style={[styles.metric, { gap: spacing.xs }]}>
      <Text style={[styles.value, { color: colors.textPrimary }]}>{value}</Text>
      <Text style={[typography.caption, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  metric: { alignItems: "center", minWidth: 88 },
  value: { fontSize: 28, fontWeight: "700" },
});
