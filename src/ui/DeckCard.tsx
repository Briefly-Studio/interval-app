import { Pressable, StyleSheet, Text } from "react-native";

import { Card } from "./Card";
import { spacing, typography } from "./theme";
import type { DeckRecord } from "../models/deck";

type DeckCardProps = {
  deck: DeckRecord;
  onPress: () => void;
  onLongPress: () => void;
};

// Deliberately shows only real, currently-available data (title + created date) — nothing
// fabricated. Long-press opens the existing rename/delete action sheet, unchanged from before
// this redesign.
export function DeckCard({ deck, onPress, onLongPress }: DeckCardProps) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`${deck.title}. Double tap to open. Long press for rename or delete options.`}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      <Card style={styles.card}>
        <Text style={typography.subheading} numberOfLines={2}>
          {deck.title}
        </Text>
        <Text style={typography.caption}>
          Created {new Date(deck.createdAt).toLocaleDateString()}
        </Text>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs },
  pressed: { opacity: 0.85 },
});
