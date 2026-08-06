import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AuthService } from "../src/auth/AuthService";
import { contactSupport } from "../src/domain/supportContact";
import { useTranslation } from "../src/i18n";
import type { WorkspaceScope } from "../src/storage/workspaceScope";
import { Button } from "../src/ui/Button";
import { Card } from "../src/ui/Card";
import { EmptyState } from "../src/ui/EmptyState";
import { IconButton } from "../src/ui/IconButton";
import { Screen } from "../src/ui/Screen";
import { TextField } from "../src/ui/TextField";
import { useTheme } from "@/src/theme";

// Mirrors contactSupport()'s resolved outcomes (see src/domain/supportContact.ts), plus null for
// "hasn't been attempted yet in this screen session."
type RequestOutcome = "opened" | "copied" | "failed" | null;

export default function DeleteAccountScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, spacing, typography } = useTheme();

  const [scope, setScope] = useState<WorkspaceScope>({ kind: "guest" });
  const [scopeLoaded, setScopeLoaded] = useState(false);

  const [confirmText, setConfirmText] = useState("");
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<RequestOutcome>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const activeScope = await AuthService.getActiveScope();
      if (!alive) return;
      setScope(activeScope);
      setScopeLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const confirmPhrase = t("deleteAccount.confirmPhrase");
  const confirmMatches = confirmText === confirmPhrase;
  const confirmError =
    confirmTouched && confirmText.length > 0 && !confirmMatches
      ? t("deleteAccount.confirmMismatchError")
      : undefined;

  const canSubmit = confirmMatches && !submitting;

  const onRequestDeletion = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // subject/body are deliberately generic, plain-language context — never the user's email,
      // sub, tokens, or any device/diagnostic identifier. The human on the other end corresponds
      // with the user directly via whatever contact channel this opens/copies into.
      const result = await contactSupport({
        subject: t("deleteAccount.supportSubject"),
        body: t("deleteAccount.supportBody"),
      });
      setOutcome(result);
    } catch {
      // contactSupport's contract promises it resolves to one of the three outcomes rather than
      // throwing, but this is not assumed blindly — an unexpected throw is treated the same as
      // "failed" so the user is never left with a silent dead end.
      setOutcome("failed");
    } finally {
      setSubmitting(false);
    }
  };

  const header = (
    <View style={[styles.header, { gap: spacing.sm }]}>
      <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} disabled={submitting} />
      <Text style={[typography.title, { color: colors.textPrimary }]} accessibilityRole="header">{t("deleteAccount.title")}</Text>
    </View>
  );

  if (!scopeLoaded) {
    return <Screen>{header}</Screen>;
  }

  // Defensive, not a normal route — same reasoning as change-password.tsx: this screen is only
  // ever meant to be reached from an authenticated context.
  if (scope.kind !== "user") {
    return (
      <Screen>
        {header}
        <View style={styles.emptyFill}>
          <EmptyState
            icon="lock-closed-outline"
            title={t("deleteAccount.notSignedInTitle")}
            description={t("deleteAccount.notSignedInDescription")}
          >
            <Button
              label={t("deleteAccount.signIn")}
              variant="primary"
              fullWidth
              onPress={() => router.push("/sign-in")}
            />
          </EmptyState>
        </View>
      </Screen>
    );
  }

  if (outcome === "opened" || outcome === "copied") {
    return (
      <Screen>
        {header}
        <View style={styles.emptyFill}>
          <EmptyState
            icon="mail-outline"
            title={outcome === "opened" ? t("deleteAccount.resultOpenedTitle") : t("deleteAccount.resultCopiedTitle")}
            description={outcome === "opened" ? t("deleteAccount.resultOpenedBody") : t("deleteAccount.resultCopiedBody")}
          >
            <Button label={t("deleteAccount.done")} variant="primary" fullWidth onPress={() => router.back()} />
          </EmptyState>
        </View>
      </Screen>
    );
  }

  if (outcome === "failed") {
    return (
      <Screen scroll>
        {header}
        <Card style={[styles.sectionCard, { gap: spacing.xs }]}>
          <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{t("deleteAccount.resultFailedTitle")}</Text>
          <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("deleteAccount.resultFailedBody")}</Text>
        </Card>
        <Card style={[styles.sectionCard, { gap: spacing.xs }]}>
          <Text style={[typography.label, { color: colors.textPrimary }]}>{t("deleteAccount.resultFailedFallbackLabel")}</Text>
          <Text style={[typography.secondary, { color: colors.textSecondary }]} selectable>
            {t("deleteAccount.supportBody")}
          </Text>
        </Card>
        <Button
          label={t("deleteAccount.tryAgain")}
          variant="secondary"
          fullWidth
          onPress={() => setOutcome(null)}
        />
        <Button label={t("deleteAccount.done")} variant="ghost" fullWidth onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      {header}

      <Card style={[styles.sectionCard, { gap: spacing.xs }]}>
        <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("deleteAccount.intro")}</Text>
      </Card>

      <Card style={[styles.sectionCard, { gap: spacing.xs }]}>
        <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{t("deleteAccount.howItWorksTitle")}</Text>
        <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("deleteAccount.howItWorksBody")}</Text>
      </Card>

      <Card style={[styles.sectionCard, { gap: spacing.xs }]}>
        <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{t("deleteAccount.exportTitle")}</Text>
        <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("deleteAccount.exportBody")}</Text>
        <Button
          label={t("deleteAccount.exportButton")}
          variant="secondary"
          fullWidth
          onPress={() => router.push("/")}
        />
      </Card>

      <Card style={[styles.sectionCard, { gap: spacing.xs }]}>
        <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{t("deleteAccount.confirmTitle")}</Text>
        <Text style={[typography.secondary, { color: colors.textSecondary }]}>
          {t("deleteAccount.confirmInstruction", { phrase: confirmPhrase })}
        </Text>
        <TextField
          value={confirmText}
          onChangeText={setConfirmText}
          onBlur={() => setConfirmTouched(true)}
          error={confirmError}
          placeholder={t("deleteAccount.confirmPlaceholder")}
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!submitting}
        />
      </Card>

      <Button
        label={t("deleteAccount.requestButton")}
        variant="danger"
        fullWidth
        loading={submitting}
        disabled={!canSubmit}
        onPress={onRequestDeletion}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  emptyFill: { flex: 1, justifyContent: "center" },
  sectionCard: {},
});
