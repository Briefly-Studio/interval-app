import { getEvaluationFixture } from "./fixtures";
import type { EvaluationOutcomeCategory, GenerationEvaluationResult } from "./types";

// Report/regression-check layer — objective checks ONLY (see docs/ai-evaluation.md's
// "Regression thresholds" section and the mission's own "avoid brittle thresholds on latency/
// token usage in CI"). Nothing here grades subjective quality; that's the human-review rubric's
// job (same doc's "Human review" section), never approximated numerically here.

export type RegressionFailure = { caseLabel: string; result: GenerationEvaluationResult; reason: string };

export type ProviderMode = "mock" | "real";

// Resource/infrastructure outcomes that are expected, non-fatal noise in a REAL-provider run
// (rate limiting, the daily quota, a transient provider blip) but would be a genuine harness/
// mock-wiring bug if the deterministic MOCK provider ever produced one — see
// docs/ai-evaluation.md's "Real-provider safety" section for why mock vs. real mode treats these
// differently ("real-provider results should be observational unless explicitly promoted to a
// benchmark" — the mission's own words).
const INFRA_ONLY_CATEGORIES: ReadonlySet<EvaluationOutcomeCategory> = new Set(["provider-unavailable", "rate-limited", "daily-limit-reached"]);

function caseLabel(result: GenerationEvaluationResult): string {
  return `${result.fixtureId}/${result.difficulty}/${result.tier}/${result.scope}`;
}

function regressionReasonsFor(result: GenerationEvaluationResult, providerMode: ProviderMode): string[] {
  const reasons: string[] = [];

  if (result.outcomeCategory !== "ready" && result.outcomeCategory !== "insufficient-content") {
    const isInfraOnly = INFRA_ONLY_CATEGORIES.has(result.outcomeCategory);
    if (providerMode === "mock" || !isInfraOnly) {
      reasons.push(`non-ready outcome "${result.outcomeCategory}"${result.errorDetail ? ` (${result.errorDetail})` : ""}`);
    }
    return reasons; // nothing else is checkable when generation itself didn't complete
  }

  if (result.countCheckStatus === "exceeded-maximum") {
    reasons.push(`generated ${result.generatedCount} cards, exceeding the requested maximum of ${result.requestedMaximum}`);
  }
  if (result.countCheckStatus === "unexplained-under-target") {
    reasons.push(`generated only ${result.generatedCount} (target ${result.targetMinimum}) while self-reporting "complete"`);
  }
  if (result.countCheckStatus === "insufficiency-despite-target-met") {
    reasons.push(`met the target (${result.generatedCount} >= ${result.targetMinimum}) but self-reported "insufficient-distinct-content"`);
  }
  if (!result.provenanceValidity) {
    reasons.push("invalid provenance — a card cited an unselected/unknown chunk id, or had none");
  }
  if (result.exactDuplicateCount > 0) {
    reasons.push(`${result.exactDuplicateCount} exact-duplicate card(s) in the final deck`);
  }
  if (result.expectedConceptCoverage !== undefined) {
    const threshold = getEvaluationFixture(result.fixtureId).conceptCoverageThreshold ?? 1;
    if (result.expectedConceptCoverage < threshold) {
      reasons.push(`expected-concept coverage ${result.expectedConceptCoverage.toFixed(2)} below threshold ${threshold}`);
    }
  }
  if (result.unsupportedClaimCount !== undefined && result.unsupportedClaimCount > 0) {
    reasons.push(`${result.unsupportedClaimCount} card(s) contained a forbidden/unsupported concept`);
  }

  return reasons;
}

export function checkRegressions(results: GenerationEvaluationResult[], providerMode: ProviderMode): { passed: boolean; failures: RegressionFailure[] } {
  const failures: RegressionFailure[] = [];
  for (const result of results) {
    for (const reason of regressionReasonsFor(result, providerMode)) {
      failures.push({ caseLabel: caseLabel(result), result, reason });
    }
  }
  return { passed: failures.length === 0, failures };
}

export type EvaluationReport = {
  generatedAt: string;
  providerMode: ProviderMode;
  providerId: string;
  caseCount: number;
  passed: boolean;
  results: GenerationEvaluationResult[];
  failures: RegressionFailure[];
};

export function buildEvaluationReport(params: { providerMode: ProviderMode; providerId: string; results: GenerationEvaluationResult[] }): EvaluationReport {
  const { passed, failures } = checkRegressions(params.results, params.providerMode);
  return {
    generatedAt: new Date().toISOString(),
    providerMode: params.providerMode,
    providerId: params.providerId,
    caseCount: params.results.length,
    passed,
    results: params.results,
    failures,
  };
}

const TABLE_COLUMNS = ["Fixture", "Type", "Difficulty", "Tier", "Cards", "Target", "Status", "Concepts", "Dupes", "Latency(ms)", "Tokens"] as const;

function rowFor(result: GenerationEvaluationResult): string[] {
  return [
    result.fixtureId,
    result.sourceType,
    result.difficulty,
    result.tier,
    String(result.generatedCount),
    `${result.targetMinimum}-${result.requestedMaximum}`,
    result.outcomeCategory,
    result.expectedConceptCoverage !== undefined ? `${Math.round(result.expectedConceptCoverage * 100)}%` : "-",
    String(result.exactDuplicateCount),
    String(result.latencyMs),
    result.tokenUsage ? String(result.tokenUsage.totalTokens) : "-",
  ];
}

/** A plain, fixed-width ASCII console table — no external table-formatting dependency, no
 * spreadsheet/dashboard UI (see the mission's own "do not build spreadsheet/dashboard UI"). */
export function formatConsoleTable(results: GenerationEvaluationResult[]): string {
  const headers = [...TABLE_COLUMNS];
  const rows = results.map(rowFor);
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length), 0));
  const formatRow = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join(" | ");
  const separator = widths.map((w) => "-".repeat(w)).join("-|-");
  return [formatRow(headers), separator, ...rows.map(formatRow)].join("\n");
}

export function formatFailureSummary(failures: RegressionFailure[]): string {
  if (failures.length === 0) return "No regression failures.";
  return failures.map((f) => `FAIL ${f.caseLabel}: ${f.reason}`).join("\n");
}
