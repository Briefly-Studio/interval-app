import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AuthService } from "../src/auth/AuthService";
import { getAuthDiagnosticCode, mapAuthError } from "../src/auth/authErrors";
import { isValidName, isValidOptionalName, trimName } from "../src/auth/nameValidation";
import { Button } from "../src/ui/Button";
import { Card } from "../src/ui/Card";
import { IconButton } from "../src/ui/IconButton";
import { Screen } from "../src/ui/Screen";
import { TextField } from "../src/ui/TextField";
import { colors, spacing, typography } from "../src/ui/theme";

function nameFieldError(value: string, touched: boolean, fieldLabel: string): string | undefined {
  if (!touched) return undefined;
  if (trimName(value).length === 0) return `Enter your ${fieldLabel}.`;
  if (!isValidName(value)) return "Letters, spaces, apostrophes, and hyphens only (max 50 characters).";
  return undefined;
}

function nicknameFieldError(value: string, touched: boolean): string | undefined {
  if (!touched) return undefined;
  if (trimName(value).length === 0) return undefined; // optional — empty is valid
  if (!isValidName(value)) return "Letters, spaces, apostrophes, and hyphens only (max 50 characters).";
  return undefined;
}

export default function EditProfileScreen() {
  const router = useRouter();

  const [loaded, setLoaded] = useState(false);
  const [originalFirstName, setOriginalFirstName] = useState("");
  const [originalLastName, setOriginalLastName] = useState("");
  const [originalNickname, setOriginalNickname] = useState("");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nickname, setNickname] = useState("");
  const [firstNameTouched, setFirstNameTouched] = useState(false);
  const [lastNameTouched, setLastNameTouched] = useState(false);
  const [nicknameTouched, setNicknameTouched] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const identity = await AuthService.getActiveIdentity();
      if (!alive) return;
      const first = identity?.givenName ?? "";
      const last = identity?.familyName ?? "";
      const nick = identity?.nickname ?? "";
      setOriginalFirstName(first);
      setOriginalLastName(last);
      setOriginalNickname(nick);
      setFirstName(first);
      setLastName(last);
      setNickname(nick);
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const firstNameValid = isValidName(firstName);
  const lastNameValid = isValidName(lastName);
  const nicknameValid = isValidOptionalName(nickname);

  const trimmedFirst = trimName(firstName);
  const trimmedLast = trimName(lastName);
  const trimmedNickname = trimName(nickname);
  const hasChanges =
    trimmedFirst !== originalFirstName ||
    trimmedLast !== originalLastName ||
    trimmedNickname !== originalNickname;

  const canSave =
    loaded && firstNameValid && lastNameValid && nicknameValid && hasChanges && !submitting;

  const onSave = async () => {
    if (!canSave) return;
    setErrorText(null);
    setSubmitting(true);
    try {
      await AuthService.updateProfile({
        givenName: trimmedFirst !== originalFirstName ? trimmedFirst : undefined,
        familyName: trimmedLast !== originalLastName ? trimmedLast : undefined,
        // trimmedNickname may legitimately be "" here (the user cleared it) — that must still
        // be sent (not skipped) so Cognito actually clears the stored value. See
        // AuthService.updateProfile for why an explicit empty string is the right approach.
        nickname: trimmedNickname !== originalNickname ? trimmedNickname : undefined,
      });
      router.back();
    } catch (error) {
      console.log("[profile] update failed:", getAuthDiagnosticCode(error));
      setErrorText(mapAuthError(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll>
      <View style={styles.header}>
        <IconButton
          name="chevron-back"
          accessibilityLabel="Cancel"
          onPress={() => router.back()}
          disabled={submitting}
        />
        <Text style={typography.title}>Edit profile</Text>
      </View>

      <Card style={styles.formCard}>
        <TextField
          label="First name"
          value={firstName}
          onChangeText={setFirstName}
          onBlur={() => setFirstNameTouched(true)}
          error={nameFieldError(firstName, firstNameTouched, "first name")}
          placeholder="Ada"
          autoCapitalize="words"
          autoComplete="given-name"
          maxLength={50}
          editable={!submitting}
        />
        <TextField
          label="Last name"
          value={lastName}
          onChangeText={setLastName}
          onBlur={() => setLastNameTouched(true)}
          error={nameFieldError(lastName, lastNameTouched, "last name")}
          placeholder="Lovelace"
          autoCapitalize="words"
          autoComplete="family-name"
          maxLength={50}
          editable={!submitting}
        />
        {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
      </Card>

      <Card style={styles.formCard}>
        <TextField
          label="Nickname (optional)"
          value={nickname}
          onChangeText={setNickname}
          onBlur={() => setNicknameTouched(true)}
          error={nicknameFieldError(nickname, nicknameTouched)}
          placeholder="What should we call you?"
          autoCapitalize="words"
          maxLength={50}
          editable={!submitting}
          accessibilityHint="Interval will use this name in greetings, instead of your first name."
        />
        <Text style={typography.caption}>Interval will use this name in greetings.</Text>
      </Card>

      <Button
        label="Save"
        variant="primary"
        fullWidth
        loading={submitting}
        disabled={!canSave}
        onPress={onSave}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  formCard: { gap: spacing.md },
  errorText: { ...typography.caption, color: colors.danger },
});
