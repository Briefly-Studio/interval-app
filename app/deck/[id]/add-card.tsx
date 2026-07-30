import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

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
import { spacing, typography } from "../../../src/ui/theme";

export default function AddCardScreen() {
  const router = useRouter();
  const { t } = useTranslation();

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
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll>
      <View style={styles.header}>
        <IconButton
          name="chevron-back"
          accessibilityLabel={t("common.cancel")}
          onPress={() => router.back()}
          disabled={submitting}
        />
        <Text style={typography.title}>{t("addCard.screenTitle")}</Text>
      </View>

      <Card style={styles.formCard}>
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

      <View style={styles.difficultySection}>
        <Text style={typography.label}>{t("addCard.difficultyLabel")}</Text>
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
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  formCard: { gap: spacing.md },
  difficultySection: { gap: spacing.xs },
});
