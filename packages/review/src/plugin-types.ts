/**
 * Plugin architecture types for Lien Review.
 *
 * Defines the interfaces for the pluggable review engine:
 * - ReviewPlugin: the contract every plugin implements
 * - ReviewContext: the world every plugin receives
 * - ReviewFinding: the universal output
 * - LLMClient: abstraction over LLM providers
 * - OutputAdapter: presentation layer
 */

import type { z } from 'zod';
import type { CodeChunk, ComplexityReport } from '@liendev/parser';
import type { PRContext, ReviewConfig } from './types.js';
import type { Logger } from './logger.js';
import type { ComplexityDelta, DeltaSummary } from './delta.js';

// ---------------------------------------------------------------------------
// LLM Client
// ---------------------------------------------------------------------------

/**
 * Options for a single LLM completion call.
 */
export interface LLMOptions {
  /** Max tokens for the response */
  maxTokens?: number;
  /** Sampling temperature (0-1) */
  temperature?: number;
  /** Abort signal for per-call timeout */
  signal?: AbortSignal;
}

/**
 * Response from an LLM completion call.
 */
export interface LLMResponse {
  /** The completion text */
  content: string;
  /** Token usage and cost information */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number;
  };
}

/**
 * Abstraction over LLM providers. Instance-based, no global mutable state.
 * The initial implementation wraps OpenRouter; the interface allows future providers.
 */
export interface LLMClient {
  complete(prompt: string, opts?: LLMOptions): Promise<LLMResponse>;
  /** Accumulated usage across all calls on this instance */
  getUsage(): { promptTokens: number; completionTokens: number; totalTokens: number; cost: number };
}

// ---------------------------------------------------------------------------
// Review Context
// ---------------------------------------------------------------------------

/**
 * The world every plugin receives. Built by the engine before running plugins.
 *
 * @property chunks - AST-parsed code chunks for all changed files. Always present.
 * @property changedFiles - List of file paths changed in this review scope.
 * @property complexityReport - Complexity analysis of the current code. Always present (the parser always runs).
 * @property baselineReport - Complexity analysis of the base branch. Null when no baseline is available (CLI without git, first PR).
 * @property deltas - Computed complexity deltas between baseline and current. Null when no baseline.
 * @property pluginConfigs - Per-plugin config keyed by plugin ID. The engine merges each plugin's defaults with the matching entry here before passing to the plugin.
 * @property config - Resolved config for the currently-running plugin. Set by the engine before calling shouldActivate/analyze. Callers should set pluginConfigs instead.
 * @property llm - LLM client for AI-powered analysis. Absent if no LLM configured or --no-llm flag.
 * @property pr - PR context (owner, repo, number, etc.). Absent in CLI mode.
 * @property logger - Logger for structured output.
 */
export interface ReviewContext {
  chunks: CodeChunk[];
  changedFiles: string[];
  complexityReport: ComplexityReport;
  baselineReport: ComplexityReport | null;
  deltas: ComplexityDelta[] | null;
  pluginConfigs: Record<string, Record<string, unknown>>;
  /** Resolved config for the current plugin. Set by the engine — callers should use pluginConfigs. */
  config: Record<string, unknown>;
  llm?: LLMClient;
  pr?: PRContext;
  logger: Logger;
}

// ---------------------------------------------------------------------------
// Review Finding
// ---------------------------------------------------------------------------

/**
 * Built-in metadata types for built-in plugins (discriminated union).
 * Custom plugins can use Record<string, unknown>.
 */
export interface ComplexityFindingMetadata {
  pluginType: 'complexity';
  metricType: string;
  complexity: number;
  threshold: number;
  delta: number | null;
  symbolType: string;
}

export interface LogicFindingMetadata {
  pluginType: 'logic';
  evidence: string;
}

export interface ArchitecturalFindingMetadata {
  pluginType: 'architectural';
  scope: string;
}

export type BuiltinFindingMetadata =
  | ComplexityFindingMetadata
  | LogicFindingMetadata
  | ArchitecturalFindingMetadata;

