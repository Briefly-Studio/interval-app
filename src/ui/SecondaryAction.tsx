import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { colors, iconSizes, radii, spacing, touchTarget, typography } from "./theme";

type SecondaryActionProps = {
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
};

// Calm, low-emphasis chip for actions that must stay discoverable (Import deck, Recently
// Deleted) without competing with the primary "New deck" action.
export function SecondaryAction({ icon, label, onPress }: SecondaryActionProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={iconSizes.sm} color={colors.textSecondary} />
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: touchTarget.min,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { backgroundColor: colors.surfaceMuted },
  label: { ...typography.caption, fontWeight: "600", color: colors.textSecondary },
});
