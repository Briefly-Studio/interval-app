import { Pressable, StyleSheet, Text, View } from "react-native";

import { useLayoutDirection } from "../i18n/direction";
import { useTheme } from "@/src/theme";

export type StructureNodePickerItem = {
  nodeId: string;
  /** On-screen label — real source text, breadcrumb-qualified only when the caller has already
   * decided it's needed for disambiguation (see sourceGenerationScopeUi.ts's
   * StructureNodeChoice.titleIsAmbiguous). Indentation (via `level`) is a VISUAL aid only. */
  label: string;
  /** Fully-qualified announcement for assistive tech — always includes real ancestor context and
   * state, regardless of whether `label` itself needed qualifying. Indentation is never read
   * aloud, so hierarchy/level/disabled/shared state must always be stated here in words. */
  accessibilityLabel: string;
  /** 0 = no indentation (worksheet, or a flat/non-hierarchical heading). 1+ = real heading depth. */
  level: number;
  /** An empty node (zero chunks) is still shown — never hidden — just non-selectable. */
  disabled?: boolean;
  /** Optional one-line helper shown under the label (section count, "no content yet", "shared
   * with another worksheet"). Purely visual — the full equivalent is always also folded into
   * `accessibilityLabel`. */
  description?: string;
};

type StructureNodePickerProps = {
  groupLabel: string;
  items: StructureNodePickerItem[];
  value: string | null;
  onChange: (nodeId: string) => void;
};

const INDENT_UNIT = 16;

// The codebase's first hierarchical/tree selection control — a flat, scrollable, indented list
// (never a modal, never virtualized: structure is bounded to SOURCE_STRUCTURE_LIMITS.maxNodes,
// realistically far smaller). Extends OptionRadioGroup's own visual language (fill + border +
// check glyph + bold label, never color alone, full 44pt touch target regardless of indentation)
// rather than introducing a second interaction pattern, but adds per-item disabled state (for an
// empty node) and indentation, neither of which OptionRadioGroup supports.
export function StructureNodePicker({ groupLabel, items, value, onChange }: StructureNodePickerProps) {
  const { colors, radii, spacing, typography, touchTarget } = useTheme();
  const { row, isRtl } = useLayoutDirection();

  return (
    <View style={{ gap: spacing.xs }} accessibilityRole="radiogroup" accessibilityLabel={groupLabel}>
      {items.map((item) => {
        const isActive = item.nodeId === value;
        const disabled = !!item.disabled;
        const indent = item.level > 0 ? item.level * INDENT_UNIT : 0;
        return (
          <Pressable
            key={item.nodeId}
            onPress={() => !disabled && onChange(item.nodeId)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected: isActive, disabled }}
            accessibilityLabel={item.accessibilityLabel}
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
                opacity: disabled ? 0.5 : 1,
                [isRtl ? "marginRight" : "marginLeft"]: indent,
              },
            ]}
          >
            <View style={styles.textCol}>
              <Text
                numberOfLines={2}
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
