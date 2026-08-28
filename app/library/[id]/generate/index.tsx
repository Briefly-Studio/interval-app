import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../../../src/auth/AuthService";
import { AVAILABILITY_COPY_KEYS, type GenerationAvailabilityState } from "../../../../src/domain/ai/generationAvailability";
import { isGenerateStudyDeckEnabled } from "../../../../src/domain/ai/generateStudyDeckCapability";
import { checkGenerationAvailability, GENERATION_ERROR_COPY_KEYS, runGenerateDeckFlow } from "../../../../src/domain/ai/generateDeckFlow";
import { CARD_COUNT_CHOICES, CARD_STYLE_CHOICES, DIFFICULTY_CHOICES } from "../../../../src/domain/ai/generationOptionsUi";
import { DEFAULT_GENERATION_OPTIONS } from "../../../../src/domain/ai/generationOptions";
import type { CardCountOption, CardStyleOption, DifficultyOption, GenerationErrorCode } from "../../../../src/domain/ai/types";
import { useTranslation } from "../../../../src/i18n";
import { useLayoutDirection } from "../../../../src/i18n/direction";
import type { LibrarySourceRecord } from "../../../../src/models/librarySource";
import { getLibrarySources } from "../../../../src/storage/librarySources";
import { useTheme } from "@/src/theme";
import { Button } from "../../../../src/ui/Button";
import { Card } from "../../../../src/ui/Card";
import { EmptyState } from "../../../../src/ui/EmptyState";
import { IconButton } from "../../../../src/ui/IconButton";
import { OptionRadioGroup } from "../../../../src/ui/OptionRadioGroup";
import { Screen } from "../../../../src/ui/Screen";

type ScreenState =
  | { phase: "loading" }
  | { phase: "unavailable"; state: Exclude<GenerationAvailabilityState, "ready"> }
  | { phase: "options" }
  | { phase: "generating" }
  | { phase: "error"; code: GenerationErrorCode };

