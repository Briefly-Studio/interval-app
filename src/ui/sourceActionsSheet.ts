import { Alert } from "react-native";

import type { TranslateParams, TranslationKey } from "../i18n";

// Shared action-sheet construction for Library source long-press actions — mirrors
// src/ui/deckActionsSheet.ts's shape exactly (same Alert.alert-based action-sheet convention
// already established for decks, reused here rather than inventing a new interaction pattern).
// Reused by the root Library list (app/library/index.tsx) and Collection Detail
// (app/library/collections/[id].tsx).
type ShowSourceActionsSheetParams = {
  t: (key: TranslationKey, params?: TranslateParams) => string;
  onEdit: () => void;
  onChooseCollections: () => void;
  /** Only offered for a source currently shown inside a specific collection's own detail screen —
   * omit entirely when the list isn't collection-scoped (e.g. the root Library list). */
  onRemoveFromCollection?: () => void;
  isArchived: boolean;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
};

export function showSourceActionsSheet({
  t,
  onEdit,
  onChooseCollections,
  onRemoveFromCollection,
  isArchived,
  onArchive,
  onRestore,
  onDelete,
}: ShowSourceActionsSheetParams) {
  const options: { text: string; style?: "default" | "cancel" | "destructive"; onPress?: () => void }[] = [
    { text: t("librarySource.detail.editAction"), onPress: onEdit },
    { text: t("librarySource.detail.assignCollectionAction"), onPress: onChooseCollections },
  ];
  if (onRemoveFromCollection) {
    options.push({ text: t("sourceCollections.detail.removeFromCollectionAction"), onPress: onRemoveFromCollection });
  }
  options.push(
    isArchived
      ? { text: t("librarySource.detail.restoreAction"), onPress: onRestore }
      : { text: t("librarySource.detail.archiveAction"), onPress: onArchive }
  );
  options.push({ text: t("librarySource.detail.deleteAction"), style: "destructive", onPress: onDelete });
  options.push({ text: t("common.cancel"), style: "cancel" });

  Alert.alert(t("librarySource.actionsTitle"), undefined, options);
}
