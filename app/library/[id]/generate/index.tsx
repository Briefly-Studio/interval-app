import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../../../src/auth/AuthService";
import { buildAiConsentRecord, needsAiConsent } from "../../../../src/domain/ai/aiConsent";
import { AVAILABILITY_COPY_KEYS, type GenerationAvailabilityState } from "../../../../src/domain/ai/generationAvailability";
import { isGenerateStudyDeckEnabled } from "../../../../src/domain/ai/generateStudyDeckCapability";
import {
  checkGenerationAvailability,
  GENERATION_ERROR_COPY_KEYS,
  runGenerateDeckFlow,
  SOURCE_SCOPE_ERROR_COPY_KEYS,
} from "../../../../src/domain/ai/generateDeckFlow";
import { deriveCardCountHintKind, hasTrustworthyChunkScope, type GenerationCoverage } from "../../../../src/domain/ai/generationCoverage";
import { CARD_COUNT_CHOICES, CARD_STYLE_CHOICES, DIFFICULTY_CHOICES } from "../../../../src/domain/ai/generationOptionsUi";
import { DEFAULT_GENERATION_OPTIONS, resolveRequestedCardCount } from "../../../../src/domain/ai/generationOptions";
import { isRealProviderActive } from "../../../../src/domain/ai/providerSelection";
import {
  fitsContextBudget,
  getSectionCount,
  resolveSourceGenerationScope,
  type SourceGenerationScope,
  type SourceGenerationScopeKind,
  type SourceScopeResolutionErrorCode,
} from "../../../../src/domain/ai/sourceGenerationScope";
import { buildSourceScopeChoices, SCOPE_SUMMARY_KEY } from "../../../../src/domain/ai/sourceGenerationScopeUi";
import type { CardCountOption, CardStyleOption, DifficultyOption, GenerationErrorCode } from "../../../../src/domain/ai/types";
import type { NormalizedChunk } from "../../../../src/domain/normalization/types";
import { loadSourceCoverage } from "../../../../src/domain/sourceCoverageService";
import type { SourceCoverage } from "../../../../src/domain/sourceCoverage";
import { useTranslation } from "../../../../src/i18n";
import { useLayoutDirection } from "../../../../src/i18n/direction";
import type { LibrarySourceRecord } from "../../../../src/models/librarySource";
import { getAiConsent, setAiConsent } from "../../../../src/storage/aiConsent";
import { getLibrarySources } from "../../../../src/storage/librarySources";
import { useTheme } from "@/src/theme";
import { showAiConsentDialog } from "../../../../src/ui/aiConsentDialog";
import { Button } from "../../../../src/ui/Button";
import { Card } from "../../../../src/ui/Card";
import { EmptyState } from "../../../../src/ui/EmptyState";
import { IconButton } from "../../../../src/ui/IconButton";
import { OptionRadioGroup } from "../../../../src/ui/OptionRadioGroup";
import { Screen } from "../../../../src/ui/Screen";
import { TextField } from "../../../../src/ui/TextField";

type ScreenState =
  | { phase: "loading" }
  | { phase: "unavailable"; state: Exclude<GenerationAvailabilityState, "ready"> }
  | { phase: "options" }
  | { phase: "generating" }
  | { phase: "error"; code: GenerationErrorCode }
  // Defensive backstop only — the options screen's own inline scope validation (built from the
  // same resolver) should normally prevent Generate from ever being tappable in an invalid
  // state. See generateDeckFlow.ts's GenerateDeckFlowOutcome "scope-error" case.
  | { phase: "scope-error"; code: SourceScopeResolutionErrorCode };

