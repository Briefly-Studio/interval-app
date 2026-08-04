import { Text } from "react-native";

import { Card } from "./Card";
import { useTheme } from "@/src/theme";

type SessionCardProps = {
  title: string;
  subtitle: string;
};

// One row in Study History — title (mode + score/count) and subtitle (timestamp + duration),
// exactly the fields history.tsx already computes. No metric this doesn't already have.
export function SessionCard({ title, subtitle }: SessionCardProps) {
  const { colors, spacing, typography } = useTheme();
  return (
    <Card style={{ gap: spacing.xs }}>
      <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{title}</Text>
      <Text style={[typography.caption, { color: colors.textSecondary }]}>{subtitle}</Text>
    </Card>
  );
}
