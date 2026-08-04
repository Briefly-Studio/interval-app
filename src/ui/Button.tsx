import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";

import { useTheme, type ThemeTokens } from "@/src/theme";

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
  /** Overrides the accessible name (defaults to `label`) — for rows where "Restore" alone would
   * be ambiguous among several identical buttons (e.g. "Restore card {front text}"). */
  accessibilityLabel?: string;
};

function variantBaseStyle(variant: ButtonVariant, colors: ThemeTokens) {
  switch (variant) {
    case "primary":
      return { backgroundColor: colors.accent };
    case "secondary":
      return { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border };
    case "ghost":
      return { backgroundColor: "transparent" };
    case "danger":
      return { backgroundColor: colors.danger };
  }
}

function variantPressedStyle(variant: ButtonVariant, colors: ThemeTokens) {
  switch (variant) {
    case "primary":
      return { backgroundColor: colors.accentPressed };
    case "secondary":
      return { backgroundColor: colors.surfaceMuted };
    case "ghost":
      return { backgroundColor: colors.surfaceMuted };
    case "danger":
      return { backgroundColor: colors.dangerPressed };
  }
}

function variantLabelColor(variant: ButtonVariant, colors: ThemeTokens) {
  switch (variant) {
    case "primary":
      return colors.onAccent;
    case "secondary":
      return colors.textPrimary;
    case "ghost":
      return colors.accent;
    case "danger":
      return colors.onDanger;
  }
}

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
  accessibilityLabel,
}: ButtonProps) {
  const { colors, radii, spacing, touchTarget } = useTheme();
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        { borderRadius: radii.md, paddingHorizontal: spacing.lg },
        size === "sm"
          ? { minHeight: touchTarget.min - 4, paddingVertical: spacing.sm }
          : { minHeight: touchTarget.min, paddingVertical: spacing.md },
        variantBaseStyle(variant, colors),
        fullWidth && styles.fullWidth,
        pressed && !isDisabled && variantPressedStyle(variant, colors),
        isDisabled && { backgroundColor: colors.disabledSurface, borderColor: colors.disabledBorder },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" || variant === "danger" ? colors.onAccent : colors.accent} />
      ) : (
        <Text style={[styles.label, { color: isDisabled ? colors.disabledText : variantLabelColor(variant, colors) }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center" },
  fullWidth: { width: "100%" },
  label: { fontSize: 16, fontWeight: "600" },
});
