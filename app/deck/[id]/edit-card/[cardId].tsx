import { useLocalSearchParams, useRouter } from "expo-router"; //FIX this routing import
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native"; //FIX this routing import
import { SafeAreaView } from "react-native-safe-area-context"; //FIX this routing import

import { AuthService } from "../../../../src/auth/AuthService";
import { type CardRecord, type Difficulty, upgradeCard } from "../../../../src/models/card";
import { deleteCard, getCards, updateCard } from "../../../../src/storage/cards";

const APP_BG = "#2FA4A3";

export default function EditCardScreen() {
  const router = useRouter();
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
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");

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
    if (!card || !deckId || !canSave) return;

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
  };

  const onDelete = async () => {
    if (!card || !deckId) return;
    const scope = await AuthService.getActiveScope();
    await deleteCard(scope, deckId, card.id);
    router.back();
  };

  if (!loaded) {
    return (
      <SafeAreaView style={styles.screen}>
        <Text style={styles.subtle}>Loading…</Text>
      </SafeAreaView>
    );
  }

  if (!card) {
    return (
      <SafeAreaView style={styles.screen}>
        <Pressable onPress={() => router.back()} style={styles.pill}>
          <Text style={styles.pillText}>← Back</Text>
        </Pressable>
        <Text style={styles.subtle}>Card not found.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} style={styles.pill}>
          <Text style={styles.pillText}>Cancel</Text>
        </Pressable>

        <Pressable
          onPress={onSave}
          disabled={!canSave}
          style={[styles.primary, !canSave && { opacity: 0.5 }]}
        >
          <Text style={styles.primaryText}>Save</Text>
        </Pressable>
      </View>

      <Text style={styles.title}>Edit Card</Text>

      <Text style={styles.label}>Front</Text>
      <TextInput
        value={front}
        onChangeText={setFront}
        placeholder="Question / term"
        placeholderTextColor="rgba(255,255,255,0.65)"
        style={styles.input}
        multiline
      />

      <Text style={styles.label}>Back</Text>
      <TextInput
        value={back}
        onChangeText={setBack}
        placeholder="Answer / explanation"
        placeholderTextColor="rgba(255,255,255,0.65)"
        style={styles.input}
        multiline
      />

      <Text style={styles.label}>Difficulty</Text>
      <View style={styles.segmentRow}>
        {(["easy", "medium", "hard"] as Difficulty[]).map((level) => {
          const isActive = difficulty === level;
          return (
            <Pressable
              key={level}
              onPress={() => setDifficulty(level)}
              style={[styles.segment, isActive && styles.segmentActive]}
            >
              <Text style={[styles.segmentText, isActive && styles.segmentTextActive]}>
                {level[0].toUpperCase() + level.slice(1)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable onPress={onDelete} style={styles.danger}>
        <Text style={styles.dangerText}>Delete Card</Text>
      </Pressable>
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

  primary: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "#2247a3ff",
  },
  primaryText: { color: "white", fontWeight: "900" },

  title: { fontSize: 30, fontWeight: "900", color: "black", marginTop: 4 },
  subtle: { marginTop: 12, color: "white", opacity: 0.85 },

  label: { color: "white", fontWeight: "800", opacity: 0.9, marginTop: 6 },

  input: {
    minHeight: 90,
    borderRadius: 16,
    padding: 14,
    color: "white",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "rgba(255,255,255,0.16)",
  },

  segmentRow: {
    flexDirection: "row",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    overflow: "hidden",
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  segmentActive: {
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  segmentText: { color: "white", opacity: 0.85, fontWeight: "800" },
  segmentTextActive: { opacity: 1 },

  danger: {
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
  },
  dangerText: { color: "white", fontWeight: "900" },
});
