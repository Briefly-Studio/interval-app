import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AuthService } from "../src/auth/AuthService";
import { getAuthDiagnosticCode, mapAuthError } from "../src/auth/authErrors";
import { Button } from "../src/ui/Button";
import { Card } from "../src/ui/Card";
import { Screen } from "../src/ui/Screen";
import { TextField } from "../src/ui/TextField";
import { colors, spacing, typography } from "../src/ui/theme";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_CODE_LENGTH = 6;

export default function ConfirmSignUpScreen() {
  const router = useRouter();
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
      <Text style={typography.title}>Confirm your email</Text>
      <Text style={typography.secondary}>
        {initialEmail
          ? `We sent a code to ${initialEmail}.`
          : "Enter the code we sent to your email to finish creating your account."}
      </Text>

      <Card style={{ gap: spacing.md }}>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          editable={!loading}
        />
        <TextField
          label="Confirmation code"
          value={code}
          onChangeText={setCode}
          placeholder="123456"
          autoCapitalize="none"
          keyboardType="number-pad"
          editable={!loading}
        />
        {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
      </Card>

      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Button
          label="Back to sign in"
          variant="ghost"
          onPress={() => router.replace("/sign-in")}
          disabled={loading}
          style={{ flex: 1 }}
        />
        <Button
          label="Confirm"
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
