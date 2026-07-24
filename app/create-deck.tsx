import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AuthService } from "../src/auth/AuthService";
import { makeId, type DeckRecord, upgradeDeck } from "../src/models/deck";
import { addDeck } from "../src/storage/decks";
import { Button } from "../src/ui/Button";
import { Card } from "../src/ui/Card";
import { IconButton } from "../src/ui/IconButton";
import { Screen } from "../src/ui/Screen";
import { TextField } from "../src/ui/TextField";
import { spacing, typography } from "../src/ui/theme";

export default function CreateDeck() {
  const router = useRouter();
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
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <View style={styles.header}>
        <IconButton
          name="chevron-back"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          disabled={submitting}
        />
        <Text style={typography.title}>Create deck</Text>
      </View>
      <Text style={typography.secondary}>Give your deck a clear name.</Text>

      <Card>
        <TextField
          label="Deck name"
          value={title}
          onChangeText={setTitle}
          onBlur={() => setTouched(true)}
          error={touched && !isValid ? "Enter a name for your deck." : undefined}
          placeholder="e.g. AWS SysOps"
          autoFocus
          editable={!submitting}
        />
      </Card>

      <Button
        label="Create deck"
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
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
});
