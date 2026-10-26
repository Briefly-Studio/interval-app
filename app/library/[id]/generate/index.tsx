import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, AppState, BackHandler, Platform, StyleSheet, Text, View } from "react-native";

import { onWorkspaceChanged } from "../../../../src/auth/authSignal";
import { sameScope, type WorkspaceScope } from "../../../../src/storage/workspaceScope";
import { generationRunGuard, type GenerationRun } from "../../../../src/domain/ai/generationRunGuard";
import { approveGenerationPlan, generationProgressCopy, multiBatchFailureCopy, plannedDailyRequests, planTooLargeCopy, summarizeGenerationPlan, type GenerationPlanSummary } from "../../../../src/domain/ai/generationPresentation";
import { confirmGenerationPlan } from "../../../../src/ui/generationPlanDialog";
import { AuthService } from "../../../../src/auth/AuthService";
import { buildAiConsentRecord, needsAiConsent } from "../../../../src/domain/ai/aiConsent";
import { AVAILABILITY_COPY_KEYS, type GenerationAvailabilityState } from "../../../../src/domain/ai/generationAvailability";
import { isGenerateStudyDeckEnabled } from "../../../../src/domain/ai/generateStudyDeckCapability";
import {
  BATCH_PLAN_ERROR_COPY_KEYS,
  checkGenerationAvailability,
  GENERATION_ERROR_COPY_KEYS,
  runGenerateDeckFlow,
  SOURCE_SCOPE_ERROR_COPY_KEYS,
} from "../../../../src/domain/ai/generateDeckFlow";
import { deriveCardCountHintKind, hasTrustworthyChunkScope, type GenerationCoverage } from "../../../../src/domain/ai/generationCoverage";
import { CARD_COUNT_CHOICES, CARD_STYLE_CHOICES, DIFFICULTY_CHOICES } from "../../../../src/domain/ai/generationOptionsUi";
import { DEFAULT_GENERATION_OPTIONS, resolveRequestedCardCount } from "../../../../src/domain/ai/generationOptions";
import { canPlanBatchesFor, planGenerationBatches, type BatchPlan, type BatchPlanErrorCode } from "../../../../src/domain/ai/batchPlanning";
import type { MultiBatchProgress } from "../../../../src/domain/ai/multiBatchGeneration";
import { isRealProviderActive } from "../../../../src/domain/ai/providerSelection";
import {
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
  // `progress` is present while preparing/running a multi-step plan. The fast single-call path
  // (Automatic, or any scope that fits one step) retains its ordinary generic loading UI.
  | { phase: "generating"; progress?: MultiBatchProgress }
  | { phase: "error"; code: GenerationErrorCode; multiBatch?: { completed: number; total: number } }
  | { phase: "canceled" }
  // Defensive backstop only — the options screen's own inline scope validation (built from the
  // same resolver) should normally prevent Generate from ever being tappable in an invalid
  // state. See generateDeckFlow.ts's GenerateDeckFlowOutcome "scope-error" case.
  | { phase: "scope-error"; code: SourceScopeResolutionErrorCode }
  // Same defensive posture, for a batch-plan failure (see batchPlanning.ts).
  | { phase: "plan-error"; code: BatchPlanErrorCode };

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

  const runRef = useRef<GenerationRun | null>(null);
  const focusedRef = useRef(false);
  const availabilityIdRef = useRef(0);
  const sourceScopeRef = useRef<WorkspaceScope | null>(null);
  const runPlanRef = useRef<GenerationPlanSummary | null>(null);
  const announcementRef = useRef("");
  const [cancelRequested, setCancelRequested] = useState(false);

  // Derived scope state — cheap, pure, recomputed every render from already-loaded data. Shared
  // between the render body (live validation/summary) and startGeneration (the actual request),
  // so both always agree on exactly the same resolution for the current selection.
  const totalSectionCount = getSectionCount(scopeChunks ?? []);
  const hasUncoveredMaterial = (sourceCoverage?.uncoveredChunkCount ?? 0) > 0;
  // "Entire source" is now offered whenever the full source can be PLANNED at all (one request
  // or several sequential batches — see batchPlanning.ts) — no longer gated to "fits one request".
  const entireSourceAvailable = canPlanBatchesFor(scopeChunks ?? []);
  const scopeChoices = buildSourceScopeChoices({ totalSectionCount, pageCount, hasUncoveredMaterial, entireSourceAvailable });

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

  // Automatic never batches (see generateDeckFlow.ts) — a dry-run batch plan is only meaningful,
  // and only computed, for the other four scopes, exactly mirroring what runGenerateDeckFlow will
  // actually do at generation time. This is the SAME resolveSourceGenerationScope +
  // planGenerationBatches pair the real request uses, so the Generate button's disabled state and
  // the pre-flight disclosure below can never disagree with what actually happens on tap.
  const batchPlan: BatchPlan | null =
    scopeChunks && scopeKind !== "automatic" && scopeResolution?.status === "ok"
      ? planGenerationBatches(
          scopeResolution.chunkIds === undefined
            ? scopeChunks
            : scopeChunks.filter((chunk) => scopeResolution.chunkIds!.includes(chunk.id))
        )
      : null;

  const scopeIsValid = scopeResolution?.status === "ok" && (!batchPlan || batchPlan.status === "ok");

  const goBack = useCallback(() => {
    runRef.current?.cancel();
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace({ pathname: "/library/[id]" as any, params: { id } });
  }, [id, router]);

  const checkAvailability = useCallback(async () => {
    const requestId = ++availabilityIdRef.current;
    if (!id) {
      setScreenState({ phase: "unavailable", state: "failed" });
      return;
    }
    if (!isGenerateStudyDeckEnabled()) {
      setScreenState({ phase: "unavailable", state: "unsupported" });
      return;
    }
    try {
      setScreenState({ phase: "loading" });
      const scope = await AuthService.getActiveScope();
      const all = await getLibrarySources(scope);
      if (!focusedRef.current || availabilityIdRef.current !== requestId) return;
      sourceScopeRef.current = scope;
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
      if (!focusedRef.current || availabilityIdRef.current !== requestId) return;
      setCoverage(availability.coverage);
      setScopeChunks(availability.scopeChunks);
      setPageCount(availability.pageCount);
      setSourceCoverage(coverageResult);
      if (availability.canGenerate) {
        setScreenState({ phase: "options" });
      } else {
        setScreenState({ phase: "unavailable", state: availability.state as Exclude<GenerationAvailabilityState, "ready"> });
      }
    } catch {
      if (focusedRef.current && availabilityIdRef.current === requestId) setScreenState({ phase: "unavailable", state: "failed" });
    }
  }, [id]);

  // Re-run on focus so returning here after e.g. attaching a file re-checks readiness.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      focusedRef.current = true;
      (async () => {
        try {
          if (!runRef.current) await checkAvailability();
        } catch {
          if (alive) setScreenState({ phase: "unavailable", state: "failed" });
        }
      })();
      return () => {
        alive = false;
        focusedRef.current = false;
        availabilityIdRef.current++;
        runRef.current?.cancel();
      };
    }, [checkAvailability])
  );

  function scopeLabel(): string {
    return selectedScope.type === "pageRange"
      ? t("generateDeck.scope.summaryPageRange", { start: selectedScope.startPage, end: selectedScope.endPage })
      : selectedScope.type === "sectionRange"
        ? t("generateDeck.scope.summarySectionRange", { start: selectedScope.startSection, end: selectedScope.endSection })
        : t(SCOPE_SUMMARY_KEY[selectedScope.type] as any);
  }

  function planLines(plan: GenerationPlanSummary): string[] {
    const tier = CARD_COUNT_CHOICES.find((choice) => choice.value === cardCount)!;
    return [scopeLabel(), plural("generateDeck.multi.sections", plan.sectionCount),
      ...(plan.pagesWithText ? [plural("generateDeck.multi.pages", plan.pagesWithText)] : []),
      plural("generateDeck.multi.steps", plan.stepCount),
      `${t(tier.labelKey as any)} · ${t(tier.descriptionKey as any)}`,
      ...(plannedDailyRequests(plan, isRealProviderActive()) !== null ? [plural("generateDeck.multi.quota", plan.stepCount)] : []),
    ];
  }

  const requestCancel = useCallback(() => {
    if (!runRef.current || runRef.current.isCanceled()) return;
    runRef.current.cancel();
    setCancelRequested(true);
  }, []);

  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!runRef.current) return false;
      goBack();
      return true;
    });
    const background = AppState.addEventListener("change", (state) => {
      if (state === "background" && (runPlanRef.current?.stepCount ?? 1) > 1) requestCancel();
    });
    const unsubscribe = onWorkspaceChanged(() => { runRef.current?.cancel(); });
    return () => { back.remove(); background.remove(); unsubscribe(); };
  }, [goBack, requestCancel]);

  const progressCopy = screenState.phase === "generating" ? generationProgressCopy(screenState.progress, cancelRequested) : null;
  const progressText = progressCopy ? t(progressCopy.key, progressCopy.params) : "";
  useEffect(() => {
    // Android uses the text's polite live region; iOS gets one announcement per changed status.
    if (screenState.phase !== "generating" || !screenState.progress || announcementRef.current === progressText) return;
    announcementRef.current = progressText;
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(progressText);
  }, [progressText, screenState]);

  const onGenerate = async () => {
    if (!source || !scopeIsValid || runRef.current) return;
    const run = generationRunGuard.start();
    if (!run) { setScreenState({ phase: "error", code: "generation-in-progress" }); return; }
    runRef.current = run;
    availabilityIdRef.current++;
    runPlanRef.current = batchPlan?.status === "ok" ? summarizeGenerationPlan(scopeChunks ?? [], batchPlan) : null;
    setCancelRequested(false);
    announcementRef.current = "";
    setScreenState({ phase: "generating", ...(runPlanRef.current && runPlanRef.current.stepCount > 1 ? { progress: { phase: "preparing" as const } } : {}) });
    let approved = false;
    try {
      const scope = await AuthService.getActiveScope();
      if (run.isCanceled() || !sourceScopeRef.current || !sameScope(scope, sourceScopeRef.current)) {
        if (focusedRef.current) setScreenState({ phase: "unavailable", state: "failed" });
        return;
      }
      const outcome = await runGenerateDeckFlow(source, { cardCount, difficulty, cardStyle }, scope, selectedScope, {
        isCanceled: () => run.isCanceled() || !focusedRef.current,
        onPlanReady: async (plan) => {
          runPlanRef.current = plan;
          if (!run.isCanceled()) setScreenState({ phase: "generating", ...(plan.stepCount > 1 ? { progress: { phase: "preparing" as const } } : {}) });
          const realProvider = isRealProviderActive();
          const consent = realProvider ? await getAiConsent(scope) : null;
          const allowed = await approveGenerationPlan({
            needsConsent: needsAiConsent(realProvider, consent), stepCount: plan.stepCount,
            isCanceled: () => run.isCanceled() || !focusedRef.current,
            consent: async () => {
              const accepted = await new Promise<boolean>((resolve) => showAiConsentDialog({ t,
                onContinue: () => resolve(true), onCancel: () => resolve(false) }));
              if (!accepted || run.isCanceled()) return false;
              await setAiConsent(scope, buildAiConsentRecord(new Date()));
              return true;
            },
            confirm: () => confirmGenerationPlan(t, planLines(plan).join("\n")),
          });
          approved = allowed && sameScope(scope, await AuthService.getActiveScope()) && !run.isCanceled();
          return approved;
        },
        onProgress: (progress) => {
          if (focusedRef.current && !run.isCanceled()) setScreenState({ phase: "generating", progress });
        },
      });
      if (!focusedRef.current) return;
      if (run.isCanceled() || outcome.status === "canceled") {
        setScreenState({ phase: approved ? "canceled" : "options" });
      } else if (outcome.status === "ready") {
        router.replace({ pathname: "/library/[id]/generate/review" as any, params: { id } });
      } else if (outcome.status === "unavailable") {
        setScreenState({ phase: "unavailable", state: outcome.state });
      } else if (outcome.status === "scope-error") {
        setScreenState({ phase: "scope-error", code: outcome.code });
      } else if (outcome.status === "plan-error") {
        setScreenState({ phase: "plan-error", code: outcome.code });
      } else {
        setScreenState({ phase: "error", code: outcome.code, multiBatch: outcome.multiBatch });
      }
    } catch {
      if (focusedRef.current) {
        setScreenState(run.isCanceled() ? { phase: approved ? "canceled" : "options" }
          : { phase: "error", code: "provider-unavailable", ...(runPlanRef.current && runPlanRef.current.stepCount > 1
            ? { multiBatch: { completed: 0, total: runPlanRef.current.stepCount } } : {}) });
      }
    } finally {
      run.finish();
      if (runRef.current === run) runRef.current = null;
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
    const progress = screenState.progress;
    const bodyText = progressText;
    return (
      <Screen scroll>
        {header}
        <View style={[styles.centered, { gap: spacing.md }]}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={[typography.subheading, text, { color: colors.textPrimary }]}>{t("generateDeck.generatingTitle")}</Text>
          <Text accessibilityLiveRegion="polite" style={[typography.secondary, styles.centeredText, { color: colors.textSecondary }]}>{bodyText}</Text>
          {progress ? (
            <Button
              label={cancelRequested ? t("generateDeck.canceling") : t("common.cancel")}
              variant="ghost"
              disabled={cancelRequested}
              onPress={requestCancel}
            />
          ) : null}
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

  if (screenState.phase === "canceled") {
    return <Screen scroll>{header}<EmptyState icon="close-circle-outline" title={t("generateDeck.multi.canceledTitle")}
      description={t("generateDeck.multi.canceledBody")}>
      {isRealProviderActive() ? <Text style={[typography.caption, text, { color: colors.textSecondary }]}>{t("generateDeck.multi.cancelRequestNote")}</Text> : null}
      <Button label={t("generateDeck.retryButton")} variant="primary" fullWidth onPress={() => setScreenState({ phase: "options" })} />
      <Button label={t("generateDeck.backToSourceButton")} variant="ghost" fullWidth onPress={goBack} />
    </EmptyState></Screen>;
  }

  if (screenState.phase === "error") {
    const multi = !!screenState.multiBatch;
    const description = multi ? t(multiBatchFailureCopy(screenState.code)) : t(GENERATION_ERROR_COPY_KEYS[screenState.code] as any);
    return (
      <Screen scroll>
        {header}
        <EmptyState icon="alert-circle-outline" title={t("generateDeck.error.title")} description={description}>
          {multi && screenState.code !== "daily-limit-reached" ? <Text style={[typography.secondary, text, { color: colors.textSecondary }]}>{t(GENERATION_ERROR_COPY_KEYS[screenState.code] as any)}</Text> : null}
          {multi ? <Text style={[typography.caption, text, { color: colors.textSecondary }]}>{t(isRealProviderActive() ? "generateDeck.multi.retry" : "generateDeck.multi.retryMock")}</Text> : null}
          {screenState.code !== "daily-limit-reached" ? <Button label={t("generateDeck.retryButton")} variant="primary" fullWidth onPress={() => setScreenState({ phase: "options" })} /> : null}
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

  if (screenState.phase === "plan-error") {
    return (
      <Screen scroll>
        {header}
        <EmptyState
          icon="alert-circle-outline"
          title={t("generateDeck.error.title")}
          description={t(screenState.code === "plan-too-large" ? planTooLargeCopy(scopeKind) : BATCH_PLAN_ERROR_COPY_KEYS[screenState.code] as any)}
        >
          <Button label={t("generateDeck.retryButton")} variant="primary" fullWidth onPress={() => setScreenState({ phase: "options" })} />
          <Button label={t("generateDeck.backToSourceButton")} variant="ghost" fullWidth onPress={goBack} />
        </EmptyState>
      </Screen>
    );
  }

  // phase === "options"
  const sourceWillBePartial = scopeKind === "automatic" && coverage !== null && !coverage.fullSourceIncluded;
  const trustworthyScope = coverage !== null && hasTrustworthyChunkScope(coverage);
  const cardCountHintKind = deriveCardCountHintKind(scopeKind === "automatic" ? coverage?.fullSourceIncluded ?? true : true);
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
          ) : batchPlan?.status === "error" ? (
            <Text style={[typography.caption, text, { color: colors.danger }]} accessibilityRole="text">
              {t(batchPlan.code === "plan-too-large" ? planTooLargeCopy(scopeKind) : BATCH_PLAN_ERROR_COPY_KEYS[batchPlan.code] as any)}
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

      {batchPlan?.status === "ok" && batchPlan.batches.length > 1 ? (
        <Card style={{ gap: spacing.sm }}>
          <Text accessibilityRole="header" style={[typography.subheading, text, { color: colors.textPrimary }]}>{t("generateDeck.multi.planTitle")}</Text>
          {planLines(summarizeGenerationPlan(scopeChunks ?? [], batchPlan)).map((line, index) => (
            <Text key={index} style={[typography.secondary, text, { color: colors.textSecondary }]}>{line}</Text>
          ))}
        </Card>
      ) : null}
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
