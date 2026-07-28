import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Platform, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../src/auth/AuthService";
import { onWorkspaceChanged } from "../src/auth/authSignal";
import type { UserIdentity } from "../src/auth/identity";
import { SyncService } from "../src/cloud/sync/SyncService";
import { onSyncComplete } from "../src/cloud/sync/syncSignal";
import { getHomeGreeting } from "../src/content/timeGreeting";
import type { DeckRecord } from "../src/models/deck";
import { deleteDeckById, getDecksAll, setDecks } from "../src/storage/decks";
import type { WorkspaceScope } from "../src/storage/workspaceScope";
import { AccountButton } from "../src/ui/AccountButton";
import { Button } from "../src/ui/Button";
import { DeckCard } from "../src/ui/DeckCard";
import { EmptyState } from "../src/ui/EmptyState";
import { HomeHeader } from "../src/ui/HomeHeader";
import { IconButton } from "../src/ui/IconButton";
import { Screen } from "../src/ui/Screen";
import { SecondaryAction } from "../src/ui/SecondaryAction";
import { colors, spacing, typography } from "../src/ui/theme";

// Falls back to a neutral bullet rather than ever rendering "undefined" — identity can briefly
// lag one tick behind scope while refreshWorkspace resolves them separately (see below).
// displayName already embeds the full preferred-name fallback chain (nickname > given_name >
// name > email prefix > "there" — see src/auth/identity.ts), so it's the single source of truth
// here rather than re-deriving a second, possibly-divergent priority order.
function accountInitial(identity: UserIdentity | null): string {
  const source = identity?.displayName;
  return source ? source[0].toUpperCase() : "•";
}

