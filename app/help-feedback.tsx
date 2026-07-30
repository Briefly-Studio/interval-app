import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";

import { formatDiagnosticSummary, gatherDiagnosticSummary } from "../src/domain/diagnosticSummary";
import { contactSupport } from "../src/domain/supportContact";
import { useTranslation } from "../src/i18n";
import type { TranslateFn } from "../src/i18n/translateFn";
import { Card } from "../src/ui/Card";
import { IconButton } from "../src/ui/IconButton";
import { Screen } from "../src/ui/Screen";
import { SettingsRow } from "../src/ui/SettingsRow";
import { colors, spacing, typography } from "../src/ui/theme";

// Three actions below (bug report, suggestion, support request) all route through the same
// contactSupport() from src/domain/supportContact.ts, differing only in the localized
// subject/body context that gets prefilled — none of them auto-include diagnostic data or
// study content, per the product spec. Only the explicit "Copy diagnostic summary" action
// gathers and copies diagnostic info, and only on direct user tap.
type ContactKind = "bug" | "suggestion" | "support";

function contactRequestFor(t: TranslateFn, kind: ContactKind): { subject: string; body: string } {
  switch (kind) {
    case "bug":
      return { subject: t("helpFeedback.bugReport.subject"), body: t("helpFeedback.bugReport.body") };
    case "suggestion":
      return { subject: t("helpFeedback.suggestion.subject"), body: t("helpFeedback.suggestion.body") };
    case "support":
      return { subject: t("helpFeedback.supportRequest.subject"), body: t("helpFeedback.supportRequest.body") };
  }
}

export default function HelpFeedbackScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [pendingAction, setPendingAction] = useState<ContactKind | "diagnostics" | null>(null);

  const runContactAction = async (kind: ContactKind) => {
    if (pendingAction) return;
    setPendingAction(kind);
    try {
      const result = await contactSupport(contactRequestFor(t, kind));
      if (result === "copied") {
        Alert.alert(t("helpFeedback.result.copiedTitle"), t("helpFeedback.result.copiedBody"));
      } else if (result === "failed") {
        Alert.alert(t("helpFeedback.result.failedTitle"), t("helpFeedback.result.failedBody"));
      }
      // "opened" hands off to the OS mail composer, which is its own visible confirmation —
      // no additional in-app alert needed.
    } finally {
      setPendingAction(null);
    }
  };

  const runCopyDiagnostics = async () => {
    if (pendingAction) return;
    setPendingAction("diagnostics");
    try {
      const summary = await gatherDiagnosticSummary();
      const text = formatDiagnosticSummary(summary);
      await Clipboard.setStringAsync(text);
      // Deliberately no logging of `text` here — it must never be logged, only copied on this
      // explicit, direct user tap.
      Alert.alert(t("helpFeedback.diagnosticCopiedTitle"), t("helpFeedback.diagnosticCopiedBody"));
    } catch {
      Alert.alert(t("helpFeedback.diagnosticCopyFailedTitle"), t("helpFeedback.diagnosticCopyFailedBody"));
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <Screen scroll>
      <View style={styles.header}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} />
        <Text style={typography.title}>{t("helpFeedback.screenTitle")}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t("helpFeedback.sections.contact")}</Text>
        <Card style={styles.rowGroup}>
          <SettingsRow
            label={t("helpFeedback.reportBug")}
            loading={pendingAction === "bug"}
            onPress={() => runContactAction("bug")}
          />
          <View style={styles.divider} />
          <SettingsRow
            label={t("helpFeedback.suggestImprovement")}
            loading={pendingAction === "suggestion"}
            onPress={() => runContactAction("suggestion")}
          />
          <View style={styles.divider} />
          <SettingsRow
            label={t("helpFeedback.contactSupport")}
            loading={pendingAction === "support"}
            onPress={() => runContactAction("support")}
          />
        </Card>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t("helpFeedback.sections.diagnostics")}</Text>
        <Card style={styles.rowGroup}>
          <SettingsRow
            label={t("helpFeedback.copyDiagnosticSummary")}
            subtitle={t("helpFeedback.copyDiagnosticSummarySubtitle")}
            loading={pendingAction === "diagnostics"}
            onPress={runCopyDiagnostics}
          />
        </Card>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t("helpFeedback.sections.about")}</Text>
        <Card style={styles.rowGroup}>
          <SettingsRow
            label={t("helpFeedback.viewBetaNotice")}
            onPress={() => router.push({ pathname: "/beta-notice" as any })}
          />
          <View style={styles.divider} />
          <SettingsRow
            label={t("helpFeedback.viewPrivacyNotice")}
            onPress={() => router.push({ pathname: "/privacy-notice" as any })}
          />
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  section: { gap: spacing.sm },
  sectionLabel: { ...typography.label },
  rowGroup: { gap: 0 },
  divider: { height: 1, backgroundColor: colors.border },
});
