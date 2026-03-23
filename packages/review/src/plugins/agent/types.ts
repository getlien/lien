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
  anthropicApiKey: string;
  model: string;
  /** Base URL for the API (default: Anthropic). Set for Anthropic-compatible providers like MiniMax. */
  baseUrl?: string;
  /** Cost per million input tokens. Default: Sonnet pricing ($3/MTok). */
  inputCostPerMTok?: number;
  /** Cost per million output tokens. Default: Sonnet pricing ($15/MTok). */
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
