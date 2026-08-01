/**
 * Complexity analysis types for code quality insights
 */

/**
 * Risk level ordering for comparison operations.
 * Higher value = higher risk.
 */
export const RISK_ORDER = { low: 0, medium: 1, high: 2, critical: 3 } as const;

/**
 * Risk level type derived from RISK_ORDER keys
 */
export type RiskLevel = keyof typeof RISK_ORDER;

/**
 * Type of complexity metric being measured
 */
export type ComplexityMetricType = 'cyclomatic' | 'cognitive' | 'halstead_effort' | 'halstead_bugs';

/**
 * Halstead metric details for Halstead-type violations
 */
export interface HalsteadDetails {
  volume: number;
  difficulty: number;
  effort: number;
  bugs: number;
}

export interface ComplexityViolation {
  filepath: string;
  startLine: number;
  endLine: number;
  symbolName: string;
  symbolType: 'function' | 'method' | 'class' | 'file';
  language: string;
  complexity: number;
  threshold: number;
  severity: 'warning' | 'error';
  message: string;
  /** Type of complexity metric (cyclomatic vs cognitive vs halstead) */
  metricType: ComplexityMetricType;
  /** Halstead-specific details when metricType is halstead_* */
  halsteadDetails?: HalsteadDetails;
}

export interface FileComplexityData {
  violations: ComplexityViolation[];
  dependents: string[];
  dependentCount?: number;
  /** Test files associated with this source file. TODO: Populate when test-to-code mapping is implemented */
  testAssociations: string[];
  /**
   * Complexity risk: this file's OWN violation severity (`calculateRiskLevel`
   * in `../chunk-complexity.ts`), boosted -- never downgraded -- by its
   * dependent count/complexity (`enrichWithDependencies`, same file). There
   * is no test-coverage term in this formula at all.
   *
   * This is a DIFFERENT concept from `get_dependents`/`lien annotate`/`lien
   * api-delta`'s `riskLevel` (blast-radius risk, `computeBlastRadiusRisk` in
   * `../risk/blast-radius-risk.ts`), which weighs dependents' test coverage
   * and applies a complexity floor instead of a boost. The two can disagree
   * for the same file at the same moment BY DESIGN (CLI-4/REVIEW-6) -- see
   * `docs/architecture/blast-radius-nudge.md`'s "Two risk concepts" section,
   * and `complexity-vs-blast-radius-risk.test.ts` for pinned examples of the
   * divergence in both directions. Kept as `riskLevel` here (the internal,
   * parser-package-only name); serialized as `complexityRiskLevel` at the
   * `get_complexity`/`lien complexity --format json` output boundary, where
   * the collision with the other three surfaces' `riskLevel` was actually
   * observed.
   */
  riskLevel: RiskLevel;
  dependentComplexityMetrics?: {
    averageComplexity: number;
    maxComplexity: number;
    filesWithComplexityData: number;
  };
}

export interface ComplexityReport {
  summary: {
    filesAnalyzed: number;
    totalViolations: number;
    bySeverity: { error: number; warning: number };
    avgComplexity: number;
    maxComplexity: number;
  };
  files: Record<string, FileComplexityData>;
}
