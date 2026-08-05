import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../src/auth/AuthService";
import { useTranslation } from "../src/i18n";
import { makeId, type DeckRecord, upgradeDeck } from "../src/models/deck";
import { addDeck } from "../src/storage/decks";
import { Button } from "../src/ui/Button";
import { Card } from "../src/ui/Card";
import { IconButton } from "../src/ui/IconButton";
import { Screen } from "../src/ui/Screen";
import { TextField } from "../src/ui/TextField";
import { useTheme } from "@/src/theme";

export default function CreateDeck() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, spacing, typography } = useTheme();
  const [title, setTitle] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const trimmedTitle = useMemo(() => title.trim(), [title]);
  const isValid = trimmedTitle.length > 0;

  async function onCreate() {
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const deck: DeckRecord = {
        ...upgradeDeck({
          id: makeId(),
          title: trimmedTitle,
          createdAt: now,
        }),
        rev: 1,
        updatedAt: now,
        dirty: true,
      };

      const scope = await AuthService.getActiveScope();
      await addDeck(scope, deck);
      router.back();
    } catch (error) {
      // Keep the entered title and stay on this screen — the user shouldn't have to retype
      // anything after a failed save. Only a concise diagnostic tag is logged; the raw error
      // (and never the title itself) is never shown to the user.
      console.error("[create-deck] failed:", error);
      Alert.alert(t("createDeck.createFailedTitle"), t("createDeck.createFailedBody"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <View style={[styles.header, { gap: spacing.sm }]}>
        <IconButton
          name="chevron-back"
          accessibilityLabel={t("common.back")}
          onPress={() => router.back()}
          disabled={submitting}
        />
        <Text style={[typography.title, { color: colors.textPrimary }]}>{t("createDeck.screenTitle")}</Text>
      </View>
      <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("createDeck.subtitle")}</Text>

      <Card>
        <TextField
          label={t("createDeck.nameLabel")}
          value={title}
          onChangeText={setTitle}
          onBlur={() => setTouched(true)}
          error={touched && !isValid ? t("createDeck.nameRequiredError") : undefined}
          placeholder={t("createDeck.namePlaceholder")}
          autoFocus
          editable={!submitting}
        />
      </Card>

      <Button
        label={t("createDeck.submitButton")}
        variant="primary"
        fullWidth
        loading={submitting}
        disabled={!isValid}
        onPress={onCreate}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
});
