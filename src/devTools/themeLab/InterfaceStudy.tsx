// Theme Lab — the single representative Interval interface shown under every theme study, so
// comparisons are apples-to-apples. Uses realistic Interval content, not "Lorem ipsum". Not
// connected to real storage, account data, AWS, or sync — every value here is a static mock.

import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import {
  PreviewBadge,
  PreviewButton,
  PreviewCard,
  PreviewChip,
  PreviewDivider,
  PreviewEmptyState,
  PreviewModal,
  PreviewProgressBar,
  PreviewTabBar,
  PreviewTextInput,
} from "./previewComponents";
import type { ThemeTokens } from "./tokens";

const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export function InterfaceStudy({ tokens }: { tokens: ThemeTokens }) {
  return (
    <View style={[styles.canvas, { backgroundColor: tokens.canvas }]}>
      {/* Interval branded header */}
      <View style={styles.header}>
        <Text style={[styles.wordmark, { color: tokens.textPrimary }]}>Interval</Text>
        <View style={[styles.avatarDot, { backgroundColor: tokens.accentSubtle }]}>
          <Ionicons name="person" size={16} color={tokens.accent} />
        </View>
      </View>

      {/* Typography hierarchy */}
      <View style={styles.typeStack}>
        <Text style={[styles.title, { color: tokens.textPrimary }]}>Your decks</Text>
        <Text style={[styles.heading, { color: tokens.textPrimary }]}>Review due today</Text>
        <Text style={[styles.body, { color: tokens.textPrimary }]}>Sync up to date</Text>
        <Text style={[styles.caption, { color: tokens.textSecondary }]}>Last studied 2 hours ago</Text>
      </View>

      {/* Search input (focus/selected state) */}
      <PreviewTextInput tokens={tokens} placeholder="Search decks…" focused />

      {/* Segmented filter (selected state without relying on color alone — checkmark + border) */}
      <View style={styles.chipRow}>
        <PreviewChip tokens={tokens} label="All" tone="accent" selected />
        <PreviewChip tokens={tokens} label="Due" tone="neutral" />
        <PreviewChip tokens={tokens} label="Mastered" tone="neutral" />
      </View>

      {/* Deck card, with progress + difficulty/status chips */}
      <PreviewCard tokens={tokens}>
        <View style={styles.cardHeaderRow}>
          <Text style={[styles.cardTitle, { color: tokens.textPrimary }]} numberOfLines={2}>
            AWS SysOps Study Deck
          </Text>
          <Ionicons name="ellipsis-horizontal" size={18} color={tokens.textMuted} />
        </View>
        <Text style={[styles.cardSubtitle, { color: tokens.textSecondary }]}>Networking &amp; Content Delivery</Text>
        <View style={styles.cardMetaRow}>
          <Text style={[styles.cardMeta, { color: tokens.textSecondary }]}>48 cards</Text>
          <Text style={[styles.cardMeta, { color: tokens.textSecondary }]}>72% mastered</Text>
        </View>
        <PreviewProgressBar tokens={tokens} progress={0.72} />
        <View style={styles.chipRow}>
          <PreviewChip tokens={tokens} label="Medium" tone="warning" />
          <PreviewChip tokens={tokens} label="12 due today" tone="accent" />
        </View>
      </PreviewCard>

      {/* Status states */}
      <View style={styles.chipRow}>
        <PreviewBadge tokens={tokens} label="Sync up to date" tone="success" />
        <PreviewBadge tokens={tokens} label="Storage nearly full" tone="warning" />
        <PreviewBadge tokens={tokens} label="Sign-in expired" tone="danger" />
      </View>

      <PreviewDivider tokens={tokens} />

      {/* Buttons: primary, secondary, destructive, disabled */}
      <View style={styles.buttonColumn}>
        <PreviewButton tokens={tokens} label="Start review" variant="primary" />
        <PreviewButton tokens={tokens} label="View deck details" variant="secondary" />
        <PreviewButton tokens={tokens} label="Delete deck" variant="danger" />
        <PreviewButton tokens={tokens} label="Import (unavailable offline)" variant="secondary" disabled />
      </View>

      <PreviewDivider tokens={tokens} />

      {/* Recently Deleted style row + empty state */}
      <PreviewCard tokens={tokens}>
        <Text style={[styles.cardTitle, { color: tokens.textPrimary }]}>Recently Deleted</Text>
        <PreviewEmptyState tokens={tokens} message="No decks in Recently Deleted right now." />
      </PreviewCard>

      {/* Floating surface / modal sample */}
      <PreviewModal
        tokens={tokens}
        title="Delete this deck?"
        body="AWS SysOps Study Deck and its 48 cards will move to Recently Deleted."
      />

      {/* Navigation sample */}
      <PreviewTabBar tokens={tokens} activeIndex={0} />
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    width: "100%",
    maxWidth: "100%",
    borderRadius: 20,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  wordmark: { fontSize: 24, fontWeight: "700", letterSpacing: -0.3 },
  avatarDot: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  typeStack: { gap: 2 },
  title: { fontSize: 20, fontWeight: "700" },
  heading: { fontSize: 16, fontWeight: "600" },
  body: { fontSize: 14, fontWeight: "400" },
  caption: { fontSize: 12, fontWeight: "400" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  cardHeaderRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.sm },
  cardTitle: { fontSize: 16, fontWeight: "700", flex: 1 },
  cardSubtitle: { fontSize: 13, marginTop: 2 },
  cardMetaRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.xs, marginBottom: 2 },
  cardMeta: { fontSize: 12, fontWeight: "600" },
  buttonColumn: { gap: spacing.sm },
});
