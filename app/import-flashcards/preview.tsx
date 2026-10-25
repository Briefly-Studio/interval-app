import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../src/auth/AuthService";
import {
  clearImportDraftSession,
  setImportDraftDeckName,
  useImportDraftSession,
} from "../../src/domain/import/importDraftSession";
import { saveImportedDeck, type SaveImportErrorCode } from "../../src/domain/import/importDeckSave";
import type { ImportWarning, ImportWarningCode } from "../../src/domain/import/types";
import { useTranslation } from "../../src/i18n";
import { useLayoutDirection } from "../../src/i18n/direction";
import { sameScope } from "../../src/storage/workspaceScope";
import { Button } from "../../src/ui/Button";
import { Card } from "../../src/ui/Card";
import { EmptyState } from "../../src/ui/EmptyState";
import { IconButton } from "../../src/ui/IconButton";
import { Screen } from "../../src/ui/Screen";
import { TextField } from "../../src/ui/TextField";
import { useTheme } from "@/src/theme";

// Step 2 (review/confirm) of the import flow — see index.tsx's header comment. Preview-only
// until the user explicitly taps Confirm: nothing is written to storage before that tap (see
// "Import Preview" in the mission this was built from). Mirrors
// app/library/[id]/generate/review.tsx's scope-recheck/recovery pattern.

const SAMPLE_CARD_COUNT = 5;

type TFn = (key: any, params?: any) => string;

function warningCopyKeys(code: ImportWarningCode): { titleKey: string; pluralKey?: string } {
  switch (code) {
    case "header-row-skipped":
      return { titleKey: "importFlashcards.warnings.headerRowSkipped" };
    case "rows-skipped-empty":
      return { titleKey: "importFlashcards.warnings.rowsSkippedEmpty", pluralKey: "importFlashcards.warnings.rowsSkippedEmpty" };
    case "rows-skipped-too-long":
      return { titleKey: "importFlashcards.warnings.rowsSkippedTooLong", pluralKey: "importFlashcards.warnings.rowsSkippedTooLong" };
    case "rows-skipped-malformed":
      return { titleKey: "importFlashcards.warnings.rowsSkippedMalformed", pluralKey: "importFlashcards.warnings.rowsSkippedMalformed" };
    case "duplicates-found":
      return { titleKey: "importFlashcards.warnings.duplicatesFound", pluralKey: "importFlashcards.warnings.duplicatesFound" };
    case "cards-truncated-at-limit":
      return { titleKey: "importFlashcards.warnings.cardsTruncated", pluralKey: "importFlashcards.warnings.cardsTruncated" };
  }
}

function formatWarning(warning: ImportWarning, t: TFn, plural: (key: any, count: number, params?: any) => string): string {
  const keys = warningCopyKeys(warning.code);
  if (typeof warning.count === "number" && keys.pluralKey) {
    return plural(keys.pluralKey, warning.count, { count: warning.count });
  }
  return t(keys.titleKey);
}

function saveErrorCopyKeys(code: SaveImportErrorCode): { titleKey: string; bodyKey: string } {
  switch (code) {
    case "invalid-draft":
      return { titleKey: "importFlashcards.preview.saveInvalidTitle", bodyKey: "importFlashcards.preview.saveInvalidBody" };
    case "rollback-failed":
      return { titleKey: "importFlashcards.preview.saveRollbackTitle", bodyKey: "importFlashcards.preview.saveRollbackBody" };
    default:
      return { titleKey: "importFlashcards.preview.saveFailedTitle", bodyKey: "importFlashcards.preview.saveFailedBody" };
  }
}

