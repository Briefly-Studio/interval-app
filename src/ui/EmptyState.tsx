import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/src/theme";

type EmptyStateProps = {
  icon?: ComponentProps<typeof Ionicons>["name"];
  title: string;
  description?: string;
  children?: ReactNode;
};

// Shared empty-state layout: icon mark, title, optional description, and an optional action
// slot (typically a Button) below.
export function EmptyState({ icon, title, description, children }: EmptyStateProps) {
  const { colors, iconSizes, spacing, typography } = useTheme();
  return (
    <View style={[styles.container, { gap: spacing.sm, paddingVertical: spacing.xl }]}>
      {icon ? (
        <View style={[styles.iconWrap, { backgroundColor: colors.accentSubtle, marginBottom: spacing.xs }]}>
          <Ionicons name={icon} size={iconSizes.lg} color={colors.accent} />
        </View>
      ) : null}
      <Text style={[typography.heading, styles.title, { color: colors.textPrimary }]}>{title}</Text>
      {description ? (
        <Text style={[typography.secondary, styles.description, { color: colors.textSecondary }]}>{description}</Text>
      ) : null}
      {children ? <View style={[styles.actions, { marginTop: spacing.md, gap: spacing.sm }]}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", justifyContent: "center" },
  iconWrap: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  title: { textAlign: "center" },
  description: { textAlign: "center", maxWidth: 280 },
  actions: { width: "100%" },
});
