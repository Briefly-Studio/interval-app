import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";

import { colors, radii, spacing, touchTarget } from "./theme";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "sm";

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
};

// Single reusable button covering every role used across the app today: solid primary CTA,
// bordered secondary, low-emphasis ghost/link, and destructive danger. Built-in loading state
// replaces the hand-rolled ActivityIndicator-vs-Text toggling that was duplicated per screen.
export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        size === "sm" ? styles.sizeSm : styles.sizeMd,
        variantBase[variant],
        fullWidth && styles.fullWidth,
        pressed && !isDisabled && variantPressed[variant],
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" || variant === "danger" ? colors.textInverse : colors.accentStrong} />
      ) : (
        <Text style={[styles.label, variantLabel[variant]]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  sizeMd: { minHeight: touchTarget.min, paddingVertical: spacing.md },
  sizeSm: { minHeight: touchTarget.min - 4, paddingVertical: spacing.sm },
  fullWidth: { width: "100%" },
  disabled: { opacity: 0.5 },
  label: { fontSize: 16, fontWeight: "600" },
});

const variantBase = StyleSheet.create({
  primary: { backgroundColor: colors.accentStrong },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  ghost: { backgroundColor: "transparent" },
  danger: { backgroundColor: colors.danger },
});

const variantPressed = StyleSheet.create({
  primary: { backgroundColor: colors.accentPressed },
  secondary: { backgroundColor: colors.surfaceMuted },
  ghost: { backgroundColor: colors.surfaceMuted },
  danger: { backgroundColor: "#A83737" },
});

const variantLabel = StyleSheet.create({
  primary: { color: colors.textInverse },
  secondary: { color: colors.textPrimary },
  ghost: { color: colors.accentStrong },
  danger: { color: colors.textInverse },
});
