import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AuthService } from "../src/auth/AuthService";
import { getAuthDiagnosticCode, mapAuthError } from "../src/auth/authErrors";
import { BrandMark } from "../src/ui/BrandMark";
import { Button } from "../src/ui/Button";
import { Card } from "../src/ui/Card";
import { Screen } from "../src/ui/Screen";
import { TextField } from "../src/ui/TextField";
import { colors, spacing, typography } from "../src/ui/theme";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignInScreen() {
  const router = useRouter();
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
      <Text style={typography.title}>Welcome back.</Text>
      <Text style={typography.secondary}>Continue studying where you left off.</Text>

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
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="Your password"
          autoCapitalize="none"
          autoComplete="password"
          isPassword
          editable={!loading}
        />
        {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
      </Card>

      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Button
          label="Cancel"
          variant="ghost"
          onPress={() => router.dismissAll()}
          disabled={loading}
          style={{ flex: 1 }}
        />
        <Button
          label="Sign in"
          variant="primary"
          onPress={onSignIn}
          loading={loading}
          disabled={!isValid}
          style={{ flex: 1 }}
        />
      </View>

      <Button
        label="Create an account"
        variant="ghost"
        onPress={() => router.replace("/sign-up")}
        disabled={loading}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  errorText: { ...typography.caption, color: colors.danger },
});
