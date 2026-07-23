import { Pressable, StyleSheet, Text } from "react-native";

import { colors, radii, spacing, touchTarget } from "./theme";

type AccountButtonProps = {
  /** A single initial for a signed-in user, or a short label ("Sign in") for guests. */
  label: string;
  variant: "initial" | "signIn";
  onPress: () => void;
  accessibilityLabel: string;
};

// Compact account entry for the Home header. Signed-in users get a small circular initial
// (no fake avatar photo); guests get a clear, low-emphasis "Sign in" pill. Neither implies a
// full profile surface — tapping either opens the smallest thing that makes sense today (an
// account action sheet, or the sign-in screen).
export function AccountButton({ label, variant, onPress, accessibilityLabel }: AccountButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        variant === "initial" ? styles.avatar : styles.signInPill,
        pressed && styles.pressed,
      ]}
    >
      <Text style={variant === "initial" ? styles.avatarLabel : styles.signInLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: touchTarget.min,
    height: touchTarget.min,
    borderRadius: radii.pill,
    backgroundColor: colors.accentMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLabel: { fontSize: 16, fontWeight: "700", color: colors.accentStrong },
  signInPill: {
    minHeight: touchTarget.min,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.accentStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  signInLabel: { fontSize: 15, fontWeight: "600", color: colors.textInverse },
  pressed: { opacity: 0.85 },
});
