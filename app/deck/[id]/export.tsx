import * as FileSystem from "expo-file-system/legacy";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../../src/auth/AuthService";
import { buildExportPayload } from "../../../src/domain/deckTransfer";
import { useTranslation } from "../../../src/i18n";
import type { Deck } from "../../../src/models/deck";
import { getCards } from "../../../src/storage/cards";
import { getDeckById } from "../../../src/storage/decks";
import { Button } from "../../../src/ui/Button";
import { Card } from "../../../src/ui/Card";
import { IconButton } from "../../../src/ui/IconButton";
import { Screen } from "../../../src/ui/Screen";
import { useTheme } from "@/src/theme";

export default function ExportDeckScreen() {
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

  // Display-only — the deck identity card below. Kept separate from onShare's own lookup so
  // the actual export path below is untouched, byte-for-byte, from before this redesign.
  const [deck, setDeck] = useState<Deck | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!deckId) return;
      const scope = await AuthService.getActiveScope();
      const d = await getDeckById(scope, deckId);
      if (alive) setDeck(d);
    })();
    return () => {
      alive = false;
    };
  }, [deckId]);

  const onShare = async () => {
    if (!deckId || busy) return;

    setBusy(true);
    setError(null);

    try {
      const scope = await AuthService.getActiveScope();
      const deck = await getDeckById(scope, deckId);
      if (!deck) {
        setError(t("export.deckNotFoundError"));
        return;
      }

      const cards = await getCards(scope, deckId);
      const payload = buildExportPayload(deck, cards);

      const safeTitle = deck.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-+|-+$)/g, "");
      const fileName = `briefly-deck-${safeTitle || "deck"}-${Date.now()}.briefly`;
      const baseDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      if (!baseDir) {
        setError(t("export.unavailableError"));
        return;
      }
      const fileUri = `${baseDir}${fileName}`;
      await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(payload, null, 2), {
        encoding: FileSystem.EncodingType.UTF8,
      });

      await Sharing.shareAsync(fileUri, {
        mimeType: "application/json",
        UTI: "public.json",
        dialogTitle: t("export.shareDialogTitle"),
      });

      Alert.alert(t("export.sharedTitle"), t("export.sharedBody"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("export.shareFailedError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={[styles.header, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} disabled={busy} />
        <Text style={[typography.title, { color: colors.textPrimary }]}>{t("export.screenTitle")}</Text>
      </View>
      <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("export.description")}</Text>

      <Card style={[styles.identityCard, { gap: spacing.xs }]}>
        <Text style={[typography.bodyMedium, { color: colors.textPrimary }]} numberOfLines={2}>
          {deck?.title ?? t("export.fallbackDeckTitle")}
        </Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>{t("export.exportsAsFile")}</Text>
      </Card>

      {error ? (
        <Card style={[styles.errorCard, { borderColor: colors.danger }]}>
          <Text style={[typography.secondary, { color: colors.danger }]}>{error}</Text>
        </Card>
      ) : null}

      <Button
        label={busy ? t("export.preparingButton") : t("export.shareButton")}
        variant="primary"
        fullWidth
        loading={busy}
        onPress={onShare}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  identityCard: {},
  errorCard: {},
});
