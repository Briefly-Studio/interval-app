import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTranslation } from "../i18n";
import type { Difficulty } from "../models/card";
import { useTheme } from "@/src/theme";

type DifficultySelectorProps = {
  value: Difficulty;
  onChange: (value: Difficulty) => void;
};

const OPTIONS: Difficulty[] = ["easy", "medium", "hard"];

// Reuses the exact same difficulty terminology already established for deck detail's difficulty
// filter (deckDetail.difficultyEasy/Medium/Hard) rather than introducing a duplicate set of keys.
const LABEL_KEYS: Record<Difficulty, "deckDetail.difficultyEasy" | "deckDetail.difficultyMedium" | "deckDetail.difficultyHard"> = {
  easy: "deckDetail.difficultyEasy",
  medium: "deckDetail.difficultyMedium",
  hard: "deckDetail.difficultyHard",
};

// Shared segmented control for New Card / Edit Card. Selected state is conveyed by more than
// color alone (fill + font weight), and every segment meets the 44pt touch-target minimum.
// Stores/reads the exact same Difficulty values as before — no new levels, no scheduling changes.
export function DifficultySelector({ value, onChange }: DifficultySelectorProps) {
  const { t } = useTranslation();
  const { colors, radii, touchTarget, typography } = useTheme();
  return (
    <View style={[styles.row, { borderRadius: radii.md, borderColor: colors.border }]} accessibilityRole="radiogroup">
      {OPTIONS.map((option) => {
        const isActive = value === option;
        const label = t(LABEL_KEYS[option]);
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            accessibilityRole="radio"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={label}
            style={[
              styles.segment,
              { minHeight: touchTarget.min, backgroundColor: isActive ? colors.accentSubtle : colors.surface },
            ]}
          >
            <Text
              style={[
                typography.bodyMedium,
                { color: isActive ? colors.accent : colors.textSecondary },
                isActive && styles.labelActive,
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", borderWidth: 1, overflow: "hidden" },
  segment: { flex: 1, alignItems: "center", justifyContent: "center" },
  labelActive: { fontWeight: "700" },
});
