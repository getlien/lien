/**
 * Complexity analysis types for code quality insights
 */

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
  testAssociations: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
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

