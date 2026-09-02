import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  MAX_BACK_LENGTH,
  MAX_FRONT_LENGTH,
  validateDraftCardBack,
  validateDraftCardFront,
} from "../../../../src/domain/ai/draftCardEditing";
import { updateDraftCard, useGenerateDeckSession } from "../../../../src/domain/ai/generateDeckSession";
import { useTranslation } from "../../../../src/i18n";
import { useLayoutDirection } from "../../../../src/i18n/direction";
import { useTheme } from "@/src/theme";
import { Button } from "../../../../src/ui/Button";
import { Card } from "../../../../src/ui/Card";
import { IconButton } from "../../../../src/ui/IconButton";
import { Screen } from "../../../../src/ui/Screen";
import { TextField } from "../../../../src/ui/TextField";

export default function GenerateDeckEditCardScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, spacing, typography } = useTheme();
  const { row, text } = useLayoutDirection();

  const params = useLocalSearchParams();
  const cardIdParam = params.cardId;
  const cardId = typeof cardIdParam === "string" ? cardIdParam : Array.isArray(cardIdParam) ? cardIdParam[0] : "";
  const idParam = params.id;
  const routeSourceId = typeof idParam === "string" ? idParam : Array.isArray(idParam) ? idParam[0] : "";

  const session = useGenerateDeckSession();
  // Only operate on a card that belongs to the draft for THIS route's source (audit HIGH-2).
  const routeMatchesSession = !!session && session.sourceId === routeSourceId;
  const card = routeMatchesSession ? (session!.cards.find((c) => c.id === cardId) ?? null) : null;

  const [front, setFront] = useState(card?.front ?? "");
  const [back, setBack] = useState(card?.back ?? "");
  const [frontTouched, setFrontTouched] = useState(false);
  const [backTouched, setBackTouched] = useState(false);

  const frontError = useMemo(() => validateDraftCardFront(front), [front]);
  const backError = useMemo(() => validateDraftCardBack(back), [back]);
  const canSave = frontError === null && backError === null;

  const errorText = (kind: "empty" | "too-long" | null, max: number): string | undefined => {
    if (kind === "empty") return t("generateDeck.editCard.requiredError");
    if (kind === "too-long") return t("generateDeck.editCard.tooLongError", { max });
    return undefined;
  };

  const onSave = () => {
    if (!card || !canSave) return;
    updateDraftCard(card.id, { front: front.trim(), back: back.trim() });
    router.back();
  };

  if (!session || !card) {
    return (
      <Screen>
        <View style={[styles.header, row, { gap: spacing.sm }]}>
          <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} />
          <Text style={[typography.title, text, { color: colors.textPrimary }]} accessibilityRole="header">
            {t("generateDeck.editCard.screenTitle")}
          </Text>
        </View>
        <Text style={[typography.secondary, text, { color: colors.textSecondary }]}>{t("generateDeck.editCard.notFound")}</Text>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={[styles.header, row, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.cancel")} onPress={() => router.back()} />
        <Text style={[typography.title, text, { color: colors.textPrimary }]} accessibilityRole="header">
          {t("generateDeck.editCard.screenTitle")}
        </Text>
      </View>

      <Card style={{ gap: spacing.md }}>
        <TextField
          label={t("generateDeck.editCard.frontLabel")}
          value={front}
          onChangeText={setFront}
          onBlur={() => setFrontTouched(true)}
          error={frontTouched ? errorText(frontError, MAX_FRONT_LENGTH) : undefined}
          multiline
        />
        <TextField
          label={t("generateDeck.editCard.backLabel")}
          value={back}
          onChangeText={setBack}
          onBlur={() => setBackTouched(true)}
          error={backTouched ? errorText(backError, MAX_BACK_LENGTH) : undefined}
          multiline
        />
      </Card>

      <Button label={t("generateDeck.editCard.saveButton")} variant="primary" fullWidth disabled={!canSave} onPress={onSave} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center" },
});
