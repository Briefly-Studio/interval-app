import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AuthService } from "../src/auth/AuthService";
import { getAuthDiagnosticCode, mapAuthError } from "../src/auth/authErrors";
import { getPasswordRequirements, isPasswordValid } from "../src/auth/passwordPolicy";
import { Button } from "../src/ui/Button";
import { Card } from "../src/ui/Card";
import { Screen } from "../src/ui/Screen";
import { TextField } from "../src/ui/TextField";
import { colors, spacing, typography } from "../src/ui/theme";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function PasswordChecklist({ password }: { password: string }) {
  const requirements = useMemo(() => getPasswordRequirements(), []);

  return (
    <View style={styles.checklist}>
      {requirements.map((requirement) => {
        const met = requirement.met(password);
        return (
          <View key={requirement.key} style={styles.checklistRow}>
            <Ionicons
              name={met ? "checkmark-circle" : "ellipse-outline"}
              size={16}
              color={met ? colors.success : colors.textSecondary}
            />
            <Text style={[styles.checklistLabel, met && styles.checklistLabelMet]}>
              {requirement.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default function SignUpScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const emailValid = useMemo(() => EMAIL_PATTERN.test(email.trim()), [email]);
  const passwordValid = useMemo(() => isPasswordValid(password), [password]);
  const canSubmit = emailValid && passwordValid;

  async function onSignUp() {
    if (!canSubmit || loading) return;
    setErrorText(null);
    setLoading(true);
    try {
      await AuthService.signUp(email.trim(), password);
      router.replace({ pathname: "/confirm-sign-up", params: { email: email.trim() } });
    } catch (error) {
      console.log("[auth] sign-up failed:", getAuthDiagnosticCode(error));
      setErrorText(mapAuthError(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen scroll>
      <Text style={typography.title}>Create your account</Text>
      <Text style={typography.secondary}>Sync your decks across devices with a free account.</Text>

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
          onChangeText={(text) => {
            setPassword(text);
            if (!passwordTouched) setPasswordTouched(true);
          }}
          placeholder="Create a password"
          autoCapitalize="none"
          autoComplete="new-password"
          isPassword
          editable={!loading}
        />
        {passwordTouched ? <PasswordChecklist password={password} /> : null}
        {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
      </Card>

      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Button
          label="Sign in instead"
          variant="ghost"
          onPress={() => router.replace("/sign-in")}
          disabled={loading}
          style={{ flex: 1 }}
        />
        <Button
          label="Create account"
          variant="primary"
          onPress={onSignUp}
          loading={loading}
          disabled={!canSubmit}
          style={{ flex: 1 }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  errorText: { ...typography.caption, color: colors.danger },
  checklist: { gap: spacing.xs },
  checklistRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  checklistLabel: { ...typography.caption },
  checklistLabelMet: { color: colors.success },
});
