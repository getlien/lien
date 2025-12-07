/**
 * Types for the Lien AI Code Review GitHub Action
 */

/**
 * Risk level for complexity violations
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

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

/**
 * A single complexity violation
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
  /** Type of complexity metric (cyclomatic vs cognitive vs halstead) */
  metricType: ComplexityMetricType;
  /** Halstead-specific details when metricType is halstead_* */
  halsteadDetails?: HalsteadDetails;
}

/**
 * Complexity data for a single file
 */
export interface FileComplexityData {
  violations: ComplexityViolation[];
  dependents: string[];
  dependentCount?: number;
  testAssociations: string[];
  riskLevel: RiskLevel;
}

/**
 * Full complexity report from lien complexity command
 */
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

/**
 * OpenRouter API response structure
 * Cost is returned in usage.cost when usage accounting is enabled
 * See: https://openrouter.ai/docs/guides/guides/usage-accounting
 */
export interface OpenRouterResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost?: number; // Returned when usage: { include: true } is set in request
  };
}

/**
 * Action configuration from inputs
 */
export interface ActionConfig {
  openrouterApiKey: string;
  model: string;
  threshold: string;
  githubToken: string;
}

/**
 * PR context for review
 */
export interface PRContext {
  owner: string;
  repo: string;
  pullNumber: number;
  title: string;
  baseSha: string;
  headSha: string;
}

/**
 * Complexity delta for a single function/method
 */
export interface ComplexityDelta {
  filepath: string;
  symbolName: string;
  symbolType: string;
  startLine: number;
  baseComplexity: number | null; // null = new function
  headComplexity: number | null; // null = deleted function
  delta: number; // positive = worse, negative = better
  threshold: number;
  severity: 'warning' | 'error' | 'improved' | 'new' | 'deleted';
}

/**
 * Summary of complexity changes in a PR
 */
export interface DeltaSummary {
  totalDelta: number; // net change across all functions
  improved: number; // count of functions that got simpler
  degraded: number; // count of functions that got more complex
  newFunctions: number; // count of new functions with violations
  deletedFunctions: number; // count of deleted functions (freed complexity)
  unchanged: number; // count of functions with same complexity
}

