import * as FileSystem from "expo-file-system/legacy";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthService } from "../../../src/auth/AuthService";
import { buildExportPayload } from "../../../src/domain/deckTransfer";
import { getCards } from "../../../src/storage/cards";
import { getDeckById } from "../../../src/storage/decks";

const APP_BG = "#2FA4A3";

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

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <SafeAreaView style={styles.screen}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} style={styles.pill}>
          <Text style={styles.pillText}>← Back</Text>
        </Pressable>
      </View>

      <Text style={styles.title}>Export Deck</Text>
      <Text style={styles.subtitle}>Share a .briefly file for this deck.</Text>

      {error && (
        <View style={styles.card}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <View style={styles.actions}>
        <Pressable
          onPress={onShare}
          disabled={busy}
          style={[styles.secondaryBtn, busy && { opacity: 0.5 }]}
        >
          <Text style={styles.secondaryText}>
            {busy ? "Preparing..." : "Share deck"}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: APP_BG,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  pill: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  pillText: { color: "white", fontWeight: "700" },
  title: { fontSize: 30, fontWeight: "900", color: "white", marginTop: 4 },
  subtitle: { color: "white", opacity: 0.85 },
  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  errorText: { color: "white", opacity: 0.9, fontWeight: "800" },
  actions: { flexDirection: "row", gap: 10 },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
  },
  secondaryText: { color: "white", fontWeight: "900", fontSize: 16 },
});
