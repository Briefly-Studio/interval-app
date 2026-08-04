import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { useTheme } from "@/src/theme";

type SecondaryActionProps = {
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
};

// Calm, low-emphasis chip for actions that must stay discoverable (Import deck, Recently
// Deleted) without competing with the primary "New deck" action.
export function SecondaryAction({ icon, label, onPress }: SecondaryActionProps) {
  const { colors, iconSizes, radii, spacing, touchTarget, typography } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.chip,
        { gap: spacing.xs, minHeight: touchTarget.min, paddingHorizontal: spacing.md, borderRadius: radii.md, borderColor: colors.border, backgroundColor: colors.surface },
        pressed && { backgroundColor: colors.surfaceMuted },
      ]}
    >
      <Ionicons name={icon} size={iconSizes.sm} color={colors.textSecondary} />
      <Text style={[typography.caption, styles.label, { color: colors.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", borderWidth: 1 },
  label: { fontWeight: "600" },
});
