/**
 * Blast-radius risk scoring.
 *
 * Composes three signals — dependency breadth, test coverage of dependents,
 * and complexity of dependents — into a single RiskLevel. Intended as a
 * shared primitive for both the MCP `get_dependents` response and the
 * review-side blast-radius injection.
 */

import { RISK_ORDER, type RiskLevel } from '../insights/types.js';

export interface BlastRadiusRiskInput {
  /** Distinct dependents across all hops. */
  dependentCount: number;
  /** Dependents with no associated test file. */
  uncoveredDependents: number;
  /** Max complexity (cyclomatic or cognitive) among dependents. Optional. */
  maxDependentComplexity?: number;
  /**
   * True when at least one untested dependent has high complexity.
   * Supplied by the caller to keep this helper independent of any
   * specific complexity-report shape.
   */
  hasHighComplexityUncovered?: boolean;
  /**
   * Already-classified complexity tier across dependents (e.g.
   * `ComplexityMetrics.complexityRiskBoost`), independent of test coverage.
   * Optional -- callers that don't compute one (no floor applied) behave
   * exactly as before this field existed.
   *
   * A high/critical complexity signal describes dependents that are hard to
   * change safely; full test coverage lowers the odds of a *silent* break,
   * it doesn't shrink that blast radius. Without this, a fully-tested file
   * with a critical-complexity caller could come back `riskLevel: "low"`
   * despite its own `complexityRiskBoost` reading `"critical"` (#933) --
   * `classifyLevel` below only ever looked at complexity through
   * `hasHighComplexityUncovered`, which requires an untested dependent to
   * fire at all, so "high complexity, zero untested" had no path to
   * escalate anything.
   */
  complexityRiskBoost?: RiskLevel;
}

export interface BlastRadiusRisk {
  level: RiskLevel;
  /**
   * Short phrases describing why the level was assigned, in the order they
   * contributed. Used verbatim by renderers (e.g. "14 callers, 3 untested,
   * max complexity 18, untested high-complexity dependent").
   */
  reasoning: string[];
}

function buildReasoning(input: BlastRadiusRiskInput): string[] {
  const {
    dependentCount,
    uncoveredDependents,
    maxDependentComplexity,
    hasHighComplexityUncovered = false,
  } = input;
  const reasoning: string[] = [];
  if (dependentCount > 0) {
    reasoning.push(`${dependentCount} ${dependentCount === 1 ? 'caller' : 'callers'}`);
  }
  if (uncoveredDependents > 0) {
    reasoning.push(`${uncoveredDependents} untested`);
  }
  if (typeof maxDependentComplexity === 'number' && maxDependentComplexity > 0) {
    reasoning.push(`max complexity ${maxDependentComplexity}`);
  }
  // Surface the escalation driver explicitly — otherwise a caller with only
  // "3 callers, 1 untested" can't tell why the level came back as 'high'.
  if (hasHighComplexityUncovered) {
    reasoning.push('untested high-complexity dependent');
  }
  return reasoning;
}

function classifyLevel(input: BlastRadiusRiskInput): RiskLevel {
  const { dependentCount, uncoveredDependents, hasHighComplexityUncovered = false } = input;
  if (dependentCount > 50) return 'critical';
  if (hasHighComplexityUncovered && dependentCount > 20) return 'critical';
  if (dependentCount > 20) return 'high';
  if (hasHighComplexityUncovered) return 'high';
  if (dependentCount > 5) return 'medium';
  if (uncoveredDependents > 0) return 'medium';
  return 'low';
}

const LEVELS: readonly RiskLevel[] = ['low', 'medium', 'high', 'critical'];

/**
 * The floor a `complexityRiskBoost` alone contributes, one tier below its
 * own severity: `critical` -> `high`, `high` -> `medium`, anything lower ->
 * `low` (a no-op floor). `hasHighComplexityUncovered` already reaches the
 * FULL severity when a dependent is both untested and high-complexity --
 * this floor is what fires when nothing else did, so a critical/high
 * complexity signal is never fully cancelled out by every dependent
 * happening to be tested (#933), while the untested case still ends up
 * strictly worse than the tested one (matching "being tested reduces the
 * chance of a silent break, not the blast radius" from the issue).
 */
function complexityFloor(boost: RiskLevel | undefined): RiskLevel {
  if (!boost) return 'low';
  return LEVELS[Math.max(0, LEVELS.indexOf(boost) - 1)];
}

/**
 * Compute a consolidated risk level for a blast radius.
 *
 * Thresholds are deliberately conservative — the goal is to surface risk, not
 * to be statistically rigorous. Callers that want finer control should consume
 * the raw input fields directly.
 *
 * The result is monotonic in `complexityRiskBoost`: it is never raised below
 * `complexityFloor(complexityRiskBoost)` (see that function's doc comment),
 * so a `high`/`critical` boost can never be paired with a `low` verdict.
 */
export function computeBlastRadiusRisk(input: BlastRadiusRiskInput): BlastRadiusRisk {
  const countLevel = classifyLevel(input);
  const floor = complexityFloor(input.complexityRiskBoost);
  const floorApplies = RISK_ORDER[floor] > RISK_ORDER[countLevel];
  const reasoning = buildReasoning(input);
  if (floorApplies) {
    // Explain the escalation the same way `hasHighComplexityUncovered`'s
    // 'untested high-complexity dependent' phrase does -- otherwise a reader
    // sees "max complexity 31" next to a level that jumped and can't tell
    // why full test coverage didn't prevent it.
    reasoning.push(`${input.complexityRiskBoost}-complexity dependent regardless of test coverage`);
  }
  return { level: floorApplies ? floor : countLevel, reasoning };
}
