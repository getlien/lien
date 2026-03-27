/**
 * Shared types for the agent review plugin.
 *
 * Defines the configuration, finding shape, tool context, and result types
 * used across the agent's anthropic client, tools, and system prompt modules.
 */

import type { CodeChunk } from '@liendev/parser';
import type { DependencyGraph } from '../../dependency-graph.js';
import type { Logger } from '../../logger.js';

/** Configuration for the agent review plugin. */
export interface AgentConfig {
  /** API key (OpenRouter or Anthropic) */
  apiKey?: string;
  /** @deprecated Use apiKey instead */
  anthropicApiKey?: string;
  model: string;
  /** 'openai' for OpenRouter/Gemini/DeepSeek, 'anthropic' for Claude */
  provider?: 'openai' | 'anthropic';
  /** Base URL for the API */
  baseUrl?: string;
  inputCostPerMTok?: number;
  outputCostPerMTok?: number;
  maxTurns: number;
  maxTokenBudget: number;
}

/** A single finding produced by the agent during review. */
export interface AgentFinding {
  filepath: string;
  line: number;
  endLine?: number;
  symbolName?: string;
  severity: 'error' | 'warning';
  category: string;
  message: string;
  suggestion?: string;
  evidence?: string;
  /** Rule that triggered this finding, if identifiable. */
  ruleId?: string;
}

// ---------------------------------------------------------------------------
// Rules Engine
// ---------------------------------------------------------------------------

/** Conditions under which a rule activates. At least one must match. */
export interface RuleTriggers {
  /** Activate when any changed file is in one of these languages. */
  languages?: string[];
  /** Activate when any changed file matches one of these globs. */
  filePatterns?: string[];
  /** Activate when the diff content contains any of these keywords (case-insensitive regex). */
  keywords?: string[];
  /** Always activate regardless of context. */
  always?: boolean;
}

/** A review rule — a prompt fragment with metadata for conditional inclusion. */
export interface ReviewRule {
  /** Unique stable identifier (e.g., 'edge-case-sweep', 'concurrency-race'). */
  id: string;
  /** Human-readable name shown in UI and prompt headings. */
  name: string;
  /** Short description of what this rule detects. */
  description: string;
  /** The prompt fragment injected into the system prompt when this rule is active. */
  prompt: string;
  /** Optional example finding demonstrating what this rule catches (JSON string). */
  example?: string;
  /** Trigger conditions — rule is included when ANY trigger matches. */
  triggers: RuleTriggers;
  /** Default severity for findings produced by this rule. */
  severity: 'error' | 'warning';
  /** Default category for findings produced by this rule. */
  category: string;
  /** Whether this rule is enabled by default. */
  enabled: boolean;
  /** 'builtin' for extracted rules, 'custom' for user-defined rules. */
  source: 'builtin' | 'custom';
}

/** Resolved set of rules for a specific review run. */
export interface ResolvedRules {
  /** Rules that matched at least one trigger for this PR context. */
  active: ReviewRule[];
  /** Rule IDs that were disabled or did not match any trigger. */
  skipped: string[];
}

/** Context passed to agent tool implementations for codebase investigation. */
export interface AgentToolContext {
  repoChunks: CodeChunk[];
  repoRootDir: string;
  graph: DependencyGraph;
  logger: Logger;
}

/** Summary produced by the agent alongside findings. */
export interface AgentSummary {
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  overview: string;
  keyChanges: string[];
}

/** Result of an agent review run, including findings, usage, and turn count. */
export interface AgentResult {
  findings: AgentFinding[];
  summary?: AgentSummary;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number;
  };
  turns: number;
}
