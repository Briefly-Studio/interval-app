import { Pressable, StyleSheet, Text, View } from "react-native";

import { useLayoutDirection } from "../i18n/direction";
import { useTheme } from "@/src/theme";

export type OptionRadioItem<T extends string> = {
  value: T;
  label: string;
  /** Optional one-line helper shown under the label. */
  description?: string;
};

type OptionRadioGroupProps<T extends string> = {
  /** Accessible group name, e.g. "Card count". */
  groupLabel: string;
  items: OptionRadioItem<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
};

// Vertical single-select list used by the Generate Study Deck options screen. Selection is
// conveyed by fill + border + a check glyph + bold label (never color alone), each row clears
// the 44pt touch target, and the whole thing is a proper radiogroup/radio tree for screen
// readers. Direction-aware so the check sits on the trailing edge in RTL.
export function OptionRadioGroup<T extends string>({
  groupLabel,
  items,
  value,
  onChange,
  disabled = false,
}: OptionRadioGroupProps<T>) {
  const { colors, radii, spacing, typography, touchTarget } = useTheme();
  const { row } = useLayoutDirection();

  return (
    <View style={{ gap: spacing.xs }} accessibilityRole="radiogroup" accessibilityLabel={groupLabel}>
      {items.map((item) => {
        const isActive = item.value === value;
        return (
          <Pressable
            key={item.value}
            onPress={() => !disabled && onChange(item.value)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected: isActive, disabled }}
            accessibilityLabel={item.description ? `${item.label}. ${item.description}` : item.label}
            style={[
              styles.rowBase,
              row,
              {
                minHeight: touchTarget.min,
                borderRadius: radii.md,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                gap: spacing.md,
                borderColor: isActive ? colors.accent : colors.border,
                backgroundColor: isActive ? colors.accentSubtle : colors.surface,
              },
            ]}
          >
            <View style={styles.textCol}>
              <Text
                style={[
                  typography.bodyMedium,
                  { color: isActive ? colors.accent : colors.textPrimary },
                  isActive && styles.labelActive,
                ]}
              >
                {item.label}
              </Text>
              {item.description ? (
                <Text style={[typography.caption, { color: colors.textSecondary }]}>{item.description}</Text>
              ) : null}
            </View>
            <Text
              style={[typography.bodyMedium, { color: colors.accent }]}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              {isActive ? "✓" : ""}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  rowBase: { borderWidth: 1, alignItems: "center" },
  textCol: { flex: 1, gap: 2 },
  labelActive: { fontWeight: "700" },
});