export default function DecksHome() {
  const router = useRouter();
  const [decks, setDecksState] = useState<DeckRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [scope, setScope] = useState<WorkspaceScope>({ kind: "guest" });
  const [identity, setIdentity] = useState<UserIdentity | null>(null);
  // Purely a UI affordance — flips true only once the existing onSyncComplete event (already
  // emitted by SyncService on a real, successful sync) fires this session. No new sync/network
  // logic, no polling, no fabricated "Syncing…" or "Needs attention" states, since nothing in
  // SyncService currently exposes an in-progress or failure signal to key those off of.
  const [hasSyncedThisSession, setHasSyncedThisSession] = useState(false);
  const signedIn = scope.kind === "user";

  // Small presentational identity area — derives only display text, never anything used for
  // storage/sync/authorization, which stays sub-scoped exactly as before.
  const greeting = useMemo(() => {
    // Prefers nickname over given_name (never falls further to email prefix/"there" here — the
    // greeting should stay silent-on-name rather than show an email prefix in a warm sentence).
    if (scope.kind === "user") return getHomeGreeting(identity?.nickname || identity?.givenName);
    return { headline: "Ready to learn?", supporting: "Your offline workspace" };
  }, [scope, identity]);

  // Guest's supporting line above already says "Your offline workspace" — a second "Offline
  // workspace" sync caption directly under it would just repeat the same fact, so the sync
  // caption is authenticated-only.
  const syncLabel = signedIn && hasSyncedThisSession ? "Synced" : null;

  const loadDecks = useCallback(async (activeScope: WorkspaceScope) => {
    const allDecks = await getDecksAll(activeScope);
    const data = allDecks.filter((deck) => !deck.deletedAt);
    setDecksState(data);
    setLoaded(true);
  }, []);

  // Resolves the active workspace once, then reloads the deck list for that exact scope —
  // this is what makes sign-in/sign-out/account-switch show the right workspace's decks.
  const refreshWorkspace = useCallback(async () => {
    const activeScope = await AuthService.getActiveScope();
    setScope(activeScope);
    setIdentity(activeScope.kind === "user" ? await AuthService.getActiveIdentity() : null);
    await loadDecks(activeScope);
  }, [loadDecks]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        if (!alive) return;
        await refreshWorkspace();
      })();
      return () => {
        alive = false;
      };
    }, [refreshWorkspace])
  );

  useEffect(() => {
    const unsub = onSyncComplete(() => {
      setHasSyncedThisSession(true);
      refreshWorkspace();
    });
    return unsub;
  }, [refreshWorkspace]);

  useEffect(
    () =>
      onWorkspaceChanged((newScope) => {
        setScope(newScope);
        if (newScope.kind === "user") {
          AuthService.getActiveIdentity().then(setIdentity);
        } else {
          setIdentity(null);
        }
        loadDecks(newScope);
      }),
    [loadDecks]
  );

  // Sign out now lives in Settings (see app/settings.tsx) — the account button here is purely
  // a navigation entry point: guests go to sign-in, signed-in users go to Settings. Settings'
  // own onWorkspaceChanged subscription (and this one, still mounted underneath) both react to
  // sign-out immediately, so Home is already correct by the time the user navigates back to it.
  const onAccountPress = () => {
    if (!signedIn) {
      router.push("/sign-in");
      return;
    }
    router.push({ pathname: "/settings" as any });
  };

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
            const activeScope = await AuthService.getActiveScope();

            // deleteDeckById already soft-delete-cascades this deck's cards (and sessions) —
            // tombstoning them so they can be restored later. Do not also hard-delete the cards
            // storage key here: that would erase the tombstones this call just wrote, leaving
            // Recently Deleted -> Restore with nothing to bring back.
            await deleteDeckById(activeScope, deck.id);

            await loadDecks(activeScope);
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
            const activeScope = await AuthService.getActiveScope();
            const allDecks = await getDecksAll(activeScope);
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
            await setDecks(activeScope, updated);
            await SyncService.syncOnce();
            await loadDecks(activeScope);
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

  const onDeckLongPress = (deck: DeckRecord) => {
    Alert.alert("Deck actions", undefined, [
      { text: "Rename", onPress: () => renameDeck(deck) },
      { text: "Delete", style: "destructive", onPress: () => confirmDelete(deck) },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const isEmpty = loaded && decks.length === 0;

  return (
    <Screen>
      <HomeHeader onTitleLongPress={() => router.push({ pathname: "/dev-tools" as any })}>
        {__DEV__ && (
          <IconButton
            name="construct-outline"
            accessibilityLabel="Dev tools"
            variant="surface"
            onPress={() => router.push({ pathname: "/dev-tools" as any })}
          />
        )}
        <AccountButton
          variant={signedIn ? "initial" : "signIn"}
          label={signedIn ? accountInitial(identity) : "Sign in"}
          accessibilityLabel={signedIn ? "Account menu" : "Sign in"}
          onPress={onAccountPress}
        />
      </HomeHeader>

      <View style={styles.greetingBlock}>
        <Text style={typography.heading}>{greeting.headline}</Text>
        {greeting.supporting ? <Text style={typography.secondary}>{greeting.supporting}</Text> : null}
        {syncLabel ? <Text style={styles.syncLabel}>{syncLabel}</Text> : null}
      </View>

      <View style={styles.secondaryRow}>
        <SecondaryAction icon="download-outline" label="Import deck" onPress={() => router.push("/import")} />
        <SecondaryAction
          icon="trash-outline"
          label="Recently Deleted"
          onPress={() => router.push({ pathname: "/recently-deleted" as any })}
        />
      </View>

      {isEmpty ? (
        <View style={styles.emptyFill}>
          <EmptyState
            icon={signedIn ? "albums-outline" : "cloud-offline-outline"}
            title={signedIn ? "No decks yet" : "Your offline workspace is ready"}
            description={
              signedIn
                ? "Create your first deck or import one to start studying."
                : "Create a deck now. You can sign in later to sync across devices."
            }
          >
            <Button label="Create a deck" variant="primary" fullWidth onPress={() => router.push("/create-deck")} />
            {signedIn ? (
              <Button label="Import deck" variant="secondary" fullWidth onPress={() => router.push("/import")} />
            ) : (
              <Button label="Sign in" variant="secondary" fullWidth onPress={() => router.push("/sign-in")} />
            )}
          </EmptyState>
        </View>
      ) : (
        <View style={styles.deckSection}>
          <View style={styles.sectionHeaderRow}>
            <Text style={typography.subheading}>My decks</Text>
            <Button
              label="+ New deck"
              variant="primary"
              size="sm"
              onPress={() => router.push("/create-deck")}
            />
          </View>
          <FlatList
            data={decks}
            keyExtractor={(item) => item.id}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <DeckCard
                deck={item}
                onPress={() => router.push(`/deck/${item.id}`)}
                onLongPress={() => onDeckLongPress(item)}
              />
            )}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  greetingBlock: { gap: spacing.xs },
  syncLabel: { ...typography.caption, color: colors.textSecondary },

  secondaryRow: { flexDirection: "row", gap: spacing.sm },

  emptyFill: { flex: 1, justifyContent: "center" },

  deckSection: { flex: 1, gap: spacing.md },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  list: { flex: 1 },
  listContent: { gap: spacing.sm, paddingBottom: spacing.xl },
});
