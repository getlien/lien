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
  /**
   * OpenRouter `provider` routing block (openai path), sent verbatim on each
   * request. Omit for DEFAULT_PROVIDER_ROUTING; `null` to send no preferences.
   */
  providerRouting?: Record<string, unknown> | null;
  /** Per-request abort timeout in ms (openai path). Omit for the 120s default. */
  requestTimeoutMs?: number;
  /** Inject transitive blast radius into the agent's initial message. */
  blastRadius?: BlastRadiusConfig;
  /**
   * Run the dedicated claims-only doc-truth second pass on doc-touching PRs
   * (issue #732). Default true; set false (or env LIEN_REVIEW_DOC_PASS=0) to
   * skip it and run the single main pass only.
   */
  docTruthPass?: boolean;
  /**
   * Whether the `summary` review type is enabled for this run (issue #572).
   * Gates the diff-only summary-only mode: with zero analyzable chunks, the
   * plugin only activates when this is true AND the PR's patches are
   * available — see `summary-only-pass.ts`'s `isSummaryOnlyMode`.
   */
  summaryEnabled?: boolean;
  /**
   * Run the stale-duplicate candidate-loop PILOT (per-rule-loops design doc
   * §4). Default false — this is a dark-launched pilot; set true (or env
   * LIEN_STALE_DUP_PASS=on) to enable it. See `stale-duplicate-pass.ts`.
   */
  staleDuplicatePass?: boolean;
  /**
   * Run the incomplete-handling candidate loop (per-rule-loops design doc
   * §7 item 5) — unifies the variant-sweep/sibling-surface/unread-field
   * signals into one dedicated pass. Default false — dark-launched; set
   * true (or env LIEN_INCOMPLETE_PASS=on) to enable it. See
   * `incomplete-handling-pass.ts`.
   */
  incompleteHandlingPass?: boolean;
  /**
   * Run the removed-exports candidate loop (ADR-014's gating matrix —
   * `structural-analysis` is hybrid; this covers only its removed-export
   * sweep half). Default false — dark-launched; set true (or env
   * LIEN_REMOVED_EXPORTS_PASS=on) to enable it. See `removed-exports-pass.ts`.
   */
  removedExportsPass?: boolean;
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
  /**
   * Which review pass produced this turn. Absent means the main pass; an
   * extra pass (see `review-pass.ts`'s `ReviewPassSpec.name` — the doc-truth
   * second pass, issue #732, is the first) stamps its appended turns with its
   * own pass name so a merged trace stays interpretable. Optional/additive —
   * existing consumers ignore it.
   */
  phase?: string;
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

/**
 * Why the agent's tool-use loop ended. `incomplete_verdict` is set by a
 * candidate-loop pass's `postProcessResult` (see `review-pass.ts`) when the
 * model returned a syntactically complete verdict (has a summary — the
 * client's OWN `incomplete` check passes) but didn't cover every candidate
 * id in its own worklist — a distinct honesty gap from budget/max_turns/error,
 * which are all client-transport-level stops.
 */
export type AgentStopReason = 'completed' | 'budget' | 'max_turns' | 'error' | 'incomplete_verdict';

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
  /**
   * True when the agent pass NEVER completed a single model turn — every
   * provider request failed terminally (e.g. a 402 on an overdrawn account, or a
   * network outage that outlasted the retries). Distinct from a PARTIAL
   * incomplete run (some turns completed, then it bailed): a never-ran review
   * investigated nothing, so it must drive a FAILING check conclusion rather
   * than the neutral one a partial run gets. Always implies `incomplete`. Set on
   * the MAIN pass only — a failure-isolated doc-truth second pass never sets it.
   */
  neverRan?: boolean;
  /**
   * The terminal error message that ended the run (present when `stopReason` is
   * 'error'), so the never-ran/incomplete notice can name the provider failure.
   */
  errorMessage?: string;
  /**
   * True when `incomplete` was set by an unfinished doc-truth SECOND pass
   * while the main pass finished cleanly — the incomplete notice then names
   * the doc pass instead of implying the whole review is partial.
   */
  incompleteFromDocPass?: boolean;
  /**
   * Set by a candidate-loop pass's `mergeResultState` (e.g.
   * `stale-duplicate-pass.ts`) to this pass's own `name` when ONLY that pass
   * is incomplete and the main pass finished cleanly — the generic
   * counterpart to `incompleteFromDocPass` for any pass beyond doc-truth, so
   * `appendIncompleteNotice` (index.ts) can name the right pass in its
   * notice instead of implying the whole review is partial. Doc-truth keeps
   * its own dedicated boolean (unchanged, to avoid touching its already-
   * tested wording); a future pass should prefer this generic field over
   * adding another dedicated boolean.
   */
  incompleteFromPass?: string;
  /**
   * How many of this pass's eligible candidates were excluded from its
   * worklist because they exceeded this run's affordable-candidate ceiling
   * — rank-and-cap candidate-overflow handling (see `review-pass.ts`'s
   * `affordableCandidateCeiling`). Set by a candidate-loop pass's
   * `postProcessResult`; 0/absent for the main pass and for any pass whose
   * full candidate list fit inside its budget (the common case). Deferral is
   * NOT incompleteness: a capped-but-complete run (every LISTED candidate
   * verdicted) keeps `incomplete: false` regardless of this value.
   */
  candidatesDeferred?: number;
  /**
   * Best-effort human-readable labels for the deferred candidates (capped
   * short list) — omitted when `candidatesDeferred` is 0/absent, or the
   * pass's candidate shape has no natural short label.
   */
  deferredCandidateIds?: string[];
  /** Per-turn trace data — only populated when the caller wires up trace capture. */
  trace?: AgentTrace;
}
