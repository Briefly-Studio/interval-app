import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AuthService } from "../src/auth/AuthService";
import { getAuthDiagnosticCode, getChangePasswordErrorKind } from "../src/auth/authErrors";
import { getPasswordRequirements, isPasswordValid } from "../src/auth/passwordPolicy";
import { useTranslation } from "../src/i18n";
import type { TranslateFn } from "../src/i18n/translateFn";
import type { WorkspaceScope } from "../src/storage/workspaceScope";
import { useTheme } from "@/src/theme";
import { Button } from "../src/ui/Button";
import { Card } from "../src/ui/Card";
import { EmptyState } from "../src/ui/EmptyState";
import { IconButton } from "../src/ui/IconButton";
import { Screen } from "../src/ui/Screen";
import { TextField } from "../src/ui/TextField";

// Duplicated (not imported) from app/sign-up.tsx's PasswordChecklist: that component lives in a
// screen file outside this batch's file ownership, so its minimal rendering logic is re-created
// here locally rather than editing sign-up.tsx to export it. Both read from the same canonical
// getPasswordRequirements()/isPasswordValid() in src/auth/passwordPolicy.ts, so the requirements
// themselves never drift — only this presentation snippet is duplicated.
function PasswordChecklist({ password, t }: { password: string; t: TranslateFn }) {
  const { colors, spacing, typography } = useTheme();
  const requirements = useMemo(() => getPasswordRequirements(t), [t]);

  return (
    <View style={[styles.checklist, { gap: spacing.xs }]}>
      {requirements.map((requirement) => {
        const met = requirement.met(password);
        return (
          <View key={requirement.key} style={[styles.checklistRow, { gap: spacing.xs }]}>
            <Ionicons
              name={met ? "checkmark-circle" : "ellipse-outline"}
              size={16}
              color={met ? colors.success : colors.textSecondary}
            />
            <Text style={[typography.caption, met ? { color: colors.success } : { color: colors.textSecondary }]}>
              {requirement.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default function ChangePasswordScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, spacing, typography } = useTheme();

  const [scope, setScope] = useState<WorkspaceScope>({ kind: "guest" });
  const [scopeLoaded, setScopeLoaded] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newPasswordTouched, setNewPasswordTouched] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

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

  const newPasswordValid = isPasswordValid(newPassword);
  const confirmMatches = confirmPassword.length > 0 && confirmPassword === newPassword;
  const isUnchanged = newPassword.length > 0 && newPassword === currentPassword;

  const canSubmit =
    currentPassword.length > 0 && newPasswordValid && confirmMatches && !isUnchanged && !submitting;

  const confirmError =
    confirmTouched && confirmPassword.length > 0 && !confirmMatches
      ? t("changePassword.confirmMismatchError")
      : undefined;

  const unchangedError =
    newPasswordTouched && isUnchanged ? t("changePassword.sameAsCurrentError") : undefined;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setErrorText(null);
    setSubmitting(true);
    try {
      await AuthService.changePassword(currentPassword, newPassword);
      setSucceeded(true);
    } catch (error) {
      console.log("[change-password] failed:", getAuthDiagnosticCode(error));
      setErrorText(t(`changePassword.error.${getChangePasswordErrorKind(error)}`));
    } finally {
      setSubmitting(false);
    }
  };

  const header = (
    <View style={[styles.header, { gap: spacing.sm }]}>
      <IconButton
        name="chevron-back"
        accessibilityLabel={t("common.back")}
        onPress={() => router.back()}
        disabled={submitting}
      />
      <Text style={[typography.title, { color: colors.textPrimary }]} accessibilityRole="header">{t("changePassword.title")}</Text>
    </View>
  );

  // Nothing renders below the header until scope is known — never flash the working form (or
  // any interactive state) for a guest while the async scope check is still in flight.
  if (!scopeLoaded) {
    return <Screen>{header}</Screen>;
  }

  // Defensive, not a normal route: this screen should only ever be reached from an
  // authenticated context, but a token can expire while it happens to be open, and nothing
  // upstream of this screen is guaranteed to re-check scope right before navigating here.
  if (scope.kind !== "user") {
    return (
      <Screen>
        {header}
        <View style={styles.emptyFill}>
          <EmptyState
            icon="lock-closed-outline"
            title={t("changePassword.notSignedInTitle")}
            description={t("changePassword.notSignedInDescription")}
          >
            <Button
              label={t("changePassword.signIn")}
              variant="primary"
              fullWidth
              onPress={() => router.push("/sign-in")}
            />
          </EmptyState>
        </View>
      </Screen>
    );
  }

  if (succeeded) {
    return (
      <Screen>
        {header}
        <View style={styles.emptyFill}>
          <EmptyState
            icon="checkmark-circle-outline"
            title={t("changePassword.successTitle")}
            description={t("changePassword.successDescription")}
          >
            <Button label={t("changePassword.done")} variant="primary" fullWidth onPress={() => router.back()} />
          </EmptyState>
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      {header}

      <Card style={{ gap: spacing.md }}>
        <TextField
          label={t("changePassword.currentPasswordLabel")}
          value={currentPassword}
          onChangeText={setCurrentPassword}
          autoCapitalize="none"
          autoComplete="current-password"
          isPassword
          editable={!submitting}
        />
        <TextField
          label={t("changePassword.newPasswordLabel")}
          value={newPassword}
          onChangeText={(text) => {
            setNewPassword(text);
            if (!newPasswordTouched) setNewPasswordTouched(true);
          }}
          onBlur={() => setNewPasswordTouched(true)}
          error={unchangedError}
          autoCapitalize="none"
          autoComplete="new-password"
          isPassword
          editable={!submitting}
        />
        {newPasswordTouched ? <PasswordChecklist password={newPassword} t={t} /> : null}
        <TextField
          label={t("changePassword.confirmPasswordLabel")}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          onBlur={() => setConfirmTouched(true)}
          error={confirmError}
          autoCapitalize="none"
          autoComplete="new-password"
          isPassword
          editable={!submitting}
        />
        {errorText ? <Text style={[typography.caption, { color: colors.danger }]}>{errorText}</Text> : null}
      </Card>

      <Button
        label={t("changePassword.submit")}
        variant="primary"
        fullWidth
        loading={submitting}
        disabled={!canSubmit}
        onPress={onSubmit}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  emptyFill: { flex: 1, justifyContent: "center" },
  checklist: {},
  checklistRow: { flexDirection: "row", alignItems: "center" },
});
