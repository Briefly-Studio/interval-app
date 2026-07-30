import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AuthService } from "../src/auth/AuthService";
import { getAuthDiagnosticCode, mapAuthError } from "../src/auth/authErrors";
import { useTranslation } from "../src/i18n";
import { Button } from "../src/ui/Button";
import { Card } from "../src/ui/Card";
import { Screen } from "../src/ui/Screen";
import { TextField } from "../src/ui/TextField";
import { colors, spacing, typography } from "../src/ui/theme";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_CODE_LENGTH = 6;

export default function ConfirmSignUpScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ email?: string }>();
  const initialEmail = params.email?.trim();
  const [email, setEmail] = useState(initialEmail ?? "");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const isValid = useMemo(
    () => EMAIL_PATTERN.test(email.trim()) && code.trim().length >= MIN_CODE_LENGTH,
    [email, code]
  );

  async function onConfirm() {
    if (!isValid || loading) return;
    setErrorText(null);
    setLoading(true);
    try {
      await AuthService.confirmSignUp(email.trim(), code.trim());
      router.replace({ pathname: "/sign-in", params: { email: email.trim() } });
    } catch (error) {
      console.log("[auth] confirm sign-up failed:", getAuthDiagnosticCode(error));
      setErrorText(mapAuthError(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen scroll>
      <Text style={typography.title}>{t("auth.confirmSignUp.title")}</Text>
      <Text style={typography.secondary}>
        {initialEmail
          ? t("auth.confirmSignUp.subtitleWithEmail", { email: initialEmail })
          : t("auth.confirmSignUp.subtitleGeneric")}
      </Text>

      <Card style={{ gap: spacing.md }}>
        <TextField
          label={t("auth.emailLabel")}
          value={email}
          onChangeText={setEmail}
          placeholder={t("auth.emailPlaceholder")}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          editable={!loading}
        />
        <TextField
          label={t("auth.confirmSignUp.codeLabel")}
          value={code}
          onChangeText={setCode}
          placeholder={t("auth.confirmSignUp.codePlaceholder")}
          autoCapitalize="none"
          keyboardType="number-pad"
          editable={!loading}
        />
        {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
      </Card>

      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Button
          label={t("auth.confirmSignUp.backToSignInButton")}
          variant="ghost"
          onPress={() => router.replace("/sign-in")}
          disabled={loading}
          style={{ flex: 1 }}
        />
        <Button
          label={t("auth.confirmSignUp.submitButton")}
          variant="primary"
          onPress={onConfirm}
          loading={loading}
          disabled={!isValid}
          style={{ flex: 1 }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  errorText: { ...typography.caption, color: colors.danger },
});
