import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTranslation } from "../src/i18n";
import { DARK_TOKENS, LIGHT_TOKENS, useTheme, WARM_TOKENS, type AppearanceMode, type ThemeTokens } from "@/src/theme";
import { Card } from "../src/ui/Card";
import { IconButton } from "../src/ui/IconButton";
import { Screen } from "../src/ui/Screen";

const MODES: { value: AppearanceMode; copyKey: "system" | "light" | "dark" | "warm" }[] = [
  { value: "system", copyKey: "system" },
  { value: "light", copyKey: "light" },
  { value: "dark", copyKey: "dark" },
  { value: "warm", copyKey: "warm" },
];

// Miniature preview: a small canvas/surface/accent swatch per option, matching the Theme Lab's
// own picker concept — small enough to sit inline in a settings-style row, enough to compare at a
// glance.
function MiniSwatch({ tokens }: { tokens: ThemeTokens }) {
  return (
    <View style={[styles.swatch, { backgroundColor: tokens.canvas, borderColor: tokens.border }]}>
      <View style={[styles.swatchAccent, { backgroundColor: tokens.accent }]} />
    </View>
  );
}

function SystemSwatch() {
  // Split light/dark, not a fifth palette — System is a behavior, not its own visual identity.
  return (
    <View style={[styles.swatch, styles.systemSwatch]}>
      <View style={[styles.systemHalf, { backgroundColor: LIGHT_TOKENS.canvas }]}>
        <View style={[styles.swatchAccent, styles.systemAccent, { backgroundColor: LIGHT_TOKENS.accent }]} />
      </View>
      <View style={[styles.systemHalf, { backgroundColor: DARK_TOKENS.canvas }]}>
        <View style={[styles.swatchAccent, styles.systemAccent, { backgroundColor: DARK_TOKENS.accent }]} />
      </View>
    </View>
  );
}

export default function AppearanceScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, radii, spacing, typography, selectedMode, setAppearanceMode } = useTheme();

  return (
    <Screen scroll>
      <View style={[styles.header, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} />
        <Text style={[typography.title, { color: colors.textPrimary }]} accessibilityRole="header">{t("appearance.title")}</Text>
      </View>

      <View style={[styles.optionList, { gap: spacing.md }]}>
        {MODES.map((option) => {
          const selected = selectedMode === option.value;
          const name = t(`appearance.${option.copyKey}.name` as const);
          const description = t(`appearance.${option.copyKey}.description` as const);
          const swatchTokens =
            option.value === "light" ? LIGHT_TOKENS : option.value === "dark" ? DARK_TOKENS : option.value === "warm" ? WARM_TOKENS : null;

          return (
            <Pressable
              key={option.value}
              onPress={() => setAppearanceMode(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${name}. ${description}${selected ? `. ${t("appearance.selectedLabel")}` : ""}`}
              style={({ pressed }) => [
                styles.optionCard,
                {
                  gap: spacing.md,
                  padding: spacing.md,
                  borderRadius: radii.lg,
                  borderColor: selected ? colors.accent : colors.border,
                  backgroundColor: selected ? colors.accentSubtle : colors.surface,
                },
                pressed && !selected && { backgroundColor: colors.surfaceMuted },
              ]}
            >
              {swatchTokens ? <MiniSwatch tokens={swatchTokens} /> : <SystemSwatch />}
              <View style={styles.optionText}>
                <View style={[styles.optionNameRow, { gap: spacing.xs }]}>
                  <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{name}</Text>
                  {/* Selection is never color-only: a checkmark icon renders alongside the
                      heavier border/tint above, and accessibilityState.selected is set
                      regardless of whether the icon is visually present. */}
                  {selected && <Ionicons name="checkmark-circle" size={18} color={colors.accent} />}
                </View>
                <Text style={[typography.secondary, { color: colors.textSecondary }]}>{description}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Card style={{ marginTop: spacing.lg }}>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>{t("appearance.personalizationNote")}</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  optionList: {},
  optionCard: { flexDirection: "row", alignItems: "center", borderWidth: 1.5 },
  optionText: { flex: 1, gap: 2 },
  optionNameRow: { flexDirection: "row", alignItems: "center" },
  swatch: { width: 48, height: 48, borderRadius: 10, borderWidth: 1, justifyContent: "flex-end", padding: 5 },
  swatchAccent: { height: 5, width: 20, borderRadius: 2.5 },
  systemSwatch: { flexDirection: "row", padding: 0, overflow: "hidden" },
  systemHalf: { flex: 1, alignItems: "center", justifyContent: "flex-end", paddingBottom: 5 },
  systemAccent: { width: 12 },
});
