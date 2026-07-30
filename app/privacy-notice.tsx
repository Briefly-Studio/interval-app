import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { useTranslation } from "../src/i18n";
import { Button } from "../src/ui/Button";
import { Card } from "../src/ui/Card";
import { IconButton } from "../src/ui/IconButton";
import { Screen } from "../src/ui/Screen";
import { spacing, typography } from "../src/ui/theme";

// Static, translated info screen — same "header row + stacked Cards" shape as
// app/sync-status.tsx / app/beta-notice.tsx. Purely presentational: no data fetching. Content is
// deliberately scoped to what this codebase can actually back up today (see the section bodies in
// en.ts) — no legal-review claim, no compliance certification claim, no AWS resource/table/
// endpoint names, no absolute-security or specific-retention-timeline promises.
const SECTION_KEYS = [
  "storage",
  "sync",
  "identity",
  "isolation",
  "noSelling",
  "betaState",
  "ai",
  "contact",
] as const;

export default function PrivacyNoticeScreen() {
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <Screen scroll>
      <View style={styles.header}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} />
        <Text style={typography.title}>{t("privacyNotice.screenTitle")}</Text>
      </View>

      <Text style={typography.secondary}>{t("privacyNotice.intro")}</Text>

      {SECTION_KEYS.map((key) => (
        <Card key={key} style={styles.sectionCard}>
          <Text style={typography.subheading}>{t(`privacyNotice.sections.${key}.title`)}</Text>
          <Text style={typography.secondary}>{t(`privacyNotice.sections.${key}.body`)}</Text>
        </Card>
      ))}

      <Button
        label={t("privacyNotice.helpFeedbackCta")}
        variant="secondary"
        fullWidth
        onPress={() => router.push({ pathname: "/help-feedback" as any })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sectionCard: { gap: spacing.xs },
});
