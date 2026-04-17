/**
 * Blast-radius risk scoring.
 *
 * Composes three signals — dependency breadth, test coverage of dependents,
 * and complexity of dependents — into a single RiskLevel. Intended as a
 * shared primitive for both the MCP `get_dependents` response and the
 * review-side blast-radius injection.
 */

import type { RiskLevel } from '../insights/types.js';

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

/**
 * Compute a consolidated risk level for a blast radius.
 *
 * Thresholds are deliberately conservative — the goal is to surface risk, not
 * to be statistically rigorous. Callers that want finer control should consume
 * the raw input fields directly.
 *
 * @example
 * const risk = computeBlastRadiusRisk({
 *   dependentCount: 14,
 *   uncoveredDependents: 3,
 *   maxDependentComplexity: 18,
 *   hasHighComplexityUncovered: true,
 * });
 * // risk.level === 'high'
 * // risk.reasoning === [
 * //   '14 callers', '3 untested', 'max complexity 18',
 * //   'untested high-complexity dependent',
 * // ]
 */
export function computeBlastRadiusRisk(input: BlastRadiusRiskInput): BlastRadiusRisk {
  return { level: classifyLevel(input), reasoning: buildReasoning(input) };
}
