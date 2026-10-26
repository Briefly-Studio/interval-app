import { Alert } from "react-native";
import type { TranslateFn } from "../i18n/translateFn";

/** Native alert keeps focus, logical actions and RTL behavior consistent with AI consent. */
export function confirmGenerationPlan(t: TranslateFn, summary: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(t("generateDeck.multi.confirmTitle"), summary, [
      { text: t("common.cancel"), style: "cancel", onPress: () => resolve(false) },
      { text: t("generateDeck.generateButton"), onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
