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
   * max cognitive complexity 18").
   */
  reasoning: string[];
}

/**
 * Compute a consolidated risk level for a blast radius.
 *
 * Thresholds are deliberately conservative — the goal is to surface risk, not
 * to be statistically rigorous. Callers that want finer control should consume
 * the raw input fields directly.
 */
export function computeBlastRadiusRisk(input: BlastRadiusRiskInput): BlastRadiusRisk {
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

  let level: RiskLevel;
  if (dependentCount > 50 || (hasHighComplexityUncovered && dependentCount > 20)) {
    level = 'critical';
  } else if (dependentCount > 20 || hasHighComplexityUncovered) {
    level = 'high';
  } else if (dependentCount > 5 || uncoveredDependents > 0) {
    level = 'medium';
  } else {
    level = 'low';
  }

  return { level, reasoning };
}
