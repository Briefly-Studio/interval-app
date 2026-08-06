import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../../src/auth/AuthService";
import { useTranslation } from "../../../src/i18n";
import { type CardRecord, type Difficulty, upgradeCard } from "../../../src/models/card";
import { addCard } from "../../../src/storage/cards";
import { Button } from "../../../src/ui/Button";
import { Card } from "../../../src/ui/Card";
import { DifficultySelector } from "../../../src/ui/DifficultySelector";
import { IconButton } from "../../../src/ui/IconButton";
import { Screen } from "../../../src/ui/Screen";
import { TextField } from "../../../src/ui/TextField";
import { useTheme } from "@/src/theme";

export default function AddCardScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, spacing, typography } = useTheme();

  const params = useLocalSearchParams();
  const idParam = params.id;

  const deckId =
    typeof idParam === "string"
      ? idParam
      : Array.isArray(idParam)
      ? idParam[0]
      : "";

  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [frontTouched, setFrontTouched] = useState(false);
  const [backTouched, setBackTouched] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [submitting, setSubmitting] = useState(false);

  const canSave = front.trim().length > 0 && back.trim().length > 0;

  const onSave = async () => {
    if (!deckId || !canSave || submitting) return;
    setSubmitting(true);
    try {
      const now = Date.now();
      const updatedAt = new Date(now).toISOString();

      const card: CardRecord = {
        ...upgradeCard({
          id: String(now),
          deckId,
          front: front.trim(),
          back: back.trim(),
          createdAt: now,
          difficulty,
        }),
        rev: 1,
        updatedAt,
        dirty: true,
      };

      const scope = await AuthService.getActiveScope();
      await addCard(scope, deckId, card);
      router.back();
    } catch (error) {
      // Keep the entered front/back and stay on this screen — the user shouldn't have to retype
      // anything after a failed save. Only a concise diagnostic tag is logged; the raw error
      // (and never the card content itself) is never shown to the user.
      console.error("[add-card] failed:", error);
      Alert.alert(t("addCard.createFailedTitle"), t("addCard.createFailedBody"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll>
      <View style={[styles.header, { gap: spacing.sm }]}>
        <IconButton
          name="chevron-back"
          accessibilityLabel={t("common.cancel")}
          onPress={() => router.back()}
          disabled={submitting}
        />
        <Text style={[typography.title, { color: colors.textPrimary }]} accessibilityRole="header">{t("addCard.screenTitle")}</Text>
      </View>

      <Card style={[styles.formCard, { gap: spacing.md }]}>
        <TextField
          label={t("addCard.frontLabel")}
          value={front}
          onChangeText={setFront}
          onBlur={() => setFrontTouched(true)}
          error={frontTouched && !front.trim() ? t("addCard.frontRequiredError") : undefined}
          placeholder={t("addCard.frontPlaceholder")}
          multiline
          editable={!submitting}
        />
        <TextField
          label={t("addCard.backLabel")}
          value={back}
          onChangeText={setBack}
          onBlur={() => setBackTouched(true)}
          error={backTouched && !back.trim() ? t("addCard.backRequiredError") : undefined}
          placeholder={t("addCard.backPlaceholder")}
          multiline
          editable={!submitting}
        />
      </Card>

      <View style={[styles.difficultySection, { gap: spacing.xs }]}>
        <Text style={[typography.label, { color: colors.textPrimary }]}>{t("addCard.difficultyLabel")}</Text>
        <DifficultySelector value={difficulty} onChange={setDifficulty} />
      </View>

      <Button
        label={t("addCard.saveButton")}
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
  header: { flexDirection: "row", alignItems: "center" },
  formCard: {},
  difficultySection: {},
});
