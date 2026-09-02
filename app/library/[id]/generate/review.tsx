import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../../../src/auth/AuthService";
import { resolveProvenanceLabel, type ProvenanceLabel } from "../../../../src/domain/ai/draftCardEditing";
import {
  clearGenerateDeckSession,
  deleteDraftCard,
  setDraftDeckTitle,
  useGenerateDeckSession,
} from "../../../../src/domain/ai/generateDeckSession";
import { saveDraftDeck, type SaveDraftErrorCode } from "../../../../src/domain/ai/generateDeckSave";
import { useTranslation } from "../../../../src/i18n";
import { contentDirectionStyle } from "../../../../src/i18n/contentDirection";
import { useLayoutDirection } from "../../../../src/i18n/direction";
import { sameScope } from "../../../../src/storage/workspaceScope";
import { useTheme } from "@/src/theme";
import { Button } from "../../../../src/ui/Button";
import { Card } from "../../../../src/ui/Card";
import { EmptyState } from "../../../../src/ui/EmptyState";
import { IconButton } from "../../../../src/ui/IconButton";
import { Screen } from "../../../../src/ui/Screen";
import { TextField } from "../../../../src/ui/TextField";

type TFn = (key: any, params?: any) => string;

function formatRanges(ranges: { start: number; end: number }[]): string {
  return ranges.map((r) => (r.start === r.end ? `${r.start}` : `${r.start}–${r.end}`)).join(", ");
}

// Honest provenance text: discontiguous ranges/pages are listed, never collapsed into one span
// (audit MEDIUM-1).
function provenanceText(label: ProvenanceLabel, t: TFn): string | null {
  if (label.kind === "lines") {
    const single = label.ranges.length === 1 && label.ranges[0].start === label.ranges[0].end;
    return single
      ? t("generateDeck.review.provenanceLine", { line: label.ranges[0].start })
      : t("generateDeck.review.provenanceLines", { ranges: formatRanges(label.ranges) });
  }
  if (label.kind === "pages") {
    return label.pages.length === 1
      ? t("generateDeck.review.provenancePage", { page: label.pages[0] })
      : t("generateDeck.review.provenancePages", { pages: label.pages.join(", ") });
  }
  return null;
}

function saveErrorCopyKeys(code: SaveDraftErrorCode): { titleKey: string; bodyKey: string } {
  switch (code) {
    case "invalid-draft":
      return { titleKey: "generateDeck.review.saveInvalidTitle", bodyKey: "generateDeck.review.saveInvalidBody" };
    case "rollback-failed":
      return { titleKey: "generateDeck.review.saveRollbackTitle", bodyKey: "generateDeck.review.saveRollbackBody" };
    default:
      return { titleKey: "generateDeck.review.saveFailedTitle", bodyKey: "generateDeck.review.saveFailedBody" };
  }
}

