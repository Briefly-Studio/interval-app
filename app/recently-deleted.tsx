import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, SectionList, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../src/auth/AuthService";
import { describeSyncFailure } from "../src/cloud/sync/http";
import { SyncService } from "../src/cloud/sync/SyncService";
import { getSyncState } from "../src/cloud/sync/syncState";
import { useTranslation } from "../src/i18n";
import type { CardRecord } from "../src/models/card";
import type { DeckRecord } from "../src/models/deck";
import { getCardsAll, restoreCardToDeck, setCards } from "../src/storage/cards";
import { getDecksAll, setDecks } from "../src/storage/decks";
import { getOrCreateRecoveryDeck, resolveCardRestoreTarget } from "../src/storage/recovery";
import { getSessions, setSessions } from "../src/storage/sessions";
import { Button } from "../src/ui/Button";
import { Card } from "../src/ui/Card";
import { EmptyState } from "../src/ui/EmptyState";
import { IconButton } from "../src/ui/IconButton";
import { Screen } from "../src/ui/Screen";
import { SecondaryAction } from "../src/ui/SecondaryAction";
import { useTheme } from "@/src/theme";

const TRASH_DAYS = 30;

type DeletedCardEntry = {
  card: CardRecord;
  deckTitle: string;
  deckDeleted: boolean;
};

// One shared row-item union so both sections can live in a single SectionList (a nested
// FlatList/ScrollView per section would trip React Native's "VirtualizedList inside a
// ScrollView" warning and break on small screens). Each section renders its own EmptyState via
// a synthetic "*Empty" row rather than swapping the whole screen to a single full-page empty
// state — decks and cards need independently-worded empty copy.
type RowItem =
  | { kind: "deck"; deck: DeckRecord }
  | { kind: "deckEmpty" }
  | { kind: "card"; entry: DeletedCardEntry }
  | { kind: "cardEmpty" };

type Section = {
  key: string;
  title: string;
  count: number;
  data: RowItem[];
};

function withinCutoff(deletedAt: string | undefined, cutoff: number, showExpired: boolean): boolean {
  if (!deletedAt) return false;
  const parsed = Date.parse(deletedAt);
  if (!Number.isFinite(parsed)) return false;
  if (showExpired) return true;
  return parsed >= cutoff;
}

