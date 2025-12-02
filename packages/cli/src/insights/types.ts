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
}

export interface FileComplexityData {
  violations: ComplexityViolation[];
  dependents: string[];
  dependentCount?: number;
  /** Test files associated with this source file. TODO: Populate when test-to-code mapping is implemented */
  testAssociations: string[];
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