export default function GenerateStudyDeckScreen() {
  const router = useRouter();
  const { t, plural } = useTranslation();
  const { colors, spacing, typography } = useTheme();
  const { row, text } = useLayoutDirection();

  const params = useLocalSearchParams();
  const idParam = params.id;
  const id = typeof idParam === "string" ? idParam : Array.isArray(idParam) ? idParam[0] : "";

  const [source, setSource] = useState<LibrarySourceRecord | null>(null);
  const [screenState, setScreenState] = useState<ScreenState>({ phase: "loading" });
  // Whether the whole source will fit this generation's context budget — computed up front (see
  // checkGenerationAvailability's "coverage" doc comment) so the disclosure below is accurate
  // BEFORE the user ever taps Generate, not just after. null while unknown/unavailable.
  const [coverage, setCoverage] = useState<GenerationCoverage | null>(null);
  // Raw ingredients for source scope selection — see sourceGenerationScope.ts. null while
  // unknown/unavailable, same posture as `coverage` above.
  const [scopeChunks, setScopeChunks] = useState<NormalizedChunk[] | null>(null);
  const [pageCount, setPageCount] = useState<number | undefined>(undefined);
  const [sourceCoverage, setSourceCoverage] = useState<SourceCoverage | null>(null);

  // Source scope selection (Automatic/Entire source/Uncovered/Page range/Section range) — never
  // persisted, defaults to Automatic for every fresh generation session (section 16), same
  // posture as cardCount/difficulty/cardStyle below.
  const [scopeKind, setScopeKind] = useState<SourceGenerationScopeKind>("automatic");
  const [pageRangeStart, setPageRangeStart] = useState("");
  const [pageRangeEnd, setPageRangeEnd] = useState("");
  const [sectionRangeStart, setSectionRangeStart] = useState("");
  const [sectionRangeEnd, setSectionRangeEnd] = useState("");

  const [cardCount, setCardCount] = useState<CardCountOption>(
    typeof DEFAULT_GENERATION_OPTIONS.cardCount === "number" ? "medium" : DEFAULT_GENERATION_OPTIONS.cardCount
  );
  const [difficulty, setDifficulty] = useState<DifficultyOption>(DEFAULT_GENERATION_OPTIONS.difficulty);
  const [cardStyle, setCardStyle] = useState<CardStyleOption>(DEFAULT_GENERATION_OPTIONS.cardStyle);

  // Derived scope state — cheap, pure, recomputed every render from already-loaded data. Shared
  // between the render body (live validation/summary) and startGeneration (the actual request),
  // so both always agree on exactly the same resolution for the current selection.
  const totalSectionCount = getSectionCount(scopeChunks ?? []);
  const hasUncoveredMaterial = (sourceCoverage?.uncoveredChunkCount ?? 0) > 0;
  const entireSourceFits = fitsContextBudget(scopeChunks ?? []);
  const scopeChoices = buildSourceScopeChoices({ totalSectionCount, pageCount, hasUncoveredMaterial, entireSourceFits });

  function parseRangeInput(raw: string): number {
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) return NaN;
    return Number(trimmed);
  }

  const selectedScope: SourceGenerationScope =
    scopeKind === "pageRange"
      ? { type: "pageRange", startPage: parseRangeInput(pageRangeStart), endPage: parseRangeInput(pageRangeEnd) }
      : scopeKind === "sectionRange"
        ? { type: "sectionRange", startSection: parseRangeInput(sectionRangeStart), endSection: parseRangeInput(sectionRangeEnd) }
        : { type: scopeKind };

  const scopeResolution = scopeChunks
    ? resolveSourceGenerationScope({ chunks: scopeChunks, scope: selectedScope, coverage: sourceCoverage ?? undefined, pageCount })
    : null;
  const scopeIsValid = scopeResolution?.status === "ok";

  // True only for a RESTRICTIVE scope (uncovered/page/section range) whose own candidate chunks
  // still exceed one generation's context budget — Automatic/Entire source are deliberately never
  // flagged here: Automatic's existing partial-source banner below already covers that case, and
  // a successfully-resolved Entire source can never exceed budget by construction (see
  // sourceGenerationScope.ts's own fitsContextBudget check inside the "entireSource" branch).
  const scopeExceedsContext = (() => {
    if (!scopeChunks || scopeResolution?.status !== "ok" || !scopeResolution.chunkIds) return false;
    const candidateIds = new Set(scopeResolution.chunkIds);
    const candidateChunks = scopeChunks.filter((chunk) => candidateIds.has(chunk.id));
    return !fitsContextBudget(candidateChunks);
  })();

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
    // loadSourceCoverage is independent of availability.canGenerate — Source Coverage's own
    // normalization is never trusted to agree, so it's loaded unconditionally alongside, never
    // sequenced behind it (see sourceCoverageService.ts's own "never throws for no-content"
    // contract — a non-ready source just yields a zero-valued coverage, harmlessly).
    const [availability, coverageResult] = await Promise.all([
      checkGenerationAvailability(found),
      loadSourceCoverage(scope, found),
    ]);
    setCoverage(availability.coverage);
    setScopeChunks(availability.scopeChunks);
    setPageCount(availability.pageCount);
    setSourceCoverage(coverageResult);
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

  const startGeneration = async () => {
    if (!source) return;
    setScreenState({ phase: "generating" });
    try {
      // Capture the active workspace/account scope at generation time — it is bound onto the
      // draft session and is the sole scope Save will use (audit CRITICAL-1).
      const scope = await AuthService.getActiveScope();
      const outcome = await runGenerateDeckFlow(source, { cardCount, difficulty, cardStyle }, scope, selectedScope);
      if (outcome.status === "ready") {
        router.replace({ pathname: "/library/[id]/generate/review" as any, params: { id } });
        return;
      }
      if (outcome.status === "unavailable") {
        setScreenState({ phase: "unavailable", state: outcome.state });
        return;
      }
      if (outcome.status === "scope-error") {
        setScreenState({ phase: "scope-error", code: outcome.code });
        return;
      }
      setScreenState({ phase: "error", code: outcome.code });
    } catch {
      setScreenState({ phase: "error", code: "provider-unavailable" });
    }
  };

  // First-use AI consent gate — only ever relevant when this attempt would actually reach the
  // real backend provider (isRealProviderActive() mirrors providerSelection.ts's own mock/real
  // decision exactly, so this tracks it automatically if Staging/Production are ever flipped to
  // real AI later). Mock generation (Staging/Production today) never shows this. Cancel is
  // passive — no callback at all — so nothing here runs; the user simply stays on this screen
  // with no generation started, no quota consumed, no backend request made.
  const onGenerate = async () => {
    if (!source) return;

    if (isRealProviderActive()) {
      const scope = await AuthService.getActiveScope();
      const consent = await getAiConsent(scope);
      if (needsAiConsent(true, consent)) {
        showAiConsentDialog({
          t,
          onContinue: async () => {
            await setAiConsent(scope, buildAiConsentRecord(new Date()));
            await startGeneration();
          },
        });
        return;
      }
    }

    await startGeneration();
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

  if (screenState.phase === "scope-error") {
    return (
      <Screen scroll>
        {header}
        <EmptyState
          icon="alert-circle-outline"
          title={t("generateDeck.error.title")}
          description={t(SOURCE_SCOPE_ERROR_COPY_KEYS[screenState.code] as any)}
        >
          <Button label={t("generateDeck.retryButton")} variant="primary" fullWidth onPress={() => setScreenState({ phase: "options" })} />
          <Button label={t("generateDeck.backToSourceButton")} variant="ghost" fullWidth onPress={goBack} />
        </EmptyState>
      </Screen>
    );
  }

  // phase === "options"
  const sourceWillBePartial = coverage !== null && !coverage.fullSourceIncluded;
  const trustworthyScope = coverage !== null && hasTrustworthyChunkScope(coverage);
  const cardCountHintKind = deriveCardCountHintKind(coverage?.fullSourceIncluded ?? true);
  const resolvedCardCount = resolveRequestedCardCount(cardCount);

  return (
    <Screen scroll>
      {header}

      <Text style={[typography.secondary, text, { color: colors.textSecondary }]}>
        {t("generateDeck.fromSource", { title: source?.displayTitle ?? "" })}
      </Text>

      <View style={[styles.noticeRow, row, { gap: spacing.sm, borderColor: colors.border, backgroundColor: colors.surfaceMuted, borderRadius: spacing.sm }]}>
        <Text style={[typography.caption, text, { color: colors.textSecondary }]}>{t("generateDeck.devPreviewNotice")}</Text>
      </View>

      {sourceWillBePartial ? (
        <View
          style={[styles.noticeRow, { gap: spacing.xs, borderColor: colors.warning, backgroundColor: colors.warningSurface, borderRadius: spacing.sm }]}
          accessibilityRole="text"
        >
          <View style={[styles.noticeTitleRow, row, { gap: spacing.sm }]}>
            <Ionicons name="information-circle-outline" size={20} color={colors.warning} />
            <Text style={[typography.label, text, styles.noticeTitleText, { color: colors.warning }]}>
              {t("generateDeck.coverage.setupPartialTitle")}
            </Text>
          </View>
          <Text style={[typography.caption, text, { color: colors.textSecondary }]}>{t("generateDeck.coverage.setupPartialBody")}</Text>
          {trustworthyScope && coverage ? (
            <Text style={[typography.caption, text, { color: colors.textSecondary }]}>
              {t("generateDeck.coverage.scopeSummary", { included: coverage.includedChunkCount, total: coverage.totalChunkCount })}
            </Text>
          ) : null}
        </View>
      ) : null}

      <Card style={{ gap: spacing.lg }}>
        <View style={{ gap: spacing.xs }}>
          <Text style={[typography.label, text, { color: colors.textPrimary }]}>{t("generateDeck.scope.label")}</Text>
          <OptionRadioGroup
            groupLabel={t("generateDeck.scope.label")}
            value={scopeKind}
            onChange={setScopeKind}
            items={scopeChoices.map((c) => ({ value: c.value, label: t(c.labelKey as any), description: t(c.descriptionKey as any) }))}
          />

          {scopeKind === "pageRange" ? (
            <View style={{ gap: spacing.xs }}>
              {typeof pageCount === "number" ? (
                <Text style={[typography.caption, text, { color: colors.textSecondary }]}>
                  {plural("generateDeck.scope.pageRangeTotal", pageCount, { count: pageCount })}
                </Text>
              ) : null}
              <View style={[row, { gap: spacing.sm }]}>
                <View style={{ flex: 1 }}>
                  <TextField
                    label={t("generateDeck.scope.rangeFromLabel")}
                    value={pageRangeStart}
                    onChangeText={setPageRangeStart}
                    keyboardType="number-pad"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <TextField
                    label={t("generateDeck.scope.rangeToLabel")}
                    value={pageRangeEnd}
                    onChangeText={setPageRangeEnd}
                    keyboardType="number-pad"
                  />
                </View>
              </View>
            </View>
          ) : null}

          {scopeKind === "sectionRange" ? (
            <View style={{ gap: spacing.xs }}>
              <Text style={[typography.caption, text, { color: colors.textSecondary }]}>
                {plural("generateDeck.scope.sectionRangeTotal", totalSectionCount, { count: totalSectionCount })}
              </Text>
              <View style={[row, { gap: spacing.sm }]}>
                <View style={{ flex: 1 }}>
                  <TextField
                    label={t("generateDeck.scope.rangeFromLabel")}
                    value={sectionRangeStart}
                    onChangeText={setSectionRangeStart}
                    keyboardType="number-pad"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <TextField
                    label={t("generateDeck.scope.rangeToLabel")}
                    value={sectionRangeEnd}
                    onChangeText={setSectionRangeEnd}
                    keyboardType="number-pad"
                  />
                </View>
              </View>
            </View>
          ) : null}

          {scopeResolution?.status === "error" ? (
            <Text style={[typography.caption, text, { color: colors.danger }]} accessibilityRole="text">
              {t(SOURCE_SCOPE_ERROR_COPY_KEYS[scopeResolution.code] as any)}
            </Text>
          ) : (
            <Text style={[typography.caption, text, { color: colors.textSecondary }]}>
              {selectedScope.type === "pageRange"
                ? t("generateDeck.scope.summaryPageRange", { start: selectedScope.startPage, end: selectedScope.endPage })
                : selectedScope.type === "sectionRange"
                  ? t("generateDeck.scope.summarySectionRange", { start: selectedScope.startSection, end: selectedScope.endSection })
                  : t(SCOPE_SUMMARY_KEY[selectedScope.type] as any)}
            </Text>
          )}

          {scopeExceedsContext ? (
            <Text style={[typography.caption, text, { color: colors.warning }]} accessibilityRole="text">
              {t("generateDeck.scope.partialContextNote")}
            </Text>
          ) : null}
        </View>

        <View style={{ gap: spacing.xs }}>
          <Text style={[typography.label, text, { color: colors.textPrimary }]}>{t("generateDeck.options.cardCountLabel")}</Text>
          <OptionRadioGroup
            groupLabel={t("generateDeck.options.cardCountLabel")}
            value={cardCount}
            onChange={setCardCount}
            items={CARD_COUNT_CHOICES.map((c) => ({ value: c.value, label: t(c.labelKey as any), description: t(c.descriptionKey as any) }))}
          />
          <Text style={[typography.caption, text, { color: colors.textSecondary }]}>
            {cardCountHintKind === "partial"
              ? t("generateDeck.coverage.cardCountHintPartial", { count: resolvedCardCount })
              : t("generateDeck.coverage.cardCountHintFull")}
          </Text>
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

      <Button label={t("generateDeck.generateButton")} variant="primary" fullWidth disabled={!scopeIsValid} onPress={onGenerate} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center" },
  headerTitle: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 48 },
  centeredText: { textAlign: "center" },
  noticeRow: { borderWidth: 1, padding: 12 },
  noticeTitleRow: { alignItems: "center" },
  noticeTitleText: { flex: 1 },
});
