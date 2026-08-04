import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { useTranslation } from "../src/i18n";
import { useTheme } from "@/src/theme";
import { Button } from "../src/ui/Button";
import { Card } from "../src/ui/Card";
import { IconButton } from "../src/ui/IconButton";
import { Screen } from "../src/ui/Screen";

// Static, translated info screen — same "header row + stacked Cards" shape as
// app/sync-status.tsx. Purely presentational: no data fetching, no user input beyond navigation.
const SECTION_KEYS = [
  "status",
  "dataSafety",
  "exports",
  "feedback",
] as const;

export default function BetaNoticeScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, spacing, typography } = useTheme();

  return (
    <Screen scroll>
      <View style={[styles.header, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} />
        <Text style={[typography.title, { color: colors.textPrimary }]}>{t("betaNotice.screenTitle")}</Text>
      </View>

      <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("betaNotice.intro")}</Text>

      {SECTION_KEYS.map((key) => (
        <Card key={key} style={[styles.sectionCard, { gap: spacing.xs }]}>
          <Text style={[typography.subheading, { color: colors.textPrimary }]}>
            {t(`betaNotice.sections.${key}.title`)}
          </Text>
          <Text style={[typography.secondary, { color: colors.textSecondary }]}>
            {t(`betaNotice.sections.${key}.body`)}
          </Text>
        </Card>
      ))}

      <Button
        label={t("betaNotice.helpFeedbackCta")}
        variant="secondary"
        fullWidth
        onPress={() => router.push({ pathname: "/help-feedback" as any })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  sectionCard: {},
});
