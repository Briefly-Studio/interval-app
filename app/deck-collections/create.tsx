import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../src/auth/AuthService";
import { useTranslation } from "../../src/i18n";
import { makeId } from "../../src/models/deck";
import type { DeckCollection } from "../../src/models/deckCollection";
import { addDeckCollection, getActiveDeckCollections, moveDeckToCollection } from "../../src/storage/deckCollections";
import { useTheme } from "@/src/theme";
import { Button } from "../../src/ui/Button";
import { Card } from "../../src/ui/Card";
import { IconButton } from "../../src/ui/IconButton";
import { Screen } from "../../src/ui/Screen";
import { TextField } from "../../src/ui/TextField";

const MAX_NAME_LENGTH = 60;

export default function CreateDeckCollectionScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, spacing, typography } = useTheme();
  const params = useLocalSearchParams();
  const assignDeckIdParam = params.assignDeckId;
  // Present only when reached from "Move to collection" -> "New collection" (see
  // app/deck/[id]/move-to-collection.tsx) — reuses this screen's normal creation logic rather
  // than duplicating it, then assigns that one deck into the newly-created collection.
  const assignDeckId =
    typeof assignDeckIdParam === "string" ? assignDeckIdParam : Array.isArray(assignDeckIdParam) ? assignDeckIdParam[0] : undefined;
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [duplicateError, setDuplicateError] = useState(false);

  const trimmedName = useMemo(() => name.trim(), [name]);
  const isValid = trimmedName.length > 0 && trimmedName.length <= MAX_NAME_LENGTH;

  const error = touched && !trimmedName
    ? t("deckCollections.form.nameRequiredError")
    : touched && trimmedName.length > MAX_NAME_LENGTH
      ? t("deckCollections.form.nameTooLongError")
      : duplicateError
        ? t("deckCollections.form.nameDuplicateError")
        : undefined;

  const onCreate = async () => {
    if (!isValid || submitting) return;
    setSubmitting(true);
    setDuplicateError(false);
    try {
      const scope = await AuthService.getActiveScope();
      const existing = await getActiveDeckCollections(scope);
      const isDuplicate = existing.some((c) => c.name.trim().toLowerCase() === trimmedName.toLowerCase());
      if (isDuplicate) {
        setDuplicateError(true);
        setSubmitting(false);
        return;
      }
      const collection: DeckCollection = {
        id: makeId(),
        name: trimmedName,
        createdAt: new Date().toISOString(),
        deckIds: [],
      };
      await addDeckCollection(scope, collection);

      if (assignDeckId) {
        await moveDeckToCollection(scope, assignDeckId, collection.id);
        // Skip back past the (now stale) move-to-collection picker and land directly on the
        // collection the deck was just moved into.
        router.replace({ pathname: "/deck-collections/[id]" as any, params: { id: collection.id } });
        return;
      }

      router.back();
    } catch {
      console.error("[deck-collection-create] failed to save collection");
      Alert.alert(t("deckCollections.form.saveFailedTitle"), t("deckCollections.form.saveFailedBody"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen>
      <View style={[styles.header, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.cancel")} onPress={() => router.back()} disabled={submitting} />
        <Text style={[typography.title, styles.headerTitle, { color: colors.textPrimary }]} numberOfLines={1} accessibilityRole="header">
          {t("deckCollections.form.createScreenTitle")}
        </Text>
      </View>
      <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("deckCollections.form.createSubtitle")}</Text>

      <Card>
        <TextField
          label={t("deckCollections.form.nameLabel")}
          value={name}
          onChangeText={(text) => {
            setName(text);
            setDuplicateError(false);
          }}
          onBlur={() => setTouched(true)}
          error={error}
          placeholder={t("deckCollections.form.namePlaceholder")}
          autoFocus
          editable={!submitting}
        />
      </Card>

      <Button label={t("deckCollections.form.saveButton")} variant="primary" fullWidth loading={submitting} disabled={!isValid} onPress={onCreate} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  headerTitle: { flex: 1 },
});
