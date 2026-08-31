import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { AccessibilityInfo, Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../src/auth/AuthService";
import { onWorkspaceChanged } from "../src/auth/authSignal";
import type { UserIdentity } from "../src/auth/identity";
import { onSyncComplete } from "../src/cloud/sync/syncSignal";
import type { SyncStatus } from "../src/cloud/sync/syncState";
import { SYNC_STATUS_KEYS } from "../src/cloud/sync/syncStatusCopy";
import { useSyncState } from "../src/cloud/sync/useSyncState";
import { getHomeGreeting } from "../src/content/timeGreeting";
import { sortDeckCollectionsCanonical } from "../src/domain/deckCollectionOrder";
import { getAssignedDeckIds, getUnfiledDecks } from "../src/domain/deckCollectionMembership";
import { sortDecksCanonical } from "../src/domain/deckOrder";
import { mirrorIfRtl, useLayoutDirection } from "../src/i18n/direction";
import { useTranslation } from "../src/i18n";
import type { DeckRecord } from "../src/models/deck";
import type { DeckCollectionRecord } from "../src/models/deckCollection";
import { getActiveDeckCollections, unassignDeckFromCollection } from "../src/storage/deckCollections";
import { deleteDeckById, getDecksAll } from "../src/storage/decks";
import type { WorkspaceScope } from "../src/storage/workspaceScope";
import { useTheme, type ThemeTokens } from "@/src/theme";
import { AccountButton } from "../src/ui/AccountButton";
import { Button } from "../src/ui/Button";
import { Card } from "../src/ui/Card";
import { DeckCard } from "../src/ui/DeckCard";
import { DeckCollectionChip } from "../src/ui/DeckCollectionChip";
import { showDeckActionsSheet } from "../src/ui/deckActionsSheet";
import { EmptyState } from "../src/ui/EmptyState";
import { HomeHeader } from "../src/ui/HomeHeader";
import { IconButton } from "../src/ui/IconButton";
import { Screen } from "../src/ui/Screen";
import { SecondaryAction } from "../src/ui/SecondaryAction";

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
// behavior for an offline-first app, not an error. Built from the live theme rather than a
// module-level constant, since colors.* is now appearance-dependent.
function syncStatusMetaFor(colors: ThemeTokens): Record<SyncStatus, { icon: ComponentProps<typeof Ionicons>["name"]; color: string }> {
  return {
    unknown: { icon: "time-outline", color: colors.textSecondary },
    syncing: { icon: "sync-outline", color: colors.textSecondary },
    synced: { icon: "checkmark-circle-outline", color: colors.success },
    syncedWithWarnings: { icon: "alert-circle-outline", color: colors.warning },
    offline: { icon: "cloud-offline-outline", color: colors.textSecondary },
    needsAttention: { icon: "alert-circle-outline", color: colors.danger },
  };
}

export default function DecksHome() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, spacing, typography } = useTheme();
  const { direction, row } = useLayoutDirection();
  const [decks, setDecksState] = useState<DeckRecord[]>([]);
  const [collections, setCollections] = useState<DeckCollectionRecord[]>([]);
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
  const syncStatusMeta = syncStatusMetaFor(colors)[syncState.status];

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
    const [allDecks, activeCollections] = await Promise.all([
      getDecksAll(activeScope),
      getActiveDeckCollections(activeScope),
    ]);
    const active = allDecks.filter((deck) => !deck.deletedAt);
    // Canonical order (docs/deck-ordering.md) — without this, two devices holding the same
    // decks can render them in different orders, since raw storage order depends on whether a
    // deck was created locally (prepended) or arrived via sync pull (appended).
    setDecksState(sortDecksCanonical(active));
    setCollections(sortDeckCollectionsCanonical(activeCollections));
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

            // Deck Collections keep membership on their own side (deckIds), not on DeckRecord
            // (see docs/deck-collections.md) — this sweeps the deleted deck's id out of whatever
            // collection held it, purely local bookkeeping with no effect on deck sync.
            await unassignDeckFromCollection(activeScope, deck.id);

            await loadDecks(activeScope);
          } catch (error) {
            console.error("[home] delete deck failed:", error);
            Alert.alert(t("home.deleteDeckFailedTitle"), t("home.deleteDeckFailedBody"));
          } finally {
            setMutating(false);
          }
        },
      },
    ]);
  };

  const onDeckLongPress = (deck: DeckRecord) => {
    // Home's flat deck list only ever shows unfiled decks (see loadDecks) — there is never a
    // "Remove from collection" action to offer here, only Move (which functions as an assign
    // for an unfiled deck).
    showDeckActionsSheet({
      t,
      onRename: () => router.push(`/deck/${deck.id}/edit`),
      onMoveToCollection: () => router.push(`/deck/${deck.id}/move-to-collection` as any),
      onDelete: () => confirmDelete(deck),
    });
  };

  const isEmpty = loaded && decks.length === 0;

  // Shared with the Add Decks picker (src/domain/deckCollectionMembership.ts) rather than each
  // screen re-deriving its own notion of "assigned"/"unfiled".
  const assignedDeckIds = useMemo(() => getAssignedDeckIds(decks, collections), [decks, collections]);
  const unassignedDecks = useMemo(() => getUnfiledDecks(decks, collections), [decks, collections]);
  // assignedDeckIds is the union of every collection's deckIds already intersected against the
  // real active deck list — filtering this one collection's deckIds against it is equivalent to
  // intersecting against active decks directly, without needing a second set.
  const deckCountForCollection = (collection: DeckCollectionRecord) =>
    collection.deckIds.filter((id) => assignedDeckIds.has(id)).length;
  const hasCollections = collections.length > 0;

  return (
    <Screen>
      <HomeHeader
        onTitleLongPress={__DEV__ ? () => router.push({ pathname: "/dev-tools" as any }) : undefined}
      >
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

      <View style={[styles.greetingBlock, { gap: spacing.xs }]}>
        <Text style={[typography.heading, { color: colors.textPrimary }]} accessibilityRole="header">
          {greeting.headline}
        </Text>
        {greeting.supporting ? (
          <Text style={[typography.secondary, { color: colors.textSecondary }]}>{greeting.supporting}</Text>
        ) : null}
        {syncStatusText ? (
          <View style={[styles.syncRow, { gap: spacing.xs }]} accessibilityLiveRegion="polite">
            <Ionicons name={syncStatusMeta.icon} size={14} color={syncStatusMeta.color} />
            <Text style={[typography.caption, styles.syncLabel, { color: syncStatusMeta.color }]}>{syncStatusText}</Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.secondaryRow, { gap: spacing.sm }]}>
        <SecondaryAction
          icon="compass-outline"
          label={t("home.discoverButton")}
          onPress={() => router.push({ pathname: "/discover" as any })}
        />
        <SecondaryAction
          icon="library-outline"
          label={t("home.libraryButton")}
          onPress={() => router.push({ pathname: "/library" as any })}
        />
        <SecondaryAction icon="download-outline" label={t("settings.importDeck")} onPress={() => router.push("/import")} />
        <SecondaryAction
          icon="trash-outline"
          label={t("settings.recentlyDeleted")}
          onPress={() => router.push({ pathname: "/recently-deleted" as any })}
        />
      </View>

      <Pressable
        onPress={() => router.push({ pathname: "/discover" as any })}
        accessibilityRole="button"
        accessibilityLabel={t("home.discoverCardAccessibilityLabel")}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <Card style={{ gap: spacing.sm }}>
          <View style={[styles.discoverCardHeader, row, { gap: spacing.sm }]}>
            <View style={[styles.discoverIconWrap, { backgroundColor: colors.accentSubtle }]}>
              <Ionicons name="compass-outline" size={22} color={colors.accent} />
            </View>
            <View style={styles.discoverCardText}>
              <Text style={[typography.subheading, { color: colors.textPrimary }]}>{t("home.discoverCardTitle")}</Text>
              <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("home.discoverCardBody")}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} style={mirrorIfRtl(direction)} />
          </View>
        </Card>
      </Pressable>

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
        <View style={[styles.deckSection, { gap: spacing.md }]}>
          <FlatList
            data={unassignedDecks}
            keyExtractor={(item) => item.id}
            style={styles.list}
            contentContainerStyle={[styles.listContent, { gap: spacing.sm, paddingBottom: spacing.xl }]}
            ListHeaderComponent={
              <View style={{ gap: spacing.md }}>
                <View style={{ gap: spacing.sm }}>
                  <View style={styles.sectionHeaderRow}>
                    <Text style={[typography.subheading, { color: colors.textPrimary }]}>{t("home.collectionsHeader")}</Text>
                    <Button
                      label={t("home.newCollectionButton")}
                      variant="primary"
                      size="sm"
                      onPress={() => router.push({ pathname: "/deck-collections/create" as any })}
                    />
                  </View>
                  {hasCollections ? (
                    <View style={[styles.collectionsRow, { gap: spacing.sm }]}>
                      {collections.map((collection) => (
                        <DeckCollectionChip
                          key={collection.id}
                          collection={collection}
                          deckCount={deckCountForCollection(collection)}
                          onPress={() => router.push({ pathname: "/deck-collections/[id]" as any, params: { id: collection.id } })}
                        />
                      ))}
                    </View>
                  ) : (
                    <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("home.noCollectionsYet")}</Text>
                  )}
                </View>

                <View style={styles.sectionHeaderRow}>
                  <Text style={[typography.subheading, { color: colors.textPrimary }]}>
                    {hasCollections ? t("home.unfiledDecksHeader") : t("home.myDecks")}
                  </Text>
                  <Button
                    label={t("home.newDeckButton")}
                    variant="primary"
                    size="sm"
                    onPress={() => router.push("/create-deck")}
                  />
                </View>
              </View>
            }
            ListHeaderComponentStyle={{ marginBottom: spacing.md }}
            ListEmptyComponent={
              hasCollections ? (
                <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("home.allDecksOrganized")}</Text>
              ) : null
            }
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
  greetingBlock: {},
  syncRow: { flexDirection: "row", alignItems: "center" },
  syncLabel: {},

  secondaryRow: { flexDirection: "row", flexWrap: "wrap" },
  discoverCardHeader: { flexDirection: "row", alignItems: "center" },
  discoverIconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  discoverCardText: { flex: 1 },
  pressed: { opacity: 0.86 },

  emptyFill: { flex: 1, justifyContent: "center" },

  deckSection: { flex: 1 },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  collectionsRow: { flexDirection: "row", flexWrap: "wrap" },
  list: { flex: 1 },
  listContent: {},
});
