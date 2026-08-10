import { Pressable, StyleSheet, Text } from "react-native";

import { useTranslation } from "../i18n";
import { Card } from "./Card";
import { useTheme } from "@/src/theme";
import type { DeckCollectionRecord } from "../models/deckCollection";

type DeckCollectionChipProps = {
  collection: DeckCollectionRecord;
  deckCount: number;
  onPress: () => void;
};

// Home's entry point into a Deck Collection — not a filter/select control (see FilterChip for
// that), a navigation card, matching DeckCard's own tap-to-open pattern. Deliberately shows only
// name + count, never a deck list preview, so it stays a small, scannable label even for a
// collection with many decks.
export function DeckCollectionChip({ collection, deckCount, onPress }: DeckCollectionChipProps) {
  const { plural } = useTranslation();
  const { colors, spacing, typography } = useTheme();
  const countLabel = plural("deckCollections.deckCount", deckCount);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${collection.name}, ${countLabel}`}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
    >
      <Card style={{ gap: spacing.xs }}>
        <Text style={[typography.bodyMedium, { color: colors.textPrimary }]} numberOfLines={1}>
          {collection.name}
        </Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>{countLabel}</Text>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: { minWidth: 140 },
  pressed: { opacity: 0.85 },
});