export default function RecentlyDeletedScreen() {
  const router = useRouter();
  const { t, plural, language } = useTranslation();
  const { colors, spacing, typography } = useTheme();
  const [decks, setDecksState] = useState<DeckRecord[]>([]);
  const [cardEntries, setCardEntries] = useState<DeletedCardEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showExpired, setShowExpired] = useState(false);
  // Per-item, not a single screen-wide flag — restoring one row must not disable every other
  // row's Restore button while its own network/sync round trip is in flight. Decks and cards
  // get separate sets so restoring a card never disables deck rows, or other card rows.
  const [restoringDeckIds, setRestoringDeckIds] = useState<Set<string>>(new Set());
  const [restoringCardIds, setRestoringCardIds] = useState<Set<string>>(new Set());

  function formatDeletedMeta(deletedAt: string | undefined): string {
    if (!deletedAt) return t("recentlyDeleted.deletedUnknown");
    const deletedTime = Date.parse(deletedAt);
    if (!Number.isFinite(deletedTime)) return t("recentlyDeleted.deletedUnknown");
    const daysSince = Math.max(0, Math.floor((Date.now() - deletedTime) / (24 * 60 * 60 * 1000)));
    const dateLabel = new Date(deletedTime).toLocaleDateString(language, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    return plural("recentlyDeleted.deletedMetaDays", daysSince, { date: dateLabel });
  }

  const loadDeleted = useCallback(async () => {
    const scope = await AuthService.getActiveScope();
    const allDecks = await getDecksAll(scope);
    const cutoff = Date.now() - TRASH_DAYS * 24 * 60 * 60 * 1000;

    const deletedDecks = allDecks
      .filter((deck) => withinCutoff(deck.deletedAt, cutoff, showExpired))
      .sort((a, b) => (Date.parse(b.deletedAt ?? "") || 0) - (Date.parse(a.deletedAt ?? "") || 0));
    setDecksState(deletedDecks);

    // Cards are stored per-deck, so gathering every deleted card means walking every deck (both
    // active and soft-deleted) and pulling its own card array — there is no global card index.
    // Cards tombstoned only as a side effect of THEIR deck being deleted (deletedByDeckCascade)
    // are deliberately excluded here: they're already restorable as part of that deck's single
    // "Restore" action above, and listing them again individually would just be a noisy,
    // redundant duplicate of every card in a deleted deck. This section is for cards the user
    // deleted on their own, independent of any deck deletion.
    const deckById = new Map(allDecks.map((d) => [d.id, d] as const));
    const entries: DeletedCardEntry[] = [];
    for (const deck of allDecks) {
      const cards = await getCardsAll(scope, deck.id);
      for (const card of cards) {
        if (card.deletedByDeckCascade) continue;
        if (!withinCutoff(card.deletedAt, cutoff, showExpired)) continue;
        const owningDeck = deckById.get(card.deckId);
        entries.push({
          card,
          deckTitle: owningDeck?.title?.trim() ? owningDeck.title : t("recentlyDeleted.deckNoLongerAvailable"),
          deckDeleted: Boolean(owningDeck?.deletedAt),
        });
      }
    }
    entries.sort(
      (a, b) => (Date.parse(b.card.deletedAt ?? "") || 0) - (Date.parse(a.card.deletedAt ?? "") || 0)
    );
    setCardEntries(entries);

    setLoaded(true);
  }, [showExpired, t]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        await loadDeleted();
        if (!alive) return;
      })();
      return () => {
        alive = false;
      };
    }, [loadDeleted])
  );

  const restoreDeck = useCallback(
    async (deck: DeckRecord) => {
      // Ignore duplicate taps while this exact item is already restoring — one in-flight
      // restore per item, not a full-screen lock.
      if (restoringDeckIds.has(deck.id)) return;
      setRestoringDeckIds((prev) => new Set(prev).add(deck.id));
      try {
        const scope = await AuthService.getActiveScope();
        const allDecks = await getDecksAll(scope);
        const now = new Date().toISOString();
        const updated = allDecks.map((item) => {
          if (item.id !== deck.id) return item;
          return {
            ...item,
            deletedAt: undefined,
            updatedAt: now,
            rev: (item.rev ?? 0) + 1,
            dirty: true,
            lastSyncedAt: undefined,
          };
        });
        await setDecks(scope, updated);

        const allCards = await getCardsAll(scope, deck.id);
        const updatedCards = allCards.map((card) => {
          // Only cards tombstoned as a side effect of this exact deck deletion come back — a
          // card the user deleted individually beforehand has no deletedByDeckCascade flag and
          // stays deleted. See CardRecord.deletedByDeckCascade for why this can't be inferred
          // from deletedAt alone (two deletes can land in the same millisecond).
          if (!card.deletedAt || !card.deletedByDeckCascade) return card;
          return {
            ...card,
            deletedAt: undefined,
            deletedByDeckCascade: undefined,
            updatedAt: now,
            rev: (card.rev ?? 0) + 1,
            dirty: true,
          };
        });
        await setCards(scope, deck.id, updatedCards);

        // Sessions have no individual-delete path of their own — deleteSessionsForDeck (the
        // deck cascade) is the only code that ever sets a session's deletedAt, so every
        // tombstoned session for this deckId was deleted by this deck's deletion and is safe to
        // restore.
        const allSessions = await getSessions(scope);
        const updatedSessions = allSessions.map((session) => {
          if (session.deckId !== deck.id || !session.deletedAt) return session;
          return {
            ...session,
            deletedAt: undefined,
            updatedAt: now,
            rev: (session.rev ?? 0) + 1,
            dirty: true,
          };
        });
        await setSessions(scope, updatedSessions);

        // The local restore above has already fully succeeded — a background sync failure must
        // never flip the user-visible outcome back to "Restore failed". Fire-and-forget,
        // matching how app/_layout.tsx already treats syncOnce() elsewhere. Ordinary offline
        // failures are already reflected in the centralized sync state and must never surface a
        // visible error notification here — only genuinely actionable (needsAttention) ones do.
        SyncService.syncOnce().catch((e) => {
          if (getSyncState().status === "needsAttention") {
            console.error("SYNC FAILED:", describeSyncFailure(e));
          }
        });

        await loadDeleted();
        Alert.alert(t("recentlyDeleted.restored"));
      } catch {
        Alert.alert(t("recentlyDeleted.restoreFailedTitle"), t("recentlyDeleted.restoreFailedGeneric"));
      } finally {
        setRestoringDeckIds((prev) => {
          const next = new Set(prev);
          next.delete(deck.id);
          return next;
        });
      }
    },
    [restoringDeckIds, loadDeleted, t]
  );

  const restoreCard = useCallback(
    async (entry: DeletedCardEntry) => {
      const card = entry.card;
      if (restoringCardIds.has(card.id)) return;
      setRestoringCardIds((prev) => new Set(prev).add(card.id));
      try {
        const scope = await AuthService.getActiveScope();
        const target = await resolveCardRestoreTarget(scope, card);

        if (target.kind === "corrupted") {
          // Never log card content (front/back) — only a diagnostic code. The tombstone itself
          // is left completely untouched.
          console.warn("[recently-deleted] corrupted-deck-reference");
          Alert.alert(t("recovery.corruptedAlertTitle"), t("recovery.corruptedAlertBody"));
          return;
        }

        if (target.kind === "activeDeck") {
          await restoreCardToDeck(scope, card, card.deckId);
          SyncService.syncOnce().catch((e) => {
            if (getSyncState().status === "needsAttention") {
              console.error("SYNC FAILED:", describeSyncFailure(e));
            }
          });
          await loadDeleted();
          Alert.alert(t("recentlyDeleted.restored"));
          return;
        }

        if (target.kind === "deletedDeck") {
          const parentDeck = target.deck;
          Alert.alert(
            t("recovery.deletedDeckAlertTitle"),
            t("recovery.deletedDeckAlertBody", { deckTitle: parentDeck.title }),
            [
              { text: t("recentlyDeleted.cancel"), style: "cancel" },
              {
                text: t("recovery.restoreDeckFirst"),
                onPress: () => {
                  restoreDeck(parentDeck);
                },
              },
            ]
          );
          return;
        }

        // missingDeck — also covers a deckId that belongs to another workspace entirely, which
        // is indistinguishable from "missing" here: `scope` already fully determines which
        // decks getDecksAll can see, so a foreign deckId simply never turns up. See
        // resolveCardRestoreTarget's doc comment in src/storage/recovery.ts.
        Alert.alert(t("recovery.missingDeckAlertTitle"), t("recovery.missingDeckAlertBody"), [
          { text: t("recentlyDeleted.cancel"), style: "cancel" },
          {
            text: t("recovery.restoreIntoRecovered"),
            onPress: async () => {
              try {
                const recoveryDeck = await getOrCreateRecoveryDeck(scope);
                await restoreCardToDeck(scope, card, recoveryDeck.id);
                SyncService.syncOnce().catch((e) => {
                  if (getSyncState().status === "needsAttention") {
                    console.error("SYNC FAILED:", describeSyncFailure(e));
                  }
                });
                await loadDeleted();
                Alert.alert(t("recentlyDeleted.restored"));
              } catch {
                Alert.alert(t("recentlyDeleted.restoreFailedTitle"), t("recentlyDeleted.restoreFailedGeneric"));
              }
            },
          },
        ]);
      } catch {
        Alert.alert(t("recentlyDeleted.restoreFailedTitle"), t("recentlyDeleted.restoreFailedGeneric"));
      } finally {
        setRestoringCardIds((prev) => {
          const next = new Set(prev);
          next.delete(card.id);
          return next;
        });
      }
    },
    [restoringCardIds, loadDeleted, restoreDeck, t]
  );

  // The old blanket permanent-delete action (and its extension to individually-deleted cards)
  // was removed from this beta release: it only ever mutated local storage — it never marked
  // anything dirty, so it never reached the cloud, and a locally-purged record's tombstone still
  // exists there. A later full resync (e.g. after a forced resync starts over, or a fresh
  // device's first sync) can legitimately re-deliver that same delete change and recreate the
  // local tombstone, which would silently undo a "permanent" deletion the user was told was
  // final. Soft-delete and restore remain fully available; only the "and it's gone forever"
  // promise is removed until the cloud side can honor it. See CardRecord.deletedByDeckCascade
  // and the sync apply logic in src/cloud/sync/SyncService.ts for why this reappearance is a
  // real, reachable path today and not just a theoretical edge case.

  const sections: Section[] = [
    {
      key: "decks",
      title: t("recentlyDeleted.decksSectionTitle"),
      count: decks.length,
      data: !loaded ? [] : decks.length > 0 ? decks.map((deck) => ({ kind: "deck" as const, deck })) : [{ kind: "deckEmpty" as const }],
    },
    {
      key: "cards",
      title: t("recentlyDeleted.cardsSectionTitle"),
      count: cardEntries.length,
      data: !loaded
        ? []
        : cardEntries.length > 0
          ? cardEntries.map((entry) => ({ kind: "card" as const, entry }))
          : [{ kind: "cardEmpty" as const }],
    },
  ];

  return (
    <Screen>
      <View style={[styles.header, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} />
        <Text style={[typography.title, { color: colors.textPrimary }]} accessibilityRole="header">{t("recentlyDeleted.title")}</Text>
      </View>
      <Text style={[typography.secondary, { color: colors.textSecondary }]}>
        {showExpired ? t("recentlyDeleted.showingAllNotice") : t("recentlyDeleted.hiddenExpiredNotice")}
      </Text>

      {__DEV__ && (
        <View style={[styles.actionsRow, { gap: spacing.sm }]}>
          <SecondaryAction
            icon={showExpired ? "eye-off-outline" : "eye-outline"}
            label={showExpired ? t("recentlyDeleted.hideExpired") : t("recentlyDeleted.showExpired")}
            onPress={() => setShowExpired((prev) => !prev)}
          />
        </View>
      )}

      <SectionList
        sections={sections}
        style={styles.flex1}
        contentContainerStyle={[styles.list, { gap: spacing.sm, paddingBottom: spacing.xl }]}
        stickySectionHeadersEnabled={false}
        keyExtractor={(item, index) => {
          if (item.kind === "deck") return `deck-${item.deck.id}`;
          if (item.kind === "card") return `card-${item.entry.card.id}`;
          return `${item.kind}-${index}`;
        }}
        renderSectionHeader={({ section }) => (
          <Text
            style={[
              typography.label,
              { color: colors.textPrimary, marginTop: spacing.md, marginBottom: spacing.xs },
            ]}
            accessibilityRole="header"
          >
            {loaded ? `${section.title} (${section.count})` : section.title}
          </Text>
        )}
        renderItem={({ item }) => {
          if (item.kind === "deckEmpty") {
            return (
              <EmptyState
                icon="trash-outline"
                title={t("recentlyDeleted.decksEmptyTitle")}
                description={t("recentlyDeleted.decksEmptyDescription")}
              />
            );
          }
          if (item.kind === "cardEmpty") {
            return (
              <EmptyState
                icon="trash-outline"
                title={t("recentlyDeleted.cardsEmptyTitle")}
                description={t("recentlyDeleted.cardsEmptyDescription")}
              />
            );
          }
          if (item.kind === "deck") {
            const deck = item.deck;
            const isRestoring = restoringDeckIds.has(deck.id);
            return (
              <Card style={[styles.deletedRow, { gap: spacing.sm }]}>
                <View style={styles.flex1}>
                  <Text style={[typography.bodyMedium, { color: colors.textPrimary }]} numberOfLines={2}>
                    {deck.title}
                  </Text>
                  <Text style={[typography.caption, { color: colors.textSecondary }]}>
                    {formatDeletedMeta(deck.deletedAt)}
                  </Text>
                </View>
                <Button
                  label={isRestoring ? t("recentlyDeleted.restoring") : t("recentlyDeleted.restore")}
                  variant="secondary"
                  loading={isRestoring}
                  disabled={isRestoring}
                  onPress={() => restoreDeck(deck)}
                  accessibilityLabel={
                    isRestoring
                      ? t("recentlyDeleted.restoringDeckLabel", { title: deck.title })
                      : t("recentlyDeleted.restoreDeckLabel", { title: deck.title })
                  }
                />
              </Card>
            );
          }

          const entry = item.entry;
          const isRestoring = restoringCardIds.has(entry.card.id);
          const cardLabel = entry.card.front.trim() || t("recentlyDeleted.untitledCard");
          return (
            <Card style={[styles.deletedRow, { gap: spacing.sm }]}>
              <View style={styles.flex1}>
                <Text style={[typography.bodyMedium, { color: colors.textPrimary }]} numberOfLines={2}>
                  {cardLabel}
                </Text>
                <Text style={[typography.caption, { color: colors.textSecondary }]} numberOfLines={1}>
                  {entry.deckDeleted
                    ? t("recentlyDeleted.cardInDeletedDeck", { deckTitle: entry.deckTitle })
                    : t("recentlyDeleted.cardInDeck", { deckTitle: entry.deckTitle })}
                </Text>
                <Text style={[typography.caption, { color: colors.textSecondary }]}>
                  {formatDeletedMeta(entry.card.deletedAt)}
                </Text>
              </View>
              <Button
                label={isRestoring ? t("recentlyDeleted.restoring") : t("recentlyDeleted.restore")}
                variant="secondary"
                loading={isRestoring}
                disabled={isRestoring}
                onPress={() => restoreCard(entry)}
                accessibilityLabel={
                  isRestoring
                    ? t("recentlyDeleted.restoringCardLabel", { title: cardLabel })
                    : t("recentlyDeleted.restoreCardLabel", { title: cardLabel })
                }
              />
            </Card>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  actionsRow: { flexDirection: "row" },
  flex1: { flex: 1 },
  list: {},
  deletedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