export default function ImportFlashcardsPreviewScreen() {
  const router = useRouter();
  const { t, plural } = useTranslation();
  const { colors, spacing, typography } = useTheme();
  const { row, text } = useLayoutDirection();

  const session = useImportDraftSession();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const savedRef = useRef(false);
  const [scopeOk, setScopeOk] = useState<boolean | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      if (!session) {
        setScopeOk(null);
        return;
      }
      (async () => {
        const active = await AuthService.getActiveScope();
        if (alive) setScopeOk(sameScope(active, session.sourceScope));
      })();
      return () => {
        alive = false;
      };
      // Re-check whenever the draft's bound scope identity changes (new draft set).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session?.sourceScope])
  );

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const discardAndLeave = () => {
    clearImportDraftSession();
    goBack();
  };

  const recovery = (titleKey: string, bodyKey: string) => (
    <Screen scroll>
      <View style={[styles.header, row, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={goBack} />
        <Text style={[typography.title, text, { color: colors.textPrimary }]} accessibilityRole="header">
          {t("importFlashcards.preview.screenTitle")}
        </Text>
      </View>
      <EmptyState icon="alert-circle-outline" title={t(titleKey as any)} description={t(bodyKey as any)}>
        <Button label={t("common.back")} variant="secondary" fullWidth onPress={discardAndLeave} />
      </EmptyState>
    </Screen>
  );

  if (!session) {
    return recovery("importFlashcards.preview.noDraftTitle", "importFlashcards.preview.noDraftBody");
  }
  if (scopeOk === false) {
    return recovery("importFlashcards.preview.scopeChangedTitle", "importFlashcards.preview.scopeChangedBody");
  }

  const onConfirm = async () => {
    if (savingRef.current || savedRef.current) return;
    savingRef.current = true;
    setSaving(true);

    try {
      const scope = await AuthService.getActiveScope();
      if (!sameScope(scope, session.sourceScope)) {
        setScopeOk(false);
        return;
      }

      const outcome = await saveImportedDeck(scope, {
        name: session.deckName,
        cards: session.cards,
        warnings: session.warnings,
      });

      if (outcome.status === "saved") {
        savedRef.current = true;
        clearImportDraftSession();
        Alert.alert(
          t("importFlashcards.preview.importedTitle"),
          plural("importFlashcards.preview.importedBody", outcome.cardCount, { count: outcome.cardCount })
        );
        router.replace({ pathname: "/deck/[id]" as any, params: { id: outcome.deckId } });
        return;
      }

      const { titleKey, bodyKey } = saveErrorCopyKeys(outcome.code);
      Alert.alert(t(titleKey as any), t(bodyKey as any));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const sampleCards = session.cards.slice(0, SAMPLE_CARD_COUNT);
  const canConfirm = !saving && session.cards.length > 0 && session.deckName.trim().length > 0;

  return (
    <Screen scroll>
      <View style={[styles.header, row, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={discardAndLeave} disabled={saving} />
        <Text style={[typography.title, text, { color: colors.textPrimary }]} accessibilityRole="header">
          {t("importFlashcards.preview.screenTitle")}
        </Text>
      </View>

      <TextField
        label={t("importFlashcards.preview.deckNameLabel")}
        value={session.deckName}
        onChangeText={setImportDraftDeckName}
        editable={!saving}
        maxLength={200}
      />

      <Text style={[typography.secondary, text, { color: colors.textSecondary }]}>
        {plural("importFlashcards.preview.cardCount", session.cards.length, { count: session.cards.length })}
      </Text>

      {session.warnings.length > 0 ? (
        <Card style={[styles.warningsCard, { gap: spacing.xs, borderColor: colors.border }]}>
          <Text style={[typography.label, text, { color: colors.textSecondary }]}>
            {t("importFlashcards.preview.warningsHeading")}
          </Text>
          {session.warnings.map((warning, i) => (
            <Text key={`${warning.code}-${i}`} style={[typography.caption, text, { color: colors.textSecondary }]}>
              {formatWarning(warning, t, plural)}
            </Text>
          ))}
        </Card>
      ) : null}

      <Text style={[typography.label, text, { color: colors.textSecondary }]}>
        {t("importFlashcards.preview.sampleHeading")}
      </Text>
      {sampleCards.map((card, i) => (
        <Card key={i} style={[styles.sampleCard, { gap: spacing.xs }]}>
          <Text style={[typography.bodyMedium, text, { color: colors.textPrimary }]} numberOfLines={2}>
            {card.front}
          </Text>
          <Text style={[typography.secondary, text, { color: colors.textSecondary }]} numberOfLines={2}>
            {card.back}
          </Text>
        </Card>
      ))}
      {session.cards.length > SAMPLE_CARD_COUNT ? (
        <Text style={[typography.caption, text, { color: colors.textSecondary }]}>
          {plural("importFlashcards.preview.moreCards", session.cards.length - SAMPLE_CARD_COUNT, {
            count: session.cards.length - SAMPLE_CARD_COUNT,
          })}
        </Text>
      ) : null}

      <Button
        label={plural("importFlashcards.preview.confirmButton", session.cards.length, { count: session.cards.length })}
        variant="primary"
        fullWidth
        loading={saving}
        disabled={!canConfirm}
        onPress={onConfirm}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  warningsCard: { borderWidth: 1 },
  sampleCard: {},
});
