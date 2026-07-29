import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTranslation, type LanguagePreference } from "../src/i18n";
import { Card } from "../src/ui/Card";
import { IconButton } from "../src/ui/IconButton";
import { Screen } from "../src/ui/Screen";
import { colors, iconSizes, spacing, touchTarget, typography } from "../src/ui/theme";

// English is the only real language today — this screen exists to establish the selection
// model (System default vs. an explicit language) so adding a second language later is a
// content change, not a UI change. No flags, no country ties: language and country are
// deliberately decoupled per the localization spec.
const OPTIONS: { value: LanguagePreference; labelKey: "settings.languageOptions.system" | "settings.languageOptions.english" }[] = [
  { value: "system", labelKey: "settings.languageOptions.system" },
  { value: "en", labelKey: "settings.languageOptions.english" },
];

export default function LanguageScreen() {
  const router = useRouter();
  const { t, preference, setLanguagePreference } = useTranslation();

  return (
    <Screen>
      <View style={styles.header}>
        <IconButton name="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
        <Text style={typography.title}>{t("settings.language")}</Text>
      </View>

      <Card style={styles.rowGroup}>
        {OPTIONS.map((option, index) => {
          const selected = preference === option.value;
          return (
            <View key={option.value}>
              {index > 0 ? <View style={styles.divider} /> : null}
              <Pressable
                onPress={() => setLanguagePreference(option.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={t(option.labelKey)}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <Text style={typography.bodyMedium}>{t(option.labelKey)}</Text>
                {selected ? <Ionicons name="checkmark" size={iconSizes.md} color={colors.accentStrong} /> : null}
              </Pressable>
            </View>
          );
        })}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowGroup: { gap: 0 },
  divider: { height: 1, backgroundColor: colors.border },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: touchTarget.min,
    paddingVertical: spacing.sm,
  },
  pressed: { backgroundColor: colors.surfaceMuted },
});
