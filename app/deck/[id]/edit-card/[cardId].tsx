import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../../../src/auth/AuthService";
import { useTranslation } from "../../../../src/i18n";
import { type CardRecord, type Difficulty, upgradeCard } from "../../../../src/models/card";
import { deleteCard, getCards, updateCard } from "../../../../src/storage/cards";
import { Button } from "../../../../src/ui/Button";
import { Card } from "../../../../src/ui/Card";
import { DifficultySelector } from "../../../../src/ui/DifficultySelector";
import { IconButton } from "../../../../src/ui/IconButton";
import { Screen } from "../../../../src/ui/Screen";
import { TextField } from "../../../../src/ui/TextField";
import { spacing, typography } from "../../../../src/ui/theme";

export default function EditCardScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const params = useLocalSearchParams();

  const deckIdParam = params.id;
  const cardIdParam = params.cardId;

  const deckId =
    typeof deckIdParam === "string"
      ? deckIdParam
      : Array.isArray(deckIdParam)
      ? deckIdParam[0]
      : "";

  const cardId =
    typeof cardIdParam === "string"
      ? cardIdParam
      : Array.isArray(cardIdParam)
      ? cardIdParam[0]
      : "";

  const [loaded, setLoaded] = useState(false);
  const [card, setCard] = useState<CardRecord | null>(null);

  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [frontTouched, setFrontTouched] = useState(false);
  const [backTouched, setBackTouched] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;

    (async () => {
      if (!deckId || !cardId) return;

      const scope = await AuthService.getActiveScope();
      const cards = await getCards(scope, deckId);
      const found = cards.find((c) => c.id === cardId) ?? null;

      if (!alive) return;

      setCard(found);
      setFront(found?.front ?? "");
      setBack(found?.back ?? "");
      setDifficulty(found?.difficulty ?? "medium");
      setLoaded(true);
    })();

    return () => {
      alive = false;
    };
  }, [deckId, cardId]);

  const canSave = useMemo(() => {
    if (!card) return false;
    return front.trim().length > 0 && back.trim().length > 0;
  }, [card, front, back]);

  const onSave = async () => {
    if (!card || !deckId || !canSave || submitting) return;
    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const updated: CardRecord = {
        ...upgradeCard({
          ...card,
          front: front.trim(),
          back: back.trim(),
          difficulty,
        }),
        rev: card.rev + 1,
        updatedAt: now,
        dirty: true,
      };

      const scope = await AuthService.getActiveScope();
      await updateCard(scope, deckId, updated);
      router.back();
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async () => {
    if (!card || !deckId) return;
    const scope = await AuthService.getActiveScope();
    await deleteCard(scope, deckId, card.id);
    router.back();
  };

  if (!loaded) {
    return (
      <Screen>
        <Text style={typography.secondary}>{t("editCard.loading")}</Text>
      </Screen>
    );
  }

  if (!card) {
    return (
      <Screen>
        <View style={styles.header}>
          <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} />
        </View>
        <Text style={typography.secondary}>{t("editCard.cardNotFound")}</Text>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={styles.header}>
        <IconButton
          name="chevron-back"
          accessibilityLabel={t("common.cancel")}
          onPress={() => router.back()}
          disabled={submitting}
        />
        <Text style={typography.title}>{t("editCard.screenTitle")}</Text>
      </View>

      <Card style={styles.formCard}>
        <TextField
          label={t("editCard.frontLabel")}
          value={front}
          onChangeText={setFront}
          onBlur={() => setFrontTouched(true)}
          error={frontTouched && !front.trim() ? t("editCard.frontRequiredError") : undefined}
          placeholder={t("editCard.frontPlaceholder")}
          multiline
          editable={!submitting}
        />
        <TextField
          label={t("editCard.backLabel")}
          value={back}
          onChangeText={setBack}
          onBlur={() => setBackTouched(true)}
          error={backTouched && !back.trim() ? t("editCard.backRequiredError") : undefined}
          placeholder={t("editCard.backPlaceholder")}
          multiline
          editable={!submitting}
        />
      </Card>

      <View style={styles.difficultySection}>
        <Text style={typography.label}>{t("editCard.difficultyLabel")}</Text>
        <DifficultySelector value={difficulty} onChange={setDifficulty} />
      </View>

      <Button
        label={t("editCard.saveButton")}
        variant="primary"
        fullWidth
        loading={submitting}
        disabled={!canSave}
        onPress={onSave}
      />

      <Button label={t("editCard.deleteButton")} variant="danger" fullWidth onPress={onDelete} disabled={submitting} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  formCard: { gap: spacing.md },
  difficultySection: { gap: spacing.xs },
});
