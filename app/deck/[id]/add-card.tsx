import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../../src/auth/AuthService";
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
          accessibilityLabel="Cancel"
          onPress={() => router.back()}
          disabled={submitting}
        />
        <Text style={typography.title}>New card</Text>
      </View>

      <Card style={styles.formCard}>
        <TextField
          label="Front"
          value={front}
          onChangeText={setFront}
          onBlur={() => setFrontTouched(true)}
          error={frontTouched && !front.trim() ? "Enter the front of the card." : undefined}
          placeholder="Question or term"
          multiline
          editable={!submitting}
        />
        <TextField
          label="Back"
          value={back}
          onChangeText={setBack}
          onBlur={() => setBackTouched(true)}
          error={backTouched && !back.trim() ? "Enter the back of the card." : undefined}
          placeholder="Answer or explanation"
          multiline
          editable={!submitting}
        />
      </Card>

      <View style={styles.difficultySection}>
        <Text style={typography.label}>Difficulty</Text>
        <DifficultySelector value={difficulty} onChange={setDifficulty} />
      </View>

      <Button
        label="Save card"
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