/**
 * The universal output of a review plugin.
 */
export interface ReviewFinding {
  /** Which plugin produced this finding */
  pluginId: string;
  /** File path relative to repo root */
  filepath: string;
  /** Line number (1-based) */
  line: number;
  /** End line for multi-line findings */
  endLine?: number;
  /** Symbol name (function, class, method) */
  symbolName?: string;
  /** Severity level */
  severity: 'error' | 'warning' | 'info';
  /** Category (e.g., 'cyclomatic', 'breaking_change', 'architectural') */
  category: string;
  /** Human-readable message */
  message: string;
  /** Actionable fix suggestion */
  suggestion?: string;
  /** Supporting evidence */
  evidence?: string;
  /** Plugin-specific metadata. Built-in plugins use typed variants; custom plugins use Record<string, unknown>. */
  metadata?: BuiltinFindingMetadata | Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Review Plugin
// ---------------------------------------------------------------------------

/**
 * The contract every review plugin implements.
 */
export interface ReviewPlugin {
  /** Unique identifier (e.g., 'complexity', 'logic', 'architectural') */
  id: string;
  /** Human-readable name */
  name: string;
  /** Short description of what this plugin does */
  description: string;

  /** Whether this plugin requires an LLM to produce any findings */
  requiresLLM?: boolean;

  /**
   * When should this plugin run? Return false to skip.
   * Called with the full context including this plugin's resolved config.
   */
  shouldActivate(context: ReviewContext): boolean | Promise<boolean>;

  /**
   * Produce findings. The engine collects all findings from all active plugins.
   */
  analyze(context: ReviewContext): ReviewFinding[] | Promise<ReviewFinding[]>;

  /**
   * Optional Zod schema for validating this plugin's config section.
   * Used by the config module to validate .lien/review.yml.
   */
  configSchema?: z.ZodType;

  /** Default config values for this plugin */
  defaultConfig?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Output Adapter
// ---------------------------------------------------------------------------

/**
 * Result of an adapter presenting findings.
 */
export interface AdapterResult {
  /** Number of findings posted/displayed */
  posted: number;
  /** Number of findings skipped (e.g., dedup, outside diff) */
  skipped: number;
  /** Number of findings filtered out (e.g., below severity threshold) */
  filtered: number;
}

/**
 * Context provided to output adapters alongside findings.
 */
export interface AdapterContext {
  complexityReport: ComplexityReport;
  baselineReport: ComplexityReport | null;
  deltas: ComplexityDelta[] | null;
  deltaSummary: DeltaSummary | null;
  pr?: PRContext;
  /** Octokit instance (only for GitHub adapter) */
  octokit?: unknown;
  logger: Logger;
  llmUsage?: { promptTokens: number; completionTokens: number; totalTokens: number; cost: number };
  model?: string;
  /** When true, post REQUEST_CHANGES if new error-level violations are introduced. */
  blockOnNewErrors?: boolean;
}

/**
 * Presentation layer for review findings.
 * Adapters know nothing about analysis — they only format and present.
 */
export interface OutputAdapter {
  present(findings: ReviewFinding[], context: AdapterContext): Promise<AdapterResult>;
}

// ---------------------------------------------------------------------------
// Analysis Result (moved here to prevent circular deps)
// ---------------------------------------------------------------------------

/**
 * Result of analysis orchestration.
 * Previously in review-engine.ts.
 */
export interface AnalysisResult {
  currentReport: ComplexityReport;
  baselineReport: ComplexityReport | null;
  deltas: ComplexityDelta[] | null;
  filesToAnalyze: string[];
  chunks: CodeChunk[];
}

/**
 * Setup result for review orchestration.
 * Previously in review-engine.ts.
 */
export interface ReviewSetup {
  config: ReviewConfig;
  prContext: PRContext;
  octokit: unknown;
  logger: Logger;
  rootDir: string;
}

// Re-export ReviewConfig from types.ts for convenience
export type { ReviewConfig } from './types.js';
