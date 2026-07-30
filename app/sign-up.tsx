import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AuthService } from "../src/auth/AuthService";
import { getAuthDiagnosticCode, mapAuthError } from "../src/auth/authErrors";
import { isValidName, trimName } from "../src/auth/nameValidation";
import { getPasswordRequirements, isPasswordValid } from "../src/auth/passwordPolicy";
import { useTranslation } from "../src/i18n";
import type { TranslateFn } from "../src/i18n/translateFn";
import { Button } from "../src/ui/Button";
import { Card } from "../src/ui/Card";
import { Screen } from "../src/ui/Screen";
import { TextField } from "../src/ui/TextField";
import { colors, spacing, typography } from "../src/ui/theme";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function nameFieldError(t: TranslateFn, value: string, touched: boolean, field: "first" | "last"): string | undefined {
  if (!touched) return undefined;
  if (trimName(value).length === 0) return t(field === "first" ? "profile.enterFirstName" : "profile.enterLastName");
  if (!isValidName(value)) return t("profile.nameFormatError");
  return undefined;
}

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
  const { t } = useTranslation();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [firstNameTouched, setFirstNameTouched] = useState(false);
  const [lastNameTouched, setLastNameTouched] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const firstNameValid = useMemo(() => isValidName(firstName), [firstName]);
  const lastNameValid = useMemo(() => isValidName(lastName), [lastName]);
  const emailValid = useMemo(() => EMAIL_PATTERN.test(email.trim()), [email]);
  const passwordValid = useMemo(() => isPasswordValid(password), [password]);
  const canSubmit = firstNameValid && lastNameValid && emailValid && passwordValid;

  async function onSignUp() {
    if (!canSubmit || loading) return;
    setErrorText(null);
    setLoading(true);
    try {
      await AuthService.signUp(email.trim(), password, trimName(firstName), trimName(lastName));
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
      <Text style={typography.title}>{t("auth.signUp.title")}</Text>
      <Text style={typography.secondary}>{t("auth.signUp.subtitle")}</Text>

      <Card style={{ gap: spacing.md }}>
        <View style={styles.nameRow}>
          <View style={styles.nameField}>
            <TextField
              label={t("profile.firstName")}
              value={firstName}
              onChangeText={setFirstName}
              onBlur={() => setFirstNameTouched(true)}
              error={nameFieldError(t, firstName, firstNameTouched, "first")}
              placeholder={t("auth.signUp.firstNamePlaceholder")}
              autoCapitalize="words"
              autoComplete="given-name"
              maxLength={50}
              editable={!loading}
            />
          </View>
          <View style={styles.nameField}>
            <TextField
              label={t("profile.lastName")}
              value={lastName}
              onChangeText={setLastName}
              onBlur={() => setLastNameTouched(true)}
              error={nameFieldError(t, lastName, lastNameTouched, "last")}
              placeholder={t("auth.signUp.lastNamePlaceholder")}
              autoCapitalize="words"
              autoComplete="family-name"
              maxLength={50}
              editable={!loading}
            />
          </View>
        </View>
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
          onChangeText={(text) => {
            setPassword(text);
            if (!passwordTouched) setPasswordTouched(true);
          }}
          placeholder={t("auth.signUp.passwordPlaceholder")}
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
          label={t("auth.signUp.signInInsteadButton")}
          variant="ghost"
          onPress={() => router.replace("/sign-in")}
          disabled={loading}
          style={{ flex: 1 }}
        />
        <Button
          label={t("auth.signUp.submitButton")}
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
  nameRow: { flexDirection: "row", gap: spacing.sm },
  nameField: { flex: 1 },
  checklist: { gap: spacing.xs },
  checklistRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  checklistLabel: { ...typography.caption },
  checklistLabelMet: { color: colors.success },
});
