import { Alert } from "react-native";

import type { TranslateParams, TranslationKey } from "../i18n";

// First-use AI generation consent prompt — same Alert.alert-based convention already established
// throughout this codebase (src/ui/sourceActionsSheet.ts, deckActionsSheet.ts, and the existing
// "discard draft" confirmation in app/library/[id]/generate/review.tsx) rather than a new custom
// modal: this gives a meaningful title, logical read order, clearly exposed actions, RTL layout,
// and focus handling for free from the OS, exactly what this feature needs, with no new
// accessibility surface to build or get wrong.
//
// Cancel and dismissal settle the pending approval without granting consent. Only an explicit
// tap on Continue calls `onContinue`. See docs/ai-generation-foundation.md's "First-use consent"
// section.

type ShowAiConsentDialogParams = {
  t: (key: TranslationKey, params?: TranslateParams) => string;
  onContinue: () => void;
  onCancel?: () => void;
};

export function showAiConsentDialog({ t, onContinue, onCancel }: ShowAiConsentDialogParams): void {
  Alert.alert(t("generateDeck.consent.title"), t("generateDeck.consent.body"), [
    { text: t("common.cancel"), style: "cancel", onPress: onCancel },
    { text: t("generateDeck.consent.continueButton"), style: "default", onPress: onContinue },
  ], { cancelable: true, onDismiss: onCancel });
}
