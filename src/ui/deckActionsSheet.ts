import { Alert } from "react-native";

import type { TranslateParams, TranslationKey } from "../i18n";

// Shared action-sheet construction for deck long-press actions — reused by Home (app/index.tsx)
// and Deck Collection detail (app/deck-collections/[id].tsx) rather than each screen duplicating
// its own options array. Uses the app's existing Alert.alert-based action-sheet convention
// (already established by Home's pre-existing rename/delete sheet) — deliberately not a new
// interaction pattern.
type ShowDeckActionsSheetParams = {
  t: (key: TranslationKey, params?: TranslateParams) => string;
  onRename: () => void;
  onMoveToCollection: () => void;
  /** Only offered for a deck that's currently assigned to a collection — omit entirely for an
   * unfiled deck (e.g. Home's list, which only ever shows unfiled decks). */
  onRemoveFromCollection?: () => void;
  onDelete: () => void;
};

export function showDeckActionsSheet({
  t,
  onRename,
  onMoveToCollection,
  onRemoveFromCollection,
  onDelete,
}: ShowDeckActionsSheetParams) {
  const options: { text: string; style?: "default" | "cancel" | "destructive"; onPress?: () => void }[] = [
    { text: t("home.renameAction"), onPress: onRename },
    { text: t("home.moveToCollectionAction"), onPress: onMoveToCollection },
  ];
  if (onRemoveFromCollection) {
    options.push({ text: t("deckCollections.detail.removeFromCollectionAction"), onPress: onRemoveFromCollection });
  }
  options.push({ text: t("deckDetail.deleteAction"), style: "destructive", onPress: onDelete });
  options.push({ text: t("common.cancel"), style: "cancel" });

  Alert.alert(t("home.deckActionsTitle"), undefined, options);
}
