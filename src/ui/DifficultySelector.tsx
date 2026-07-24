import { Pressable, StyleSheet, Text, View } from "react-native";

import type { Difficulty } from "../models/card";
import { colors, radii, touchTarget, typography } from "./theme";

type DifficultySelectorProps = {
  value: Difficulty;
  onChange: (value: Difficulty) => void;
};

const OPTIONS: Difficulty[] = ["easy", "medium", "hard"];

// Shared segmented control for New Card / Edit Card. Selected state is conveyed by more than
// color alone (fill + font weight), and every segment meets the 44pt touch-target minimum.
// Stores/reads the exact same Difficulty values as before — no new levels, no scheduling changes.
export function DifficultySelector({ value, onChange }: DifficultySelectorProps) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {OPTIONS.map((option) => {
        const isActive = value === option;
        const label = option[0].toUpperCase() + option.slice(1);
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            accessibilityRole="radio"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={label}
            style={[styles.segment, isActive && styles.segmentActive]}
          >
            <Text style={[styles.label, isActive && styles.labelActive]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  segment: {
    flex: 1,
    minHeight: touchTarget.min,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  segmentActive: { backgroundColor: colors.accentMuted },
  label: { ...typography.bodyMedium, color: colors.textSecondary },
  labelActive: { color: colors.accentStrong, fontWeight: "700" },
});
