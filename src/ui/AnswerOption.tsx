import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text } from "react-native";

import { useTheme, type ThemeTokens } from "@/src/theme";

export type AnswerOptionState = "default" | "correct" | "incorrect" | "dimmed";

type AnswerOptionProps = {
  label: string;
  state: AnswerOptionState;
  disabled?: boolean;
  onPress: () => void;
};

function stateBoxStyle(state: AnswerOptionState, colors: ThemeTokens) {
  switch (state) {
    case "default":
      return { backgroundColor: colors.surface, borderColor: colors.border };
    case "dimmed":
      return { backgroundColor: colors.surfaceMuted, borderColor: colors.border };
    case "correct":
      return { backgroundColor: colors.successSurface, borderColor: colors.success };
    case "incorrect":
      return { backgroundColor: colors.dangerSurface, borderColor: colors.danger };
  }
}

function stateTextStyle(state: AnswerOptionState, colors: ThemeTokens) {
  switch (state) {
    case "default":
      return { color: colors.textPrimary };
    case "dimmed":
      return { color: colors.textSecondary };
    case "correct":
    case "incorrect":
      return { color: colors.textPrimary, fontWeight: "700" as const };
  }
}

// Correctness is never conveyed by color alone — a checkmark/X icon accompanies the
// correct/incorrect fill, matching the exact reveal logic already in quiz.tsx (the correct
// answer highlights once any option is picked; the user's own wrong pick is marked separately).
export function AnswerOption({ label, state, disabled, onPress }: AnswerOptionProps) {
  const { colors, radii, spacing, touchTarget, typography } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: state === "correct" || state === "incorrect" }}
      style={[
        styles.base,
        { gap: spacing.sm, minHeight: touchTarget.min, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radii.md },
        stateBoxStyle(state, colors),
      ]}
    >
      <Text style={[typography.bodyMedium, styles.text, stateTextStyle(state, colors)]}>{label}</Text>
      {state === "correct" && <Ionicons name="checkmark-circle" size={18} color={colors.success} />}
      {state === "incorrect" && <Ionicons name="close-circle" size={18} color={colors.danger} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1 },
  text: { flexShrink: 1 },
});
