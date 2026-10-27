import type { CardCountOption, DifficultyOption } from "../types";
import { EVALUATION_FIXTURES } from "./fixtures";
import type { EvaluationCase, EvaluationScope, MatrixSelection } from "./types";

// Evaluation matrix builder — a plain Cartesian product of EXPLICITLY SELECTED dimension values,
// never the full matrix by default (see docs/ai-evaluation.md's "Evaluation matrix" section and
// the mission's own "do not immediately execute an enormous Cartesian product against real
// Bedrock"). Every default below is small and bounded; the full product is available only via
// `buildFullMatrix`, which a caller must opt into explicitly.

export const ALL_DIFFICULTIES: readonly DifficultyOption[] = ["basic", "balanced", "advanced"];
export const ALL_TIERS: readonly CardCountOption[] = ["small", "medium", "large"];
export const ALL_SCOPES: readonly EvaluationScope[] = ["bounded", "wholeSource"];

/** A small, curated default selection — one fixture per real source type, medium tier, balanced
 * difficulty, bounded scope. Fast enough to run against the mock provider in CI on every
 * invocation; deliberately NOT exhaustive. */
export const DEFAULT_SMOKE_FIXTURE_IDS: readonly string[] = ["txt-factual-rich", "pdf-structured-facts", "docx-structured-headings", "xlsx-spreadsheet-facts"];

function assertKnownFixtureIds(ids: readonly string[]): void {
  const known = new Set(EVALUATION_FIXTURES.map((f) => f.id));
  for (const id of ids) {
    if (!known.has(id)) throw new Error(`buildEvaluationMatrix: unknown fixture id "${id}"`);
  }
}

/**
 * Builds the Cartesian product of the SELECTED subsets only — an omitted dimension falls back to
 * a small, documented default (never "every value"), so calling this with `{}` reproduces the
 * smoke-test matrix, not the full grid. Fixture ids are validated eagerly — an unknown id throws
 * immediately rather than silently producing zero cases for it.
 */
export function buildEvaluationMatrix(selection: MatrixSelection = {}): EvaluationCase[] {
  const fixtureIds = selection.fixtureIds ?? DEFAULT_SMOKE_FIXTURE_IDS;
  const difficulties = selection.difficulties ?? ["balanced"];
  const tiers = selection.tiers ?? ["medium"];
  const scopes = selection.scopes ?? ["bounded"];

  assertKnownFixtureIds(fixtureIds);
  if (fixtureIds.length === 0) throw new Error("buildEvaluationMatrix: fixtureIds must not be empty");
  if (difficulties.length === 0) throw new Error("buildEvaluationMatrix: difficulties must not be empty");
  if (tiers.length === 0) throw new Error("buildEvaluationMatrix: tiers must not be empty");
  if (scopes.length === 0) throw new Error("buildEvaluationMatrix: scopes must not be empty");

  const cases: EvaluationCase[] = [];
  for (const fixtureId of fixtureIds) {
    for (const difficulty of difficulties) {
      for (const tier of tiers) {
        for (const scope of scopes) {
          cases.push({ fixtureId, difficulty, tier, scope });
        }
      }
    }
  }
  return cases;
}

/** The full dimension product over every registered fixture — explicit opt-in only (see this
 * file's header comment); never the default for any CLI invocation. */
export function buildFullMatrix(): EvaluationCase[] {
  return buildEvaluationMatrix({
    fixtureIds: EVALUATION_FIXTURES.map((f) => f.id),
    difficulties: [...ALL_DIFFICULTIES],
    tiers: [...ALL_TIERS],
    scopes: [...ALL_SCOPES],
  });
}
