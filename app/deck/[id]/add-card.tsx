import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthService } from "../../../src/auth/AuthService";
import { type CardRecord, type Difficulty, upgradeCard } from "../../../src/models/card";
import { addCard } from "../../../src/storage/cards";

const APP_BG = "#2FA4A3";

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
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");

  const canSave = front.trim().length > 0 && back.trim().length > 0;

  const onSave = async () => {
    if (!deckId || !canSave) return;

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
  };

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

      <Text style={styles.title}>New Card</Text>

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
  primaryText: { color: "white", fontWeight: "800" },

  title: { fontSize: 30, fontWeight: "900", color: "white", marginTop: 4 },
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
});
