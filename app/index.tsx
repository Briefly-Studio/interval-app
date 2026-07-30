import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { AccessibilityInfo, Alert, FlatList, Platform, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../src/auth/AuthService";
import { onWorkspaceChanged } from "../src/auth/authSignal";
import type { UserIdentity } from "../src/auth/identity";
import { SyncService } from "../src/cloud/sync/SyncService";
import { onSyncComplete } from "../src/cloud/sync/syncSignal";
import type { SyncStatus } from "../src/cloud/sync/syncState";
import { SYNC_STATUS_KEYS } from "../src/cloud/sync/syncStatusCopy";
import { useSyncState } from "../src/cloud/sync/useSyncState";
import { getHomeGreeting } from "../src/content/timeGreeting";
import { useTranslation } from "../src/i18n";
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

// Status is never conveyed by color alone — every status renders an icon + text pairing.
// "offline" is deliberately styled as neutral/muted (not danger) since it's expected, normal
// behavior for an offline-first app, not an error.
const SYNC_STATUS_META: Record<
  SyncStatus,
  { icon: ComponentProps<typeof Ionicons>["name"]; color: string }
> = {
  unknown: { icon: "time-outline", color: colors.textSecondary },
  syncing: { icon: "sync-outline", color: colors.textSecondary },
  synced: { icon: "checkmark-circle-outline", color: colors.success },
  offline: { icon: "cloud-offline-outline", color: colors.textSecondary },
  needsAttention: { icon: "alert-circle-outline", color: colors.danger },
};

export default function DecksHome() {
  const router = useRouter();
  const { t } = useTranslation();
  const [decks, setDecksState] = useState<DeckRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [scope, setScope] = useState<WorkspaceScope>({ kind: "guest" });
  const [identity, setIdentity] = useState<UserIdentity | null>(null);
  const syncState = useSyncState();
  const signedIn = scope.kind === "user";

  // Small presentational identity area — derives only display text, never anything used for
  // storage/sync/authorization, which stays sub-scoped exactly as before.
  const greeting = useMemo(() => {
    // Prefers nickname over given_name (never falls further to email prefix/"there" here — the
    // greeting should stay silent-on-name rather than show an email prefix in a warm sentence).
    if (scope.kind === "user") return getHomeGreeting(t, identity?.nickname || identity?.givenName);
    return { headline: t("home.guestHeadline"), supporting: t("home.guestSupporting") };
  }, [scope, identity, t]);

  // Guest's supporting line above already says "Your offline workspace" — a second sync caption
  // directly under it would just repeat the same fact, and there is no cloud identity to report
  // a sync status for anyway (see CLAUDE.md's Core Product Rule: the app is fully useful without
  // an account) — so the sync caption is authenticated-only. Uses real state from useSyncState()
  // rather than a fake "has a sync event fired this session" flag: it can render "syncing",
  // "offline", and "needs attention" too, not just a hardcoded "Synced".
  const syncStatusText = signedIn ? t(SYNC_STATUS_KEYS[syncState.status]) : null;
  const syncStatusMeta = SYNC_STATUS_META[syncState.status];

  // Announce only meaningful status transitions (not the initial mount, and not every internal
  // isOnline/pending-count tick) — paired with the icon+color below so status is never
  // color-only information.
  const previousStatusRef = useRef<SyncStatus | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    const isFirstObservation = previousStatusRef.current === null;
    const changed = previousStatusRef.current !== syncState.status;
    previousStatusRef.current = syncState.status;
    if (isFirstObservation || !changed) return;
    if (syncStatusText) AccessibilityInfo.announceForAccessibility(syncStatusText);
  }, [signedIn, syncState.status, syncStatusText]);

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

  // Reloading the deck list on sync completion (so changes from other devices appear without a
  // manual refresh) is unrelated to the sync-status label itself — useSyncState() above already
  // reacts independently to every status transition (syncing/synced/offline/needsAttention),
  // this only needs the "a successful sync just happened" edge to know when to re-read decks.
  useEffect(() => {
    const unsub = onSyncComplete(() => {
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
    Alert.alert(t("home.deleteDeckTitle"), t("home.deleteDeckBody", { title: deck.title }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("deckDetail.deleteAction"),
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
        t("home.renameDeckTitle"),
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

    Alert.alert(t("home.renameNotAvailableTitle"), t("home.renameNotAvailableBody"));
  };

  const onDeckLongPress = (deck: DeckRecord) => {
    Alert.alert(t("home.deckActionsTitle"), undefined, [
      { text: t("home.renameAction"), onPress: () => renameDeck(deck) },
      { text: t("deckDetail.deleteAction"), style: "destructive", onPress: () => confirmDelete(deck) },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  };

  const isEmpty = loaded && decks.length === 0;

  return (
    <Screen>
      <HomeHeader onTitleLongPress={() => router.push({ pathname: "/dev-tools" as any })}>
        {__DEV__ && (
          <IconButton
            name="construct-outline"
            accessibilityLabel={t("home.devToolsLabel")}
            variant="surface"
            onPress={() => router.push({ pathname: "/dev-tools" as any })}
          />
        )}
        <AccountButton
          variant={signedIn ? "initial" : "signIn"}
          label={signedIn ? accountInitial(identity) : t("settings.signIn")}
          accessibilityLabel={signedIn ? t("home.accountMenuLabel") : t("settings.signIn")}
          onPress={onAccountPress}
        />
      </HomeHeader>

      <View style={styles.greetingBlock}>
        <Text style={typography.heading}>{greeting.headline}</Text>
        {greeting.supporting ? <Text style={typography.secondary}>{greeting.supporting}</Text> : null}
        {syncStatusText ? (
          <View style={styles.syncRow} accessibilityLiveRegion="polite">
            <Ionicons name={syncStatusMeta.icon} size={14} color={syncStatusMeta.color} />
            <Text style={[styles.syncLabel, { color: syncStatusMeta.color }]}>{syncStatusText}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.secondaryRow}>
        <SecondaryAction icon="download-outline" label={t("settings.importDeck")} onPress={() => router.push("/import")} />
        <SecondaryAction
          icon="trash-outline"
          label={t("settings.recentlyDeleted")}
          onPress={() => router.push({ pathname: "/recently-deleted" as any })}
        />
      </View>

      {isEmpty ? (
        <View style={styles.emptyFill}>
          <EmptyState
            icon={signedIn ? "albums-outline" : "cloud-offline-outline"}
            title={signedIn ? t("home.emptyTitleSignedIn") : t("home.emptyTitleGuest")}
            description={signedIn ? t("home.emptyDescriptionSignedIn") : t("home.emptyDescriptionGuest")}
          >
            <Button label={t("home.createDeckButton")} variant="primary" fullWidth onPress={() => router.push("/create-deck")} />
            {signedIn ? (
              <Button label={t("settings.importDeck")} variant="secondary" fullWidth onPress={() => router.push("/import")} />
            ) : (
              <Button label={t("settings.signIn")} variant="secondary" fullWidth onPress={() => router.push("/sign-in")} />
            )}
          </EmptyState>
        </View>
      ) : (
        <View style={styles.deckSection}>
          <View style={styles.sectionHeaderRow}>
            <Text style={typography.subheading}>{t("home.myDecks")}</Text>
            <Button
              label={t("home.newDeckButton")}
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
  syncRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  syncLabel: { ...typography.caption },

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