export default function GenerateDeckReviewScreen() {
  const router = useRouter();
  const { t, plural } = useTranslation();
  const { colors, spacing, typography } = useTheme();
  const { row, text } = useLayoutDirection();

  const params = useLocalSearchParams();
  const idParam = params.id;
  const id = typeof idParam === "string" ? idParam : Array.isArray(idParam) ? idParam[0] : "";

  const session = useGenerateDeckSession();
  const [titleDraft, setTitleDraft] = useState(session?.deckTitle ?? "");
  const [titleTouched, setTitleTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  // Synchronous guard — set BEFORE any await so a second rapid Save tap is rejected immediately,
  // not after an async state update has had time to re-render the disabled button (audit
  // CRITICAL-2).
  const savingRef = useRef(false);
  const savedRef = useRef(false);
  // null = not yet checked; true/false = active scope matches the draft's bound scope.
  const [scopeOk, setScopeOk] = useState<boolean | null>(null);

  useEffect(() => {
    if (session && !titleTouched) setTitleDraft(session.deckTitle);
  }, [session, titleTouched]);

  // Re-verify on focus that the active workspace/account still matches the scope the draft was
  // generated in (audit CRITICAL-1). A mismatch blocks save and shows a recovery state.
  const draftScope = session?.sourceScope ?? null;
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      if (!draftScope) {
        setScopeOk(null);
        return;
      }
      (async () => {
        const active = await AuthService.getActiveScope();
        if (alive) setScopeOk(sameScope(active, draftScope));
      })();
      return () => {
        alive = false;
      };
    }, [draftScope])
  );

  const goToSource = () => {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: "/library/[id]" as any, params: { id } });
  };

  const discardAndLeave = () => {
    clearGenerateDeckSession();
    goToSource();
  };

  const confirmDiscard = () => {
    if (savedRef.current) return;
    if (!session || !session.edited) {
      discardAndLeave();
      return;
    }
    Alert.alert(t("generateDeck.review.discardTitle"), t("generateDeck.review.discardBody"), [
      { text: t("generateDeck.review.keepEditingButton"), style: "cancel" },
      { text: t("generateDeck.review.discardConfirmButton"), style: "destructive", onPress: discardAndLeave },
    ]);
  };

  const recovery = (titleKey: string, bodyKey: string, children: ReactNode) => (
    <Screen scroll>
      <View style={[styles.header, row, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={goToSource} />
        <Text style={[typography.title, styles.headerTitle, text, { color: colors.textPrimary }]} accessibilityRole="header">
          {t("generateDeck.review.screenTitle")}
        </Text>
      </View>
      <EmptyState icon="alert-circle-outline" title={t(titleKey as any)} description={t(bodyKey as any)}>
        {children}
      </EmptyState>
    </Screen>
  );

  // No active draft (app resumed onto this route, or a stale deep link).
  if (!session) {
    return recovery("generateDeck.review.noDraftTitle", "generateDeck.review.noDraft", [
      <Button key="back" label={t("generateDeck.backToSourceButton")} variant="secondary" fullWidth onPress={goToSource} />,
    ]);
  }

  // The route's source id doesn't match the draft in memory (audit HIGH-2) — never render or save
  // the wrong draft. Offer to jump to the draft's real source, or discard.
  if (session.sourceId !== id) {
    return recovery("generateDeck.review.wrongSourceTitle", "generateDeck.review.wrongSourceBody", [
      <Button
        key="go"
        label={t("generateDeck.review.openDraftSourceButton")}
        variant="primary"
        fullWidth
        onPress={() => router.replace({ pathname: "/library/[id]/generate/review" as any, params: { id: session.sourceId } })}
      />,
      <Button
        key="discard"
        label={t("generateDeck.review.discardButton")}
        variant="ghost"
        fullWidth
        onPress={discardAndLeave}
      />,
    ]);
  }

  // Active workspace/account changed since generation (audit CRITICAL-1).
  if (scopeOk === false) {
    return recovery("generateDeck.review.scopeChangedTitle", "generateDeck.review.scopeChangedBody", [
      <Button
        key="discard"
        label={t("generateDeck.review.discardButton")}
        variant="secondary"
        fullWidth
        onPress={discardAndLeave}
      />,
      <Button key="back" label={t("generateDeck.backToSourceButton")} variant="ghost" fullWidth onPress={goToSource} />,
    ]);
  }

  const commitTitle = () => {
    setTitleTouched(true);
    setDraftDeckTitle(titleDraft.trim());
  };

  const titleInvalid = titleTouched && titleDraft.trim().length === 0;
  const cardCount = session.cards.length;
  const canSave = !saving && scopeOk === true && titleDraft.trim().length > 0 && cardCount > 0;

  const onSave = async () => {
    // Synchronous reentrancy guard first — before any state read or await.
    if (savingRef.current || savedRef.current) return;
    if (!canSave) return;
    savingRef.current = true;
    setSaving(true);
    try {
      setDraftDeckTitle(titleDraft.trim());

      // Final scope confirmation immediately before persistence; Save always uses the
      // session-bound scope as the source of truth, never a freshly-resolved one.
      const active = await AuthService.getActiveScope();
      if (!sameScope(active, session.sourceScope)) {
        setScopeOk(false);
        savingRef.current = false;
        setSaving(false);
        return;
      }

      const outcome = await saveDraftDeck(session.sourceScope, { ...session, deckTitle: titleDraft.trim() });
      if (outcome.status === "saved") {
        savedRef.current = true;
        clearGenerateDeckSession();
        router.replace({ pathname: "/deck/[id]" as any, params: { id: outcome.deckId } });
        return;
      }

      // Every non-"saved" outcome preserves the draft in memory; show the reason and let the user
      // fix/retry.
      const { titleKey, bodyKey } = saveErrorCopyKeys(outcome.code);
      Alert.alert(t(titleKey as any), t(bodyKey as any));
      savingRef.current = false;
      setSaving(false);
    } catch (error) {
      console.error("[generate-deck] save failed:", error);
      Alert.alert(t("generateDeck.review.saveFailedTitle"), t("generateDeck.review.saveFailedBody"));
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Screen scroll>
      <View style={[styles.header, row, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={confirmDiscard} disabled={saving} />
        <Text style={[typography.title, styles.headerTitle, text, { color: colors.textPrimary }]} accessibilityRole="header">
          {t("generateDeck.review.screenTitle")}
        </Text>
      </View>

      <View style={[styles.noticeRow, { borderColor: colors.border, backgroundColor: colors.surfaceMuted, borderRadius: spacing.sm }]}>
        <Text style={[typography.caption, text, { color: colors.textSecondary }]}>{t("generateDeck.review.draftNotice")}</Text>
      </View>

      <Card style={{ gap: spacing.sm }}>
        <TextField
          label={t("generateDeck.review.titleLabel")}
          value={titleDraft}
          onChangeText={(v) => {
            setTitleDraft(v);
            setTitleTouched(true);
          }}
          onBlur={commitTitle}
          error={titleInvalid ? t("generateDeck.review.titleRequiredError") : undefined}
          editable={!saving}
        />
        <Text style={[typography.caption, text, { color: colors.textSecondary }]}>
          {plural("generateDeck.review.cardCount", cardCount, { count: cardCount })} ·{" "}
          {t("generateDeck.review.fromSource", { title: session.sourceTitle })}
        </Text>
        {!session.fullSourceIncluded ? (
          <Text style={[typography.caption, text, { color: colors.textSecondary }]}>
            {t("generateDeck.review.partialSourceNote")}
          </Text>
        ) : null}
      </Card>

      {cardCount === 0 ? (
        <Text style={[typography.secondary, text, { color: colors.textSecondary }]}>{t("generateDeck.review.noCardsBody")}</Text>
      ) : (
        <Text style={[typography.label, text, { color: colors.textPrimary }]}>{t("generateDeck.review.cardsHeading")}</Text>
      )}

      {session.cards.map((item) => {
        const label = provenanceText(resolveProvenanceLabel(item.sourceChunkIds, session.provenanceByChunkId), t);
        return (
          <Card key={item.id} style={{ gap: spacing.xs }}>
            {/* Card CONTENT follows its own natural direction, not the UI locale's (audit MEDIUM-2). */}
            <Text style={[typography.bodyMedium, contentDirectionStyle(item.front), { color: colors.textPrimary }]}>{item.front}</Text>
            <Text style={[typography.secondary, contentDirectionStyle(item.back), { color: colors.textSecondary }]}>{item.back}</Text>
            {label ? <Text style={[typography.caption, text, { color: colors.textMuted }]}>{label}</Text> : null}
            <View style={[styles.cardActions, row, { gap: spacing.sm, marginTop: spacing.xs }]}>
              <Button
                label={t("generateDeck.review.editCardButton")}
                variant="secondary"
                size="sm"
                onPress={() =>
                  router.push({ pathname: "/library/[id]/generate/edit-card" as any, params: { id, cardId: item.id } })
                }
              />
              <Button
                label={t("generateDeck.review.deleteCardButton")}
                variant="ghost"
                size="sm"
                accessibilityLabel={t("generateDeck.review.deleteCardLabel", { front: item.front })}
                onPress={() => deleteDraftCard(item.id)}
              />
            </View>
          </Card>
        );
      })}

      <View style={{ gap: spacing.sm, paddingTop: spacing.lg }}>
        <Button
          label={t("generateDeck.review.saveButton")}
          variant="primary"
          fullWidth
          loading={saving}
          disabled={!canSave}
          onPress={onSave}
        />
        {cardCount === 0 ? (
          <Text style={[typography.caption, styles.centeredText, { color: colors.textSecondary }]}>
            {t("generateDeck.review.saveDisabledNoCards")}
          </Text>
        ) : null}
        <Button label={t("generateDeck.review.discardButton")} variant="ghost" fullWidth disabled={saving} onPress={confirmDiscard} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center" },
  headerTitle: { flex: 1 },
  noticeRow: { borderWidth: 1, padding: 12 },
  cardActions: { alignItems: "center" },
  centeredText: { textAlign: "center" },
});
