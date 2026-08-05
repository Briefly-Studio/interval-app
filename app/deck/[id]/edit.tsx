import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../../src/auth/AuthService";
import { SyncService } from "../../../src/cloud/sync/SyncService";
import { useTranslation } from "../../../src/i18n";
import type { DeckRecord } from "../../../src/models/deck";
import { getDeckById, renameDeck } from "../../../src/storage/decks";
import { useTheme } from "@/src/theme";
import { Button } from "../../../src/ui/Button";
import { Card } from "../../../src/ui/Card";
import { IconButton } from "../../../src/ui/IconButton";
import { Screen } from "../../../src/ui/Screen";
import { TextField } from "../../../src/ui/TextField";

// Cross-platform replacement for the old Alert.prompt-based rename flow (iOS-only; Android/web
// got a "not available" fallback). A real route works identically on every platform React Native
// renders to, closing that inconsistency without any platform branching in this file at all.
export default function EditDeckScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, spacing, typography } = useTheme();

  const params = useLocalSearchParams();
  const idParam = params.id;
  const id =
    typeof idParam === "string" ? idParam : Array.isArray(idParam) ? idParam[0] : "";

  const [loaded, setLoaded] = useState(false);
  const [deck, setDeck] = useState<DeckRecord | null>(null);
  const [title, setTitle] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;

    (async () => {
      if (!id) return;
      const scope = await AuthService.getActiveScope();
      const found = await getDeckById(scope, id);

      if (!alive) return;

      setDeck(found);
      setTitle(found?.title ?? "");
      setLoaded(true);
    })();

    return () => {
      alive = false;
    };
  }, [id]);

  const trimmedTitle = useMemo(() => title.trim(), [title]);
  const isValid = trimmedTitle.length > 0;

  const onSave = async () => {
    if (!deck || !id || !isValid || submitting) return;
    setSubmitting(true);
    try {
      const scope = await AuthService.getActiveScope();
      await renameDeck(scope, id, trimmedTitle);
      // The local rename above has already fully succeeded — a background sync failure (e.g.
      // offline) must never flip this save's outcome to "failed". Fire-and-forget, matching the
      // same reasoning already used by recently-deleted.tsx's restoreDeck.
      SyncService.syncOnce().catch(() => {});
      router.back();
    } catch (error) {
      // Keep the edited title and stay on this screen — the user shouldn't have to retype
      // anything after a failed save. Only a concise diagnostic tag is logged; the raw error
      // (and never the title itself) is never shown to the user.
      console.error("[edit-deck] save failed:", error);
      Alert.alert(t("editDeck.saveFailedTitle"), t("editDeck.saveFailedBody"));
    } finally {
      setSubmitting(false);
    }
  };

  if (!loaded) {
    return (
      <Screen>
        <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("editDeck.loading")}</Text>
      </Screen>
    );
  }

  if (!deck) {
    return (
      <Screen>
        <View style={[styles.header, { gap: spacing.sm }]}>
          <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} />
        </View>
        <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("editDeck.deckNotFound")}</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={[styles.header, { gap: spacing.sm }]}>
        <IconButton
          name="chevron-back"
          accessibilityLabel={t("common.cancel")}
          onPress={() => router.back()}
          disabled={submitting}
        />
        <Text style={[typography.title, { color: colors.textPrimary }]}>{t("editDeck.screenTitle")}</Text>
      </View>

      <Card>
        <TextField
          label={t("editDeck.nameLabel")}
          value={title}
          onChangeText={setTitle}
          onBlur={() => setTouched(true)}
          error={touched && !isValid ? t("editDeck.nameRequiredError") : undefined}
          placeholder={t("editDeck.namePlaceholder")}
          autoFocus
          editable={!submitting}
        />
      </Card>

      <Button
        label={t("editDeck.saveButton")}
        variant="primary"
        fullWidth
        loading={submitting}
        disabled={!isValid}
        onPress={onSave}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
});
