/**
 * Shared types for the agent review plugin.
 *
 * Defines the configuration, finding shape, tool context, and result types
 * used across the agent's anthropic client, tools, and system prompt modules.
 */

import type { CodeChunk } from '@liendev/parser';
import type { DependencyGraph } from '../../dependency-graph.js';
import type { Logger } from '../../logger.js';

/** Configuration for the blast-radius context injection. */
export interface BlastRadiusConfig {
  /** Master switch. Default true. */
  enabled?: boolean;
  /** Max hop distance per seed. Default 2. */
  depth?: number;
  /** Max dependents emitted per seed. Default 30. */
  maxNodes?: number;
  /** Max seeds considered. Default 8. */
  maxSeeds?: number;
}

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
  /** Inject transitive blast radius into the agent's initial message. */
  blastRadius?: BlastRadiusConfig;
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
  /** Activate when any changed file matches one of these glob patterns (e.g., `*.php`, `src/services/**`). */
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
  /**
   * When true, an active instance of this rule causes the agent to receive
   * the pre-computed <blast_radius> block in the initial message. The rule's
   * prompt should tell the agent how to act on it.
   */
  requiresBlastRadius?: boolean;
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

/**
 * One tool invocation captured during an agent turn — the model-sent
 * arguments and the tool's return value. Used by the harness's `--trace`
 * mode to read what the agent actually saw when iterating on prompts.
 */
export interface ToolInvocation {
  name: string;
  /** Model-sent JSON args (parsed). */
  input: unknown;
  /** Tool's return string. Truncated to ~4 KB to keep traces readable. */
  output: string;
  durationMs?: number;
}

/**
 * One assistant turn captured during a run — full response text including
 * any reasoning prose outside the JSON fence (which `extractResponse`
 * normally strips), plus the tool calls made on this turn.
 */
export interface TurnTrace {
  turnNumber: number;
  /** Full assistant message content, captured before extractResponse. */
  responseText: string;
  /**
   * Extended-reasoning prose, captured from `message.reasoning` on
   * OpenAI-compat responses (notably `google/gemini-3-flash-preview`,
   * which emits its prose here on tool-calling turns and only puts the
   * final JSON in `content`). Undefined when the model didn't emit
   * reasoning or the provider doesn't support the field. (#552)
   */
  reasoning?: string;
  toolCalls: ToolInvocation[];
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * End-to-end agent trace: rendered prompts the model saw, plus every
 * turn's response and tool calls. Populated by the agent client when
 * the harness opts in via `reportTrace`. Kept structured (not raw log
 * text) so consumers can diff or filter without reparsing.
 */
export interface AgentTrace {
  systemPrompt: string;
  initialMessage: string;
  model: string;
  turns: TurnTrace[];
}

/** Why the agent's tool-use loop ended. */
export type AgentStopReason = 'completed' | 'budget' | 'max_turns' | 'error';

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
  /** Why the loop ended. 'completed' means the model finished naturally. */
  stopReason: AgentStopReason;
  /**
   * True when the run stopped on a budget/turn limit (or error) before the
   * agent produced a verdict (no summary). The findings are partial and the
   * result must NOT be presented as a clean/approving review.
   */
  incomplete: boolean;
  /** Per-turn trace data — only populated when the caller wires up trace capture. */
  trace?: AgentTrace;
}
