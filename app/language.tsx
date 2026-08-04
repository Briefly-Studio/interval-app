import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTranslation, type LanguagePreference } from "../src/i18n";
import { useTheme } from "@/src/theme";
import { Card } from "../src/ui/Card";
import { IconButton } from "../src/ui/IconButton";
import { Screen } from "../src/ui/Screen";

// English and Spanish are the supported languages today — System default, English, or an
// explicit Español override. No flags, no country ties: language and country are deliberately
// decoupled per the localization spec.
const OPTIONS: {
  value: LanguagePreference;
  labelKey: "settings.languageOptions.system" | "settings.languageOptions.english" | "settings.languageOptions.espanol";
}[] = [
  { value: "system", labelKey: "settings.languageOptions.system" },
  { value: "en", labelKey: "settings.languageOptions.english" },
  { value: "es", labelKey: "settings.languageOptions.espanol" },
];

export default function LanguageScreen() {
  const router = useRouter();
  const { t, preference, setLanguagePreference } = useTranslation();
  const { colors, iconSizes, spacing, touchTarget, typography } = useTheme();

  return (
    <Screen>
      <View style={[styles.header, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} />
        <Text style={[typography.title, { color: colors.textPrimary }]}>{t("settings.language")}</Text>
      </View>

      <Card style={styles.rowGroup}>
        {OPTIONS.map((option, index) => {
          const selected = preference === option.value;
          return (
            <View key={option.value}>
              {index > 0 ? <View style={[styles.divider, { backgroundColor: colors.border }]} /> : null}
              <Pressable
                onPress={() => setLanguagePreference(option.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={t(option.labelKey)}
                style={({ pressed }) => [
                  styles.row,
                  { minHeight: touchTarget.min, paddingVertical: spacing.sm },
                  pressed && { backgroundColor: colors.surfaceMuted },
                ]}
              >
                <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{t(option.labelKey)}</Text>
                {selected ? <Ionicons name="checkmark" size={iconSizes.md} color={colors.accent} /> : null}
              </Pressable>
            </View>
          );
        })}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  rowGroup: { gap: 0 },
  divider: { height: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
