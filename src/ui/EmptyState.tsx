import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors, iconSizes, spacing, typography } from "./theme";

type EmptyStateProps = {
  icon?: ComponentProps<typeof Ionicons>["name"];
  title: string;
  description?: string;
  children?: ReactNode;
};

// Shared empty-state layout: icon mark, title, optional description, and an optional action
// slot (typically a Button) below. Not used by the auth screens in this batch — built now as
// part of the shared foundation for the decks-home / list-screen batch that follows.
export function EmptyState({ icon, title, description, children }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      {icon ? (
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={iconSizes.lg} color={colors.accentStrong} />
        </View>
      ) : null}
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accentMuted,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  title: { ...typography.heading, textAlign: "center" },
  description: { ...typography.secondary, textAlign: "center", maxWidth: 280 },
  actions: { marginTop: spacing.md, gap: spacing.sm, width: "100%" },
});
