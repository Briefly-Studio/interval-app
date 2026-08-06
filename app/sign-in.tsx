import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AuthService } from "../src/auth/AuthService";
import { getAuthDiagnosticCode, mapAuthError } from "../src/auth/authErrors";
import { useTranslation } from "../src/i18n";
import { useTheme } from "@/src/theme";
import { BrandMark } from "../src/ui/BrandMark";
import { Button } from "../src/ui/Button";
import { Card } from "../src/ui/Card";
import { Screen } from "../src/ui/Screen";
import { TextField } from "../src/ui/TextField";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignInScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, spacing, typography } = useTheme();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? "");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const isValid = useMemo(
    () => EMAIL_PATTERN.test(email.trim()) && password.length > 0,
    [email, password]
  );

  async function onSignIn() {
    if (!isValid || loading) return;
    setErrorText(null);
    setLoading(true);
    try {
      await AuthService.signIn(email.trim(), password);
      router.replace("/sign-in-transition");
    } catch (error) {
      console.log("[auth] sign-in failed:", getAuthDiagnosticCode(error));
      setErrorText(mapAuthError(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen scroll>
      <BrandMark />
      <Text style={[typography.title, { color: colors.textPrimary }]} accessibilityRole="header">{t("auth.signIn.title")}</Text>
      <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("auth.signIn.subtitle")}</Text>

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
          label={t("auth.signIn.passwordLabel")}
          value={password}
          onChangeText={setPassword}
          placeholder={t("auth.signIn.passwordPlaceholder")}
          autoCapitalize="none"
          autoComplete="password"
          isPassword
          editable={!loading}
        />
        {errorText ? <Text style={[typography.caption, styles.errorText, { color: colors.danger }]}>{errorText}</Text> : null}
      </Card>

      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Button
          label={t("common.cancel")}
          variant="ghost"
          onPress={() => router.dismissAll()}
          disabled={loading}
          style={{ flex: 1 }}
        />
        <Button
          label={t("auth.signIn.submitButton")}
          variant="primary"
          onPress={onSignIn}
          loading={loading}
          disabled={!isValid}
          style={{ flex: 1 }}
        />
      </View>

      <Button
        label={t("auth.signIn.createAccountButton")}
        variant="ghost"
        onPress={() => router.replace("/sign-up")}
        disabled={loading}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  errorText: {},
});
