import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";

import { colors, radii, touchTarget } from "./theme";

type IconButtonVariant = "ghost" | "surface";

type IconButtonProps = {
  name: ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  accessibilityLabel: string;
  variant?: IconButtonVariant;
  size?: number;
  color?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

// Icon-only control at a guaranteed 44x44 touch target. `accessibilityLabel` is required since
// there is no visible text label to fall back on for screen readers.
export function IconButton({
  name,
  onPress,
  accessibilityLabel,
  variant = "ghost",
  size = 20,
  color,
  disabled = false,
  style,
}: IconButtonProps) {
  const iconColor = color ?? (variant === "surface" ? colors.textPrimary : colors.textSecondary);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => [
        styles.base,
        variant === "surface" && styles.surface,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Ionicons name={name} size={size} color={iconColor} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: touchTarget.min,
    height: touchTarget.min,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
  },
  surface: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: { backgroundColor: colors.surfaceMuted },
  disabled: { opacity: 0.4 },
});
