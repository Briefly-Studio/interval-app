import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text } from "react-native";

import { colors, radii, spacing, touchTarget, typography } from "./theme";

export type AnswerOptionState = "default" | "correct" | "incorrect" | "dimmed";

type AnswerOptionProps = {
  label: string;
  state: AnswerOptionState;
  disabled?: boolean;
  onPress: () => void;
};

// Correctness is never conveyed by color alone — a checkmark/X icon accompanies the
// correct/incorrect fill, matching the exact reveal logic already in quiz.tsx (the correct
// answer highlights once any option is picked; the user's own wrong pick is marked separately).
export function AnswerOption({ label, state, disabled, onPress }: AnswerOptionProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: state === "correct" || state === "incorrect" }}
      style={[styles.base, stateStyles[state]]}
    >
      <Text style={[styles.text, stateTextStyles[state]]}>{label}</Text>
      {state === "correct" && (
        <Ionicons name="checkmark-circle" size={18} color={colors.success} />
      )}
      {state === "incorrect" && <Ionicons name="close-circle" size={18} color={colors.danger} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    minHeight: touchTarget.min,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  text: { ...typography.bodyMedium, flexShrink: 1 },
});

const stateStyles = StyleSheet.create({
  default: { backgroundColor: colors.surface, borderColor: colors.border },
  dimmed: { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
  correct: { backgroundColor: colors.accentMuted, borderColor: colors.success },
  incorrect: { backgroundColor: colors.dangerMuted, borderColor: colors.danger },
});

const stateTextStyles = StyleSheet.create({
  default: { color: colors.textPrimary },
  dimmed: { color: colors.textSecondary },
  correct: { color: colors.textPrimary, fontWeight: "700" },
  incorrect: { color: colors.textPrimary, fontWeight: "700" },
});
