import { Pressable, StyleSheet, Text } from "react-native";

import { useTheme } from "@/src/theme";

type FilterChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** "radio" for exclusive-choice groups (sort, single-value filters), "checkbox" for
   * multi-select (collection assignment). Determines both the accessibility role and which
   * accessibilityState key is exposed. */
  role?: "radio" | "checkbox";
  accessibilityLabel?: string;
  /** Renders dimmed and non-interactive — used when a chip's choice is currently determined
   * automatically (e.g. source type locked to the attached file's detected type) rather than
   * freely selectable. Never the only signal: paired with accessibilityState.disabled. */
  disabled?: boolean;
};

// Small reusable chip used across Library's organization tabs, type filter, sort options, and
// collection multi-select — factored out because the same selected/unselected chip pattern
// (already used ad hoc for deck detail's difficulty filter, see app/deck/[id]/index.tsx) is
// needed in several distinct Library screens. Selected state is never color-only: filled
// background + accent text + bold weight together, plus a real accessibility state.
export function FilterChip({ label, selected, onPress, role = "radio", accessibilityLabel, disabled = false }: FilterChipProps) {
  const { colors, spacing, touchTarget, typography } = useTheme();
  const accessibilityState = role === "radio" ? { selected, disabled } : { checked: selected, disabled };

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole={role}
      accessibilityState={accessibilityState}
      accessibilityLabel={accessibilityLabel ?? label}
      style={[
        styles.chip,
        {
          minHeight: touchTarget.min,
          paddingHorizontal: spacing.md,
          borderColor: selected ? colors.accent : colors.border,
          backgroundColor: selected ? colors.accentSubtle : colors.surface,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text
        style={[
          typography.caption,
          styles.label,
          { color: selected ? colors.accent : colors.textPrimary },
          selected && styles.labelSelected,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  label: { fontWeight: "600" },
  labelSelected: { fontWeight: "700" },
});
