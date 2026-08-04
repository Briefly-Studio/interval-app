import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/src/theme";

type SettingsRowProps = {
  icon?: ComponentProps<typeof Ionicons>["name"];
  label: string;
  subtitle?: string;
  onPress?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  loading?: boolean;
};

// One row in a Settings section: icon + label (+ optional subtitle), a trailing chevron only
// when it actually navigates, destructive styling only for destructive actions.
//
// A row with no onPress (e.g. "Change password" before a safe implementation exists) — or one
// explicitly `disabled` — renders as a plain, non-interactive View, not a Pressable: no button
// role, no press feedback, no chevron, muted text. This is deliberate, not just visual: a
// disabled Pressable still exposes a "button" accessibility role to VoiceOver (announced as a
// dimmed/disabled button), which reads as a broken control. Rendering inert rows as plain
// informational text avoids that entirely.
export function SettingsRow({
  icon,
  label,
  subtitle,
  onPress,
  disabled = false,
  destructive = false,
  loading = false,
}: SettingsRowProps) {
  const { colors, spacing, iconSizes, touchTarget, typography } = useTheme();
  const isInert = disabled || !onPress;

  const content = (
    <>
      {icon ? (
        <Ionicons
          name={icon}
          size={iconSizes.md}
          color={isInert ? colors.disabledText : destructive ? colors.danger : colors.textSecondary}
        />
      ) : null}
      <View style={styles.textCol}>
        <Text
          style={[
            typography.bodyMedium,
            { color: isInert ? colors.disabledText : destructive ? colors.danger : colors.textPrimary },
          ]}
        >
          {label}
        </Text>
        {subtitle ? <Text style={[typography.caption, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
      </View>
      {!isInert && !loading ? (
        <Ionicons name="chevron-forward" size={iconSizes.sm} color={colors.textSecondary} />
      ) : null}
    </>
  );

  if (isInert) {
    return (
      <View style={[styles.row, { gap: spacing.md, minHeight: touchTarget.min, paddingVertical: spacing.sm }]} accessibilityRole="text">
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityState={{ busy: loading }}
      style={({ pressed }) => [
        styles.row,
        { gap: spacing.md, minHeight: touchTarget.min, paddingVertical: spacing.sm },
        pressed && { backgroundColor: colors.surfaceMuted },
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  textCol: { flex: 1, gap: 2 },
});
