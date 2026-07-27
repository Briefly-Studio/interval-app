import { StyleSheet, Text, View } from "react-native";

import { colors, spacing, typography } from "./theme";

type ResultMetricProps = {
  label: string;
  value: string;
};

// A single labeled number in a results summary — real data only, supplied by the caller.
export function ResultMetric({ label, value }: ResultMetricProps) {
  return (
    <View style={styles.metric}>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  metric: { alignItems: "center", gap: spacing.xs, minWidth: 88 },
  value: { fontSize: 28, fontWeight: "700", color: colors.textPrimary },
  label: { ...typography.caption },
});
