import { StyleSheet, Text } from "react-native";

import { Card } from "./Card";
import { spacing, typography } from "./theme";

type SessionCardProps = {
  title: string;
  subtitle: string;
};

// One row in Study History — title (mode + score/count) and subtitle (timestamp + duration),
// exactly the fields history.tsx already computes. No metric this doesn't already have.
export function SessionCard({ title, subtitle }: SessionCardProps) {
  return (
    <Card style={styles.card}>
      <Text style={typography.bodyMedium}>{title}</Text>
      <Text style={typography.caption}>{subtitle}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs },
});