export default function GenerateStudyDeckScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, spacing, typography } = useTheme();
  const { row, text } = useLayoutDirection();

  const params = useLocalSearchParams();
  const idParam = params.id;
  const id = typeof idParam === "string" ? idParam : Array.isArray(idParam) ? idParam[0] : "";

  const [source, setSource] = useState<LibrarySourceRecord | null>(null);
  const [screenState, setScreenState] = useState<ScreenState>({ phase: "loading" });

  const [cardCount, setCardCount] = useState<CardCountOption>(
    typeof DEFAULT_GENERATION_OPTIONS.cardCount === "number" ? "medium" : DEFAULT_GENERATION_OPTIONS.cardCount
  );
  const [difficulty, setDifficulty] = useState<DifficultyOption>(DEFAULT_GENERATION_OPTIONS.difficulty);
  const [cardStyle, setCardStyle] = useState<CardStyleOption>(DEFAULT_GENERATION_OPTIONS.cardStyle);

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace({ pathname: "/library/[id]" as any, params: { id } });
  }, [id, router]);

  const checkAvailability = useCallback(async () => {
    if (!id) {
      setScreenState({ phase: "unavailable", state: "failed" });
      return;
    }
    if (!isGenerateStudyDeckEnabled()) {
      setScreenState({ phase: "unavailable", state: "unsupported" });
      return;
    }
    setScreenState({ phase: "loading" });
    const scope = await AuthService.getActiveScope();
    const all = await getLibrarySources(scope);
    const found = all.find((s) => s.id === id) ?? null;
    setSource(found);
    if (!found) {
      setScreenState({ phase: "unavailable", state: "failed" });
      return;
    }
    const availability = await checkGenerationAvailability(found);
    if (availability.canGenerate) {
      setScreenState({ phase: "options" });
    } else {
      setScreenState({ phase: "unavailable", state: availability.state as Exclude<GenerationAvailabilityState, "ready"> });
    }
  }, [id]);

  // Re-run on focus so returning here after e.g. attaching a file re-checks readiness.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        try {
          await checkAvailability();
        } catch {
          if (alive) setScreenState({ phase: "unavailable", state: "failed" });
        }
      })();
      return () => {
        alive = false;
      };
    }, [checkAvailability])
  );

  const onGenerate = async () => {
    if (!source) return;
    setScreenState({ phase: "generating" });
    try {
      // Capture the active workspace/account scope at generation time — it is bound onto the
      // draft session and is the sole scope Save will use (audit CRITICAL-1).
      const scope = await AuthService.getActiveScope();
      const outcome = await runGenerateDeckFlow(source, { cardCount, difficulty, cardStyle }, scope);
      if (outcome.status === "ready") {
        router.replace({ pathname: "/library/[id]/generate/review" as any, params: { id } });
        return;
      }
      if (outcome.status === "unavailable") {
        setScreenState({ phase: "unavailable", state: outcome.state });
        return;
      }
      setScreenState({ phase: "error", code: outcome.code });
    } catch {
      setScreenState({ phase: "error", code: "provider-unavailable" });
    }
  };

  const header = (
    <View style={[styles.header, row, { gap: spacing.sm }]}>
      <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={goBack} />
      <Text style={[typography.title, styles.headerTitle, text, { color: colors.textPrimary }]} numberOfLines={1} accessibilityRole="header">
        {t("generateDeck.screenTitle")}
      </Text>
    </View>
  );

  if (screenState.phase === "loading") {
    return (
      <Screen>
        {header}
        <View style={[styles.centered, { gap: spacing.md }]}>
          <ActivityIndicator color={colors.accent} />
          <Text style={[typography.secondary, text, { color: colors.textSecondary }]}>{t("generateDeck.checkingSource")}</Text>
        </View>
      </Screen>
    );
  }

  if (screenState.phase === "generating") {
    return (
      <Screen>
        {header}
        <View style={[styles.centered, { gap: spacing.md }]} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={[typography.subheading, text, { color: colors.textPrimary }]}>{t("generateDeck.generatingTitle")}</Text>
          <Text style={[typography.secondary, styles.centeredText, { color: colors.textSecondary }]}>
            {t("generateDeck.generatingBody")}
          </Text>
        </View>
      </Screen>
    );
  }

  if (screenState.phase === "unavailable") {
    const copy = AVAILABILITY_COPY_KEYS[screenState.state];
    return (
      <Screen scroll>
        {header}
        <EmptyState icon={copy.icon as any} title={t(copy.titleKey as any)} description={t(copy.bodyKey as any)}>
          {screenState.state === "failed" || screenState.state === "pending-extraction" ? (
            <Button label={t("generateDeck.retryButton")} variant="secondary" fullWidth onPress={checkAvailability} />
          ) : null}
          <Button label={t("generateDeck.backToSourceButton")} variant="ghost" fullWidth onPress={goBack} />
        </EmptyState>
      </Screen>
    );
  }

  if (screenState.phase === "error") {
    return (
      <Screen scroll>
        {header}
        <EmptyState
          icon="alert-circle-outline"
          title={t("generateDeck.error.title")}
          description={t(GENERATION_ERROR_COPY_KEYS[screenState.code] as any)}
        >
          <Button label={t("generateDeck.retryButton")} variant="primary" fullWidth onPress={() => setScreenState({ phase: "options" })} />
          <Button label={t("generateDeck.backToSourceButton")} variant="ghost" fullWidth onPress={goBack} />
        </EmptyState>
      </Screen>
    );
  }

  // phase === "options"
  return (
    <Screen scroll>
      {header}

      <Text style={[typography.secondary, text, { color: colors.textSecondary }]}>
        {t("generateDeck.fromSource", { title: source?.displayTitle ?? "" })}
      </Text>

      <View style={[styles.noticeRow, row, { gap: spacing.sm, borderColor: colors.border, backgroundColor: colors.surfaceMuted, borderRadius: spacing.sm }]}>
        <Text style={[typography.caption, text, { color: colors.textSecondary }]}>{t("generateDeck.devPreviewNotice")}</Text>
      </View>

      <Card style={{ gap: spacing.lg }}>
        <View style={{ gap: spacing.xs }}>
          <Text style={[typography.label, text, { color: colors.textPrimary }]}>{t("generateDeck.options.cardCountLabel")}</Text>
          <OptionRadioGroup
            groupLabel={t("generateDeck.options.cardCountLabel")}
            value={cardCount}
            onChange={setCardCount}
            items={CARD_COUNT_CHOICES.map((c) => ({ value: c.value, label: t(c.labelKey as any), description: t(c.descriptionKey as any) }))}
          />
        </View>

        <View style={{ gap: spacing.xs }}>
          <Text style={[typography.label, text, { color: colors.textPrimary }]}>{t("generateDeck.options.difficultyLabel")}</Text>
          <OptionRadioGroup
            groupLabel={t("generateDeck.options.difficultyLabel")}
            value={difficulty}
            onChange={setDifficulty}
            items={DIFFICULTY_CHOICES.map((c) => ({ value: c.value, label: t(c.labelKey as any), description: t(c.descriptionKey as any) }))}
          />
        </View>

        <View style={{ gap: spacing.xs }}>
          <Text style={[typography.label, text, { color: colors.textPrimary }]}>{t("generateDeck.options.styleLabel")}</Text>
          <OptionRadioGroup
            groupLabel={t("generateDeck.options.styleLabel")}
            value={cardStyle}
            onChange={setCardStyle}
            items={CARD_STYLE_CHOICES.map((c) => ({ value: c.value, label: t(c.labelKey as any), description: t(c.descriptionKey as any) }))}
          />
        </View>
      </Card>

      <Button label={t("generateDeck.generateButton")} variant="primary" fullWidth onPress={onGenerate} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center" },
  headerTitle: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 48 },
  centeredText: { textAlign: "center" },
  noticeRow: { borderWidth: 1, padding: 12 },
});
