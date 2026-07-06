import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthService } from "../src/auth/AuthService";
import { onAuthChanged } from "../src/auth/authSignal";
import { SyncService } from "../src/cloud/sync/SyncService";
import { onSyncComplete } from "../src/cloud/sync/syncSignal";
import type { DeckRecord } from "../src/models/deck";
import { deleteCardsForDeck } from "../src/storage/cards";
import { deleteDeckById, getDecksAll, setDecks } from "../src/storage/decks";

const APP_BG = "#2FA4A3"; // teal background like original

export default function DecksHome() {
  const router = useRouter();
  const [decks, setDecksState] = useState<DeckRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  const loadDecks = useCallback(async () => {
    const allDecks = await getDecksAll();
    const data = allDecks.filter((deck) => !deck.deletedAt);
    setDecksState(data);
    setLoaded(true);
  }, []);

  const refreshAuthState = useCallback(async () => {
    const token = await AuthService.getAccessToken();
    setSignedIn(!!token);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        await loadDecks();
        await refreshAuthState();
        if (!alive) return;
      })();
      return () => {
        alive = false;
      };
    }, [loadDecks, refreshAuthState])
  );

  useEffect(() => {
    const unsub = onSyncComplete(() => {
      loadDecks();
    });
    return unsub;
  }, [loadDecks]);

  useEffect(() => onAuthChanged(setSignedIn), []);

  const onSignOut = async () => {
    await AuthService.signOut();
    await refreshAuthState();
  };

  const authButton = (
    <Pressable
      onPress={signedIn ? onSignOut : () => router.push("/sign-in")}
      style={styles.newDeckBtn}
    >
      <Text style={styles.newDeckBtnText}>{signedIn ? "Sign out" : "Sign in"}</Text>
    </Pressable>
  );

  const confirmDelete = (deck: DeckRecord) => {
    if (mutating) return;
    Alert.alert("Delete deck?", `“${deck.title}” will be removed from this device.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          if (mutating) return;
          setMutating(true);
          try {
            // Delete deck record
            await deleteDeckById(deck.id);

            // Delete cards stored for that deck (cascade delete)
            await deleteCardsForDeck(deck.id);

            await loadDecks();
          } finally {
            setMutating(false);
          }
        },
      },
    ]);
  };

  const renameDeck = (deck: DeckRecord) => {
    if (mutating) return;
    if (Platform.OS === "ios" && typeof Alert.prompt === "function") {
      Alert.prompt(
        "Rename deck",
        undefined,
        async (text) => {
          const title = text.trim();
          if (!title) return;
          setMutating(true);
          try {
            const allDecks = await getDecksAll();
            const now = new Date().toISOString();
            const updated = allDecks.map((item) => {
              if (item.id !== deck.id) return item;
              return {
                ...item,
                title,
                updatedAt: now,
                rev: (item.rev ?? 0) + 1,
                dirty: true,
              };
            });
            await setDecks(updated);
            await SyncService.syncOnce();
            await loadDecks();
          } finally {
            setMutating(false);
          }
        },
        "plain-text",
        deck.title
      );
      return;
    }

    Alert.alert("Rename not available", "Rename is currently supported on iOS only.");
  };

  const isEmpty = loaded && decks.length === 0;

  if (isEmpty) {
    return (
      <SafeAreaView style={styles.emptyScreen}>
        <Text style={styles.emptyTitle}>Interval</Text>
        <Text style={styles.emptySubtitle}>You do not have any decks yet.</Text>

        {authButton}

        <Pressable
          onPress={() => router.push({ pathname: "/recently-deleted" as any })}
          style={styles.newDeckBtn}
        >
          <Text style={styles.newDeckBtnText}>Recently Deleted</Text>
        </Pressable>

        <Pressable
          onPress={() => router.push("/create-deck")}
          style={styles.emptyPrimaryBtn}
        >
          <Text style={styles.emptyPrimaryBtnText}>+ Create your first deck</Text>
        </Pressable>

        <Pressable
          onPress={() => router.push("/import")}
          style={styles.newDeckBtn}
        >
          <Text style={styles.newDeckBtnText}>Import deck</Text>
        </Pressable>

      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.listScreen}>
      <View style={styles.listHeader}>
        <Pressable
          onLongPress={() => router.push({ pathname: "/dev-tools" as any })}
          delayLongPress={600}
          style={styles.titlePressable}
        >
          <Text style={styles.listTitle}>Interval</Text>
        </Pressable>

        <View style={styles.headerButtons}>
          {authButton}
          {__DEV__ && (
            <Pressable
              onPress={() => router.push({ pathname: "/dev-tools" as any })}
              style={styles.gearBtn}
            >
              <Text style={styles.gearBtnText}>⚙︎</Text>
            </Pressable>
          )}
          <Pressable onPress={() => router.push("/import")} style={styles.newDeckBtn}>
            <Text style={styles.newDeckBtnText}>Import deck</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push({ pathname: "/recently-deleted" as any })}
            style={styles.newDeckBtn}
          >
            <Text style={styles.newDeckBtnText}>Recently Deleted</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/create-deck")}
            style={styles.newDeckBtn}
          >
            <Text style={styles.newDeckBtnText}>+ Deck</Text>
          </Pressable>
        </View>
      </View>

      <FlatList
        data={decks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/deck/${item.id}`)}
            onLongPress={() =>
              Alert.alert("Deck actions", undefined, [
                { text: "Rename", onPress: () => renameDeck(item) },
                { text: "Delete", style: "destructive", onPress: () => confirmDelete(item) },
                { text: "Cancel", style: "cancel" },
              ])
            }
            delayLongPress={350}
            style={styles.card}
          >
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardMeta}>
              Created {new Date(item.createdAt).toLocaleDateString()}
            </Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  emptyScreen: {
    flex: 1,
    backgroundColor: APP_BG,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 12,
  },
  emptyTitle: { fontSize: 34, fontWeight: "800", color: "black" },
  emptySubtitle: {
    fontSize: 16,
    opacity: 0.85,
    textAlign: "center",
    color: "white",
  },
  emptyPrimaryBtn: {
    marginTop: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: "#2247a3ff",
  },
  emptyPrimaryBtnText: { color: "white", fontWeight: "700", fontSize: 16 },

  listScreen: {
    flex: 1,
    backgroundColor: APP_BG,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  listHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 12,
  },
  listTitle: { fontSize: 30, fontWeight: "800", color: "black" },
  headerButtons: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "flex-end",
    alignSelf: "flex-end",
    maxWidth: "70%",
  },
  titlePressable: { alignSelf: "flex-start" },
  gearBtn: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  gearBtnText: { fontSize: 16, fontWeight: "700", color: "white" },

  newDeckBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  newDeckBtnText: { fontSize: 16, fontWeight: "700", color: "white" },

  list: { paddingBottom: 24, gap: 12 },

  card: {
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  cardTitle: { fontSize: 20, fontWeight: "800", color: "white" },
  cardMeta: { marginTop: 6, opacity: 0.85, color: "white" },
});
