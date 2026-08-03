// Theme Lab — polished concept for a future Settings → Appearance screen. This is a visual
// concept only: nothing here persists a choice, touches AsyncStorage, or syncs to an account.

import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { DARK_THEME, LIGHT_THEME, WARM_THEME, type ThemeId, type ThemeTokens } from "./tokens";

const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export type AppearanceOption = "system" | ThemeId;

const OPTION_COPY: Record<AppearanceOption, { name: string; description: string }> = {
  system: { name: "System", description: "Follows your device appearance." },
  light: { name: "Light", description: "A clean, bright study environment." },
  dark: { name: "Dark", description: "A dimmer appearance for darker environments." },
  warm: { name: "Warm", description: "Softer, warmer surfaces for a calmer study environment." },
};

// Miniature 3-swatch preview used on each picker card (canvas / surface / accent), rather than a
// full mock screen — enough to compare at a glance without needing four full interfaces on one
// row.
function MiniSwatch({ tokens, dark }: { tokens: ThemeTokens; dark?: boolean }) {
  return (
    <View style={[styles.swatch, { backgroundColor: tokens.canvas, borderColor: tokens.border }]}>
      <View style={[styles.swatchCard, { backgroundColor: tokens.surface, borderColor: tokens.border }]}>
        <View style={[styles.swatchAccentBar, { backgroundColor: tokens.accent }]} />
        <View style={[styles.swatchTextLine, { backgroundColor: dark ? tokens.textSecondary : tokens.textPrimary, width: "70%" }]} />
        <View style={[styles.swatchTextLine, { backgroundColor: tokens.textMuted, width: "45%" }]} />
      </View>
    </View>
  );
}

function SystemMiniSwatch() {
  // Shows both resolved states split down the middle, rather than picking one, so it's clear
  // System isn't a fifth palette of its own — it's a behavior that resolves to Light or Dark.
  return (
    <View style={[styles.swatch, styles.systemSwatch]}>
      <View style={[styles.systemHalf, { backgroundColor: LIGHT_THEME.canvas }]}>
        <View style={[styles.swatchAccentBar, { backgroundColor: LIGHT_THEME.accent, width: 14 }]} />
      </View>
      <View style={[styles.systemHalf, { backgroundColor: DARK_THEME.canvas }]}>
        <View style={[styles.swatchAccentBar, { backgroundColor: DARK_THEME.accent, width: 14 }]} />
      </View>
    </View>
  );
}

export function ThemePickerConcept({
  selected,
  onSelect,
}: {
  selected: AppearanceOption;
  onSelect: (option: AppearanceOption) => void;
}) {
  const options: AppearanceOption[] = ["system", "light", "dark", "warm"];

  return (
    <View style={styles.grid}>
      {options.map((option) => {
        const isSelected = option === selected;
        const copy = OPTION_COPY[option];
        return (
          <Pressable
            key={option}
            onPress={() => onSelect(option)}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={`${copy.name} appearance. ${copy.description}${isSelected ? ". Currently selected." : ""}`}
            style={[styles.optionCard, isSelected && styles.optionCardSelected]}
          >
            {option === "system" ? <SystemMiniSwatch /> : <MiniSwatch tokens={{ light: LIGHT_THEME, dark: DARK_THEME, warm: WARM_THEME }[option]} dark={option === "dark"} />}
            <View style={styles.optionTextBlock}>
              <View style={styles.optionNameRow}>
                <Text style={styles.optionName}>{copy.name}</Text>
                {/* Selected state never relies on color alone: checkmark icon + border weight +
                    accessibilityState above all indicate selection redundantly. */}
                {isSelected && (
                  <View style={styles.selectedBadge}>
                    <Ionicons name="checkmark-circle" size={18} color="#1D7B7A" />
                  </View>
                )}
              </View>
              <Text style={styles.optionDescription}>{copy.description}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const ACCENT_CONCEPTS = [
  { name: "Interval Teal", hex: "#1D7B7A", isDefault: true },
  { name: "Ocean Blue", hex: "#2E6FB0", isDefault: false },
  { name: "Quiet Violet", hex: "#6B5B95", isDefault: false },
] as const;

export function AccentColorFutureConcept() {
  return (
    <View style={styles.accentSection}>
      <Text style={styles.accentSectionTitle}>Future exploration — Accent Color</Text>
      <Text style={styles.accentSectionBody}>
        Not implemented. Longer term, Appearance (canvas/surface/text/borders) and Accent
        (buttons/selected states/progress/links) may become independent choices. This is a
        restrained concept only — three accents, not an open color picker — and is not applied to
        the interface study above.
      </Text>
      <View style={styles.accentSwatchRow}>
        {ACCENT_CONCEPTS.map((a) => (
          <View key={a.name} style={styles.accentSwatchCard}>
            <View style={[styles.accentDot, { backgroundColor: a.hex }]}>
              {a.isDefault && <Ionicons name="checkmark" size={16} color="#FFFFFF" />}
            </View>
            <Text style={styles.accentName}>{a.name}</Text>
            {a.isDefault && <Text style={styles.accentDefaultLabel}>Current beta default</Text>}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: spacing.md },
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#E1E4E8",
    backgroundColor: "#FFFFFF",
  },
  optionCardSelected: {
    borderColor: "#1D7B7A",
    backgroundColor: "#E3F3F2",
  },
  swatch: {
    width: 64,
    height: 64,
    borderRadius: 12,
    borderWidth: 1,
    padding: 6,
    justifyContent: "flex-end",
  },
  swatchCard: {
    borderRadius: 6,
    borderWidth: 1,
    padding: 5,
    gap: 3,
  },
  swatchAccentBar: { height: 4, width: 20, borderRadius: 2, marginBottom: 1 },
  swatchTextLine: { height: 3, borderRadius: 1.5, opacity: 0.85 },
  systemSwatch: { flexDirection: "row", padding: 0, overflow: "hidden", borderColor: "#E1E4E8" },
  systemHalf: { flex: 1, alignItems: "center", justifyContent: "center" },
  optionTextBlock: { flex: 1, gap: 2 },
  optionNameRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  optionName: { fontSize: 16, fontWeight: "700", color: "#1B2430" },
  selectedBadge: {},
  optionDescription: { fontSize: 13, color: "#5B6572" },
  accentSection: {
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: "#E1E4E8",
    gap: spacing.sm,
  },
  accentSectionTitle: { fontSize: 15, fontWeight: "700", color: "#1B2430" },
  accentSectionBody: { fontSize: 13, color: "#5B6572", lineHeight: 18 },
  accentSwatchRow: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.xs },
  accentSwatchCard: { alignItems: "center", gap: 4, width: 92 },
  accentDot: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  accentName: { fontSize: 12, fontWeight: "600", color: "#1B2430", textAlign: "center" },
  accentDefaultLabel: { fontSize: 10, color: "#5B6572", textAlign: "center" },
});
