import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";

import { mirrorIfRtl, useLayoutDirection } from "../i18n/direction";
import { useTheme } from "@/src/theme";

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
  const { colors, radii, touchTarget } = useTheme();
  const { direction } = useLayoutDirection();
  const iconColor = color ?? (variant === "surface" ? colors.textPrimary : colors.textSecondary);
  const mirroredIcon = name === "chevron-back" || name === "chevron-forward";

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => [
        styles.base,
        { width: touchTarget.min, height: touchTarget.min, borderRadius: radii.pill },
        variant === "surface" && { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
        pressed && !disabled && { backgroundColor: colors.surfaceMuted },
        disabled && styles.disabled,
        style,
      ]}
    >
      <Ionicons
        name={name}
        size={size}
        color={disabled ? colors.disabledText : iconColor}
        style={mirroredIcon ? mirrorIfRtl(direction) : undefined}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.4 },
});
