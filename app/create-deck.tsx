import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthService } from "../src/auth/AuthService";
import { makeId, type DeckRecord, upgradeDeck } from "../src/models/deck";
import { addDeck } from "../src/storage/decks";

const APP_BG = "#2FA4A3";

export default function CreateDeck() {
  const router = useRouter();
  const [title, setTitle] = useState("");

  async function onCreate() {
    const trimmed = title.trim();
    if (!trimmed) {
      Alert.alert("Deck title required", "Please enter a name for your deck.");
      return;
    }

    const now = new Date().toISOString();
    const deck: DeckRecord = {
      ...upgradeDeck({
        id: makeId(),
        title: trimmed,
        createdAt: now,
      }),
      rev: 1,
      updatedAt: now,
      dirty: true,
    };

    const scope = await AuthService.getActiveScope();
    await addDeck(scope, deck);
    router.back();
  }
  
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: APP_BG }}>
      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 12, gap: 16 }}>
        <Text style={{ fontSize: 24, fontWeight: "700", color: "white" }}>
          Create deck
        </Text>

        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Deck title"
          placeholderTextColor="rgba(255,255,255,0.7)"
          autoFocus
          style={{
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.35)",
            backgroundColor: "rgba(255,255,255,0.16)",
            padding: 14,
            borderRadius: 12,
            fontSize: 16,
            color: "white",
          }}
        />

        <View style={{ flexDirection: "row", gap: 12 }}>
          <Pressable
            onPress={() => router.back()}
            style={{
              paddingVertical: 12,
              paddingHorizontal: 14,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.35)",
              backgroundColor: "rgba(255,255,255,0.12)",
            }}
          >
            <Text style={{ color: "white", fontWeight: "600" }}>Cancel</Text>
          </Pressable>

          <Pressable
            onPress={onCreate}
            style={{
              paddingVertical: 12,
              paddingHorizontal: 14,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.35)",
              backgroundColor: "rgba(255,255,255,0.2)",
            }}
          >
            <Text style={{ color: "white", fontWeight: "700" }}>Create</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
