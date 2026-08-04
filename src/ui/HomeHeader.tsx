import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/src/theme";

type HomeHeaderProps = {
  /** Preserves the existing hidden dev-tools entry point (long-press on the wordmark). */
  onTitleLongPress?: () => void;
  /** Right-side controls — account button and, in dev builds, the dev-tools gear. */
  children?: ReactNode;
};

// Purely presentational: compact replacement for the old header row that stacked Sign out,
// Settings, Import deck, Recently Deleted, and + Deck side by side. All of that logic still
// lives in app/index.tsx — this component only lays out the brand wordmark and whatever
// right-side controls it's handed.
export function HomeHeader({ onTitleLongPress, children }: HomeHeaderProps) {
  const { colors, spacing, typography } = useTheme();
  return (
    <View style={styles.row}>
      <Pressable onLongPress={onTitleLongPress} delayLongPress={600} accessibilityRole="header">
        <Text style={[typography.title, { color: colors.textPrimary }]}>Interval</Text>
      </Pressable>
      <View style={[styles.right, { gap: spacing.sm }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  right: { flexDirection: "row", alignItems: "center" },
});
