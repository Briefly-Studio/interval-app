import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { mirrorIfRtl, useLayoutDirection } from "../src/i18n/direction";
import { useTranslation, type LanguagePreference } from "../src/i18n";
import { ENABLED_LOCALES, LOCALE_REGISTRY } from "../src/i18n/localeRegistry";
import { useTheme } from "@/src/theme";
import { Card } from "../src/ui/Card";
import { IconButton } from "../src/ui/IconButton";
import { Screen } from "../src/ui/Screen";

export default function LanguageScreen() {
  const router = useRouter();
  const { t, preference, setLanguagePreference } = useTranslation();
  const { colors, iconSizes, spacing, touchTarget, typography } = useTheme();
  const { direction, row, text } = useLayoutDirection();

  // System default first, then every currently-enabled locale (ENABLED_LOCALES —
  // src/i18n/localeRegistry.ts) in its own native name — no flags, no country ties: language and
  // country are deliberately decoupled per the localization spec. Adding a future locale here
  // requires no change to this screen at all: it appears automatically once its registry entry
  // is flipped to enabled: true.
  const options = useMemo(
    () => [
      { value: "system" as LanguagePreference, label: t("settings.languageOptions.system") },
      ...ENABLED_LOCALES.map((code) => ({ value: code as LanguagePreference, label: LOCALE_REGISTRY[code].nativeName })),
    ],
    [t]
  );

  return (
    <Screen>
      <View style={[styles.header, row, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} />
        <Text style={[typography.title, text, { color: colors.textPrimary }]} accessibilityRole="header">{t("settings.language")}</Text>
      </View>

      <Card style={styles.rowGroup}>
        {options.map((option, index) => {
          const selected = preference === option.value;
          return (
            <View key={option.value}>
              {index > 0 ? <View style={[styles.divider, { backgroundColor: colors.border }]} /> : null}
              <Pressable
                onPress={() => setLanguagePreference(option.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={option.label}
                style={({ pressed }) => [
                  styles.row,
                  row,
                  { minHeight: touchTarget.min, paddingVertical: spacing.sm },
                  pressed && { backgroundColor: colors.surfaceMuted },
                ]}
              >
                <Text style={[typography.bodyMedium, text, { color: colors.textPrimary }]}>{option.label}</Text>
                {selected ? (
                  <Ionicons name="checkmark" size={iconSizes.md} color={colors.accent} style={mirrorIfRtl(direction)} />
                ) : null}
              </Pressable>
            </View>
          );
        })}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center" },
  rowGroup: { gap: 0 },
  divider: { height: 1 },
  row: {
    alignItems: "center",
    justifyContent: "space-between",
  },
});
