import { Pressable, StyleSheet, Text } from "react-native";

import { useTranslation } from "../i18n";
import { useLayoutDirection } from "../i18n/direction";
import { Card } from "./Card";
import { useTheme } from "@/src/theme";
import type { DeckRecord } from "../models/deck";

type DeckCardProps = {
  deck: DeckRecord;
  onPress: () => void;
  onLongPress: () => void;
};

// Deliberately shows only real, currently-available data (title + created date) — nothing
// fabricated. Long-press opens the existing rename/delete action sheet, unchanged from before
// this redesign. accessibilityLabel carries only the deck's identity (the title) — the "how to
// interact" instructions live in accessibilityHint instead, matching the label/hint split used
// elsewhere (see FlashcardSurface), so VoiceOver/TalkBack don't have to read a full sentence of
// usage instructions before the deck's own name.
export function DeckCard({ deck, onPress, onLongPress }: DeckCardProps) {
  const { t, language } = useTranslation();
  const { colors, spacing, typography } = useTheme();
  const { text } = useLayoutDirection();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={deck.title}
      accessibilityHint={t("home.deckCardHint")}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      <Card style={{ gap: spacing.xs }}>
        <Text style={[typography.subheading, text, { color: colors.textPrimary }]} numberOfLines={2}>
          {deck.title}
        </Text>
        <Text style={[typography.caption, text, { color: colors.textSecondary }]}>
          {t("home.deckCardCreatedOn", { date: new Date(deck.createdAt).toLocaleDateString(language) })}
        </Text>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.85 },
});
