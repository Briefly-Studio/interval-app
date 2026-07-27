import * as FileSystem from "expo-file-system/legacy";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../../src/auth/AuthService";
import { buildExportPayload } from "../../../src/domain/deckTransfer";
import type { Deck } from "../../../src/models/deck";
import { getCards } from "../../../src/storage/cards";
import { getDeckById } from "../../../src/storage/decks";
import { Button } from "../../../src/ui/Button";
import { Card } from "../../../src/ui/Card";
import { IconButton } from "../../../src/ui/IconButton";
import { Screen } from "../../../src/ui/Screen";
import { colors, spacing, typography } from "../../../src/ui/theme";

export default function ExportDeckScreen() {
  const router = useRouter();
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
        setError("Deck not found.");
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
        setError("File export isn't available in this runtime.");
        return;
      }
      const fileUri = `${baseDir}${fileName}`;
      await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(payload, null, 2), {
        encoding: FileSystem.EncodingType.UTF8,
      });

      await Sharing.shareAsync(fileUri, {
        mimeType: "application/json",
        UTI: "public.json",
        dialogTitle: "Share deck",
      });

      Alert.alert("Shared", "Deck file is ready to share.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Share failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={styles.header}>
        <IconButton name="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} disabled={busy} />
        <Text style={typography.title}>Export deck</Text>
      </View>
      <Text style={typography.secondary}>
        Creates a .briefly file with this deck&apos;s cards, ready to share or import on another device.
      </Text>

      <Card style={styles.identityCard}>
        <Text style={typography.bodyMedium} numberOfLines={2}>
          {deck?.title ?? "This deck"}
        </Text>
        <Text style={typography.caption}>Exports as a .briefly file</Text>
      </Card>

      {error ? (
        <Card style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </Card>
      ) : null}

      <Button
        label={busy ? "Preparing…" : "Share deck"}
        variant="primary"
        fullWidth
        loading={busy}
        onPress={onShare}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  identityCard: { gap: spacing.xs },
  errorCard: { borderColor: colors.danger },
  errorText: { ...typography.secondary, color: colors.danger },
});
