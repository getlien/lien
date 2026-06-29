/**
 * Anthropic agentic tool_use loop for the review agent.
 *
 * Wraps @anthropic-ai/sdk to run a multi-turn conversation where the model
 * can call tools to investigate the codebase. Accumulates usage across turns
 * and parses the final JSON findings from the model's text output.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Logger } from '../../logger.js';
import type {
  AgentFinding,
  AgentSummary,
  AgentResult,
  AgentStopReason,
  TurnTrace,
  ToolInvocation,
} from './types.js';

/** Cap a single tool's recorded output so traces stay readable. */
const TRACE_TOOL_OUTPUT_MAX = 4096;

/** Cap per-turn reasoning/output printed to CI logs. */
const AGENT_LOG_MAX = 4000;

/**
 * Cap a single tool result fed back to the model. A large file read or
 * batched get_files_context can otherwise return tens of thousands of tokens
 * in one turn, blowing the whole budget before the wrap-up nudge can fire.
 * ~16K chars ≈ 4K tokens — enough context for a review, bounded per call.
 */
const TOOL_RESULT_MAX_CHARS = 16_000;

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]` : s;
}

/**
 * Parse a boolean-ish env *disable* flag. Per-turn agent logging is ON by
 * default; only an explicit '0'/'false' (case-insensitive) disables it.
 * Parsed precisely so an unrelated value doesn't accidentally silence it.
 */
function envDisabled(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === '0' || v === 'false';
}

/** Extract the assistant's text content from an Anthropic response for trace. */
function joinTextBlocks(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n');
}

/**
 * Extract Claude's extended-thinking prose from a response, if present.
 * Populates TurnTrace.reasoning so logTurn can surface it on incomplete runs
 * (parity with the OpenAI path's `reasoning` field).
 */
export function extractThinking(content: Anthropic.Messages.ContentBlock[]): string | undefined {
  const thinking = content
    .filter((b): b is Anthropic.Messages.ThinkingBlock => b.type === 'thinking')
    .map(b => b.thinking)
    .join('\n')
    .trim();
  return thinking || undefined;
}

/**
 * Extended-thinking config. Enabled for parity with the OpenAI path's
 * `reasoning: { effort: 'high' }` — it also improves review quality and is
 * what makes Claude emit the thinking blocks logTurn surfaces. Compatible with
 * tool_choice:'none' (the forced-verdict turn); only 'any'/'tool' are not.
 * budget_tokens must be < max_tokens.
 */
const THINKING_BUDGET_TOKENS = 4096;
const MAX_TOKENS = 16_000;

/**
 * Bound a single request's output to the budget remaining, so one turn can't
 * blow far past maxTokenBudget before the post-response check (and the retry
 * can't pile on after the loop already stopped for budget). Floored above the
 * thinking budget so thinking stays valid (budget_tokens < max_tokens) and a
 * final verdict still fits.
 */
const MIN_REQUEST_MAX_TOKENS = THINKING_BUDGET_TOKENS + 2_048;
export function requestMaxTokens(remainingBudget: number): number {
  return Math.min(MAX_TOKENS, Math.max(remainingBudget, MIN_REQUEST_MAX_TOKENS));
}

/** Default Sonnet pricing: $3/MTok input, $15/MTok output. */
const DEFAULT_INPUT_COST_PER_MTOK = 3;
const DEFAULT_OUTPUT_COST_PER_MTOK = 15;

interface AgentClientOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  inputCostPerMTok?: number;
  outputCostPerMTok?: number;
  maxTurns: number;
  maxTokenBudget: number;
  logger: Logger;
}

/**
 * Anthropic-compatible agent client that runs a tool_use loop until the model
 * finishes its investigation or budget/turn limits are hit.
 */
export class AnthropicAgentClient {
  private client: Anthropic;
  private model: string;
  private maxTurns: number;
  private maxTokenBudget: number;
  private logger: Logger;
  private inputCostPerToken: number;
  private outputCostPerToken: number;
  // Verbose per-turn reasoning/output logging — ON by default so every review
  // is diagnosable; set LIEN_REVIEW_LOG_AGENT=0 (or false) to silence it. The
  // last turn is always logged on an incomplete run regardless.
  private logAgentTurns: boolean;

  constructor(options: AgentClientOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
    });
    this.model = options.model;
    this.maxTurns = options.maxTurns;
    this.maxTokenBudget = options.maxTokenBudget;
    this.logger = options.logger;
    this.logAgentTurns = !envDisabled(process.env.LIEN_REVIEW_LOG_AGENT);
    this.inputCostPerToken = (options.inputCostPerMTok ?? DEFAULT_INPUT_COST_PER_MTOK) / 1_000_000;
    this.outputCostPerToken =
      (options.outputCostPerMTok ?? DEFAULT_OUTPUT_COST_PER_MTOK) / 1_000_000;
  }

  /**
   * Run the agentic tool_use loop.
   *
   * Sends the system prompt and initial message, then loops: if the model
   * returns tool_use blocks, execute them and feed results back. Continues
   * until the model returns end_turn, or maxTurns/maxTokenBudget is exhausted.
   *
   * @param systemPrompt - System prompt instructing the agent
   * @param initialMessage - User message with PR context (diff, deltas, signatures)
   * @param tools - Anthropic tool definitions
   * @param toolExecutor - Callback to execute tool calls by name
   * @returns Agent result with findings, usage, and turn count
   */
  async run(
    systemPrompt: string,
    initialMessage: string,
    tools: Anthropic.Messages.Tool[],
    toolExecutor: (name: string, input: Record<string, unknown>) => Promise<string>,
  ): Promise<AgentResult> {
    const messages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: initialMessage }];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let turn = 0;
    let lastResponse: Anthropic.Messages.Message | null = null;
    const turnTraces: TurnTrace[] = [];
    // Defaults to 'max_turns': if the loop exits via its `while` condition
    // without any explicit break below, the turn budget was the limit.
    let stopReason: AgentStopReason = 'max_turns';
    // Once near budget we drop the tools so the model is *forced* to emit its
    // verdict next turn, rather than tool-calling until the hard cap.
    let forceFinish = false;

    while (turn < this.maxTurns) {
      turn++;

      const used = totalInputTokens + totalOutputTokens;
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: requestMaxTokens(this.maxTokenBudget - used),
        thinking: { type: 'enabled', budget_tokens: THINKING_BUDGET_TOKENS },
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages,
        tools,
        // tool_choice:'none' forbids tool calls, forcing a findings response.
        // Compatible with extended thinking (unlike 'any'/'tool').
        ...(forceFinish ? { tool_choice: { type: 'none' as const } } : {}),
      });

      lastResponse = response;

      // Accumulate usage
      const turnInputTokens = response.usage.input_tokens;
      const turnOutputTokens = response.usage.output_tokens;
      totalInputTokens += turnInputTokens;
      totalOutputTokens += turnOutputTokens;

      const totalTokens = totalInputTokens + totalOutputTokens;
      this.logger.info(
        `[agent] Turn ${turn}: stop_reason=${response.stop_reason}, tokens=${totalTokens}`,
      );

      // Log tool calls for this turn
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
      );
      if (toolUseBlocks.length > 0) {
        const toolNames = toolUseBlocks.map(b => b.name).join(', ');
        this.logger.info(`[agent] Turn ${turn} tools: ${toolNames}`);
      }

      // Trace accumulator for this turn — tool inputs/outputs get
      // populated below as the loop dispatches them.
      const turnTrace: TurnTrace = {
        turnNumber: turn,
        responseText: joinTextBlocks(response.content),
        reasoning: extractThinking(response.content),
        toolCalls: [],
        finishReason: response.stop_reason ?? undefined,
        inputTokens: turnInputTokens,
        outputTokens: turnOutputTokens,
      };
      turnTraces.push(turnTrace);
      if (this.logAgentTurns) this.logTurn(turnTrace);

      // Done: model finished naturally
      if (response.stop_reason === 'end_turn') {
        stopReason = 'completed';
        break;
      }

      // Hard budget exceeded — stop immediately
      if (totalTokens >= this.maxTokenBudget) {
        this.logger.warning(
          `[agent] Token budget exceeded (${totalTokens}/${this.maxTokenBudget}), stopping`,
        );
        stopReason = 'budget';
        break;
      }

      // Approaching budget or last turn — tell the agent to wrap up.
      // Threshold kept below the hard cap with headroom so a single capped
      // tool result can't skip past the wrap-up window into the hard stop.
      const nearBudget = totalTokens >= this.maxTokenBudget * 0.6;
      const lastTurn = turn >= this.maxTurns - 1;
      const shouldWrapUp = nearBudget || lastTurn;
      // Drop tools next turn so the model must produce its verdict.
      if (shouldWrapUp) forceFinish = true;

      // Process tool_use blocks
      if (response.stop_reason === 'tool_use' && toolUseBlocks.length > 0) {
        await this.dispatchToolUseBlocks(
          toolUseBlocks,
          response.content,
          messages,
          turnTrace,
          toolExecutor,
          shouldWrapUp,
        );
      } else {
        // Unexpected stop reason (max_tokens, stop_sequence, etc.) — stop looping
        this.logger.warning(`[agent] Unexpected stop_reason: ${response.stop_reason}, stopping`);
        stopReason = 'error';
        break;
      }
    }

    if (turn >= this.maxTurns) {
      this.logger.warning(`[agent] Max turns reached (${this.maxTurns}), stopping`);
    }

    // Capture the last *investigation* turn before the summary-retry appends
    // its own trace — that's what we want to surface on bail.
    const lastLoopTurn = turnTraces[turnTraces.length - 1];

    let parsed = lastResponse ? extractResponse(lastResponse.content) : { findings: [] };
    if (!parsed.summary && lastResponse) {
      const remainingBudget = this.maxTokenBudget - (totalInputTokens + totalOutputTokens);
      const retry = await this.runSummaryRetry(
        messages,
        lastResponse,
        turn,
        tools,
        remainingBudget,
      );
      if (retry) {
        totalInputTokens += retry.inputTokens;
        totalOutputTokens += retry.outputTokens;
        turnTraces.push(retry.traceTurn);
        if (retry.parsed.summary || retry.parsed.findings.length > 0) {
          parsed = retry.parsed;
        }
      }
    }

    const cost =
      totalInputTokens * this.inputCostPerToken + totalOutputTokens * this.outputCostPerToken;

    // Incomplete = the agent never produced a structured verdict (no summary,
    // even after the retry). A genuine clean review always carries a summary, so
    // the ABSENCE of one — not the stop reason — is what marks a run incomplete.
    // This also catches an `end_turn` that emitted prose instead of the findings
    // JSON: that must NOT be reported as a clean 0-findings review.
    const incomplete = !parsed.summary;
    if (incomplete) {
      this.logger.warning(
        `[agent] Review incomplete (stopReason=${stopReason}, no verdict/summary after ${turn} turns)`,
      );
      // Always surface what the agent was doing when it bailed.
      this.logTurn(lastLoopTurn, 'last turn before bail');
    }

    return {
      findings: parsed.findings,
      summary: parsed.summary,
      usage: {
        promptTokens: totalInputTokens,
        completionTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        cost,
      },
      turns: turn,
      stopReason,
      incomplete,
      trace: {
        systemPrompt,
        initialMessage,
        model: this.model,
        turns: turnTraces,
      },
    };
  }

  /**
   * Append the assistant's tool_use turn, dispatch each tool in
   * parallel (preserving declaration order in the trace), and append
   * tool_result blocks. Pulled out of `run()` to keep its
   * time-to-understand under the complexity threshold.
   */
  /**
   * Print a turn's reasoning + output to the logger so CI logs show what the
   * agent was actually thinking. Truncated to keep logs readable.
   */
  private logTurn(turn: TurnTrace | undefined, label?: string): void {
    if (!turn) return;
    const tag = label ? ` (${label})` : '';
    // Guard on trimmed content: tool-call turns emit tool calls (logged
    // separately) and often whitespace-only text, which would otherwise print
    // a blank, confusing "output:" line.
    if (turn.reasoning?.trim()) {
      this.logger.info(
        `[agent] Turn ${turn.turnNumber} reasoning${tag}:\n${truncate(turn.reasoning.trim(), AGENT_LOG_MAX)}`,
      );
    }
    if (turn.responseText?.trim()) {
      this.logger.info(
        `[agent] Turn ${turn.turnNumber} output${tag}:\n${truncate(turn.responseText.trim(), AGENT_LOG_MAX)}`,
      );
    }
  }

  private async dispatchToolUseBlocks(
    toolUseBlocks: Anthropic.Messages.ToolUseBlock[],
    responseContent: Anthropic.Messages.ContentBlock[],
    messages: Anthropic.Messages.MessageParam[],
    turnTrace: TurnTrace,
    toolExecutor: (name: string, input: Record<string, unknown>) => Promise<string>,
    shouldWrapUp: boolean,
  ): Promise<void> {
    messages.push({ role: 'assistant', content: responseContent });

    // Promise.all preserves input order on its output array regardless
    // of which task settles first, so the trace's toolCalls reflect
    // declaration order, not completion order (per Lien Review on #550).
    const executed = await Promise.all(
      toolUseBlocks.map(async block => executeOneToolUse(block, toolExecutor)),
    );
    turnTrace.toolCalls = executed.map(e => e.invocation);
    // Content is a mix of tool_result blocks plus (optionally) the wrap-up text
    // nudge. A user turn may carry both, so type it as ContentBlockParam[] —
    // the previous `as unknown as ToolResultBlockParam` cast lied about the
    // element type for the text block.
    const content: Anthropic.Messages.ContentBlockParam[] = executed.map(e => e.toolResult);

    if (shouldWrapUp) {
      content.push({ type: 'text', text: WRAP_UP_NUDGE });
    }

    messages.push({ role: 'user', content });
  }

  /**
   * Final cheap call asking the model to emit just the findings JSON
   * after the main loop ran out of budget. Returns the parsed result,
   * a TurnTrace for the retry call, and per-call token counts. Returns
   * null if the retry itself fails (logged); the caller falls back to
   * the (empty) findings already extracted.
   */
  private async runSummaryRetry(
    messages: Anthropic.Messages.MessageParam[],
    lastResponse: Anthropic.Messages.Message,
    turn: number,
    tools: Anthropic.Messages.Tool[],
    remainingBudget: number,
  ): Promise<{
    parsed: { findings: AgentFinding[]; summary?: AgentSummary };
    traceTurn: TurnTrace;
    inputTokens: number;
    outputTokens: number;
  } | null> {
    this.logger.info('[agent] No JSON output — requesting summary...');
    await new Promise(resolve => setTimeout(resolve, 3_000));
    appendRetryPrompt(messages, lastResponse);
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: requestMaxTokens(remainingBudget),
        thinking: { type: 'enabled', budget_tokens: THINKING_BUDGET_TOKENS },
        system: [{ type: 'text', text: RETRY_SYSTEM_PROMPT }],
        messages,
        tools,
        // Same forcing as the loop's wrap-up turn: tools present but forbidden,
        // so the model must emit a findings verdict instead of tool-calling.
        tool_choice: { type: 'none' as const },
      });
      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;
      const traceTurn: TurnTrace = {
        turnNumber: turn + 1,
        responseText: joinTextBlocks(response.content),
        reasoning: extractThinking(response.content),
        toolCalls: [],
        finishReason: response.stop_reason ?? undefined,
        inputTokens,
        outputTokens,
      };
      const parsed = extractResponse(response.content);
      return { parsed, traceTurn, inputTokens, outputTokens };
    } catch (err) {
      this.logger.warning(
        `[agent] Summary retry failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}

/**
 * Dispatch a single tool_use block, build its trace invocation and
 * tool_result block. Pulled out so dispatchToolUseBlocks reads
 * top-to-bottom without nested async lambda complexity.
 */
async function executeOneToolUse(
  block: Anthropic.Messages.ToolUseBlock,
  toolExecutor: (name: string, input: Record<string, unknown>) => Promise<string>,
): Promise<{
  invocation: ToolInvocation;
  toolResult: Anthropic.Messages.ToolResultBlockParam;
}> {
  const startedAt = Date.now();
  let result: string;
  try {
    result = await toolExecutor(block.name, block.input as Record<string, unknown>);
  } catch (error) {
    result = `Tool error: ${error instanceof Error ? error.message : String(error)}`;
  }
  return {
    invocation: {
      name: block.name,
      input: block.input,
      output: truncate(result, TRACE_TOOL_OUTPUT_MAX),
      durationMs: Date.now() - startedAt,
    },
    toolResult: {
      type: 'tool_result' as const,
      tool_use_id: block.id,
      content: truncate(result, TOOL_RESULT_MAX_CHARS),
    },
  };
}

/**
 * Append the dummy tool_results + retry instruction the Anthropic API
 * needs to accept the truncated conversation. If the last response had
 * pending tool_use blocks, we have to satisfy them before the user
 * turn or the API rejects the request.
 */
function appendRetryPrompt(
  messages: Anthropic.Messages.MessageParam[],
  lastResponse: Anthropic.Messages.Message,
): void {
  messages.push({ role: 'assistant', content: lastResponse.content });
  const pendingToolUse = lastResponse.content.filter(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
  );
  const retryContent: Anthropic.Messages.ContentBlockParam[] = pendingToolUse.map(b => ({
    type: 'tool_result' as const,
    tool_use_id: b.id,
    content: '[Budget exceeded — tool not executed]',
  }));
  retryContent.push({ type: 'text' as const, text: RETRY_USER_PROMPT });
  messages.push({ role: 'user', content: retryContent });
}

const WRAP_UP_NUDGE =
  'You are running low on budget. Stop investigating and output your findings JSON now. Do not make any more tool calls. If you found no issues, output an empty findings array.';

const RETRY_SYSTEM_PROMPT =
  'Output only a ```json code fence with findings and summary. No other text.';

const RETRY_USER_PROMPT =
  'You ran out of budget before outputting findings. Based on what you investigated so far, output ONLY the JSON block now with your findings and summary. No more tool calls.';

/**
 * Extract findings from the model's final response content.
 *
 * Looks for a ```json ... ``` block in text content and parses it as
 * the agent's structured output containing findings and summary.
 */
function extractResponse(content: Anthropic.Messages.ContentBlock[]): {
  findings: AgentFinding[];
  summary?: AgentSummary;
} {
  const textBlocks = content.filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text');

  if (textBlocks.length === 0) {
    return { findings: [] };
  }

  // Concatenate ALL text blocks — Anthropic can split a response across blocks,
  // so the verdict may not live in the last one.
  const text = textBlocks.map(b => b.text).join('\n');

  // Candidate JSON strings, in priority order: each ```json fence LAST first (a
  // few-shot/example fence precedes the real verdict), then the raw body, then a
  // JSON object embedded in prose. Prefer a candidate carrying a `summary` (the
  // verdict marker) so an example can't beat the real verdict; fall back to the
  // first findings-only candidate if nothing carries a summary.
  const fences = [...text.matchAll(/```json\s*\n([\s\S]*?)\n\s*```/g)].map(m => m[1]).reverse();
  const candidates = [...fences, text.trim(), embeddedJsonObject(text)];

  let fallback: { findings: AgentFinding[] } | undefined;
  for (const candidate of candidates) {
    if (!candidate) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue; // not parseable — try the next candidate
    }
    const { findings, summary } = readVerdict(parsed);
    if (summary) return { findings, summary };
    if (findings.length > 0 && !fallback) fallback = { findings };
  }
  return fallback ?? { findings: [] };
}

/** Pull validated findings + summary out of one parsed JSON verdict (array or object). */
function readVerdict(parsed: unknown): { findings: AgentFinding[]; summary?: AgentSummary } {
  const obj = (parsed ?? {}) as { findings?: unknown; summary?: unknown };
  const rawFindings = Array.isArray(parsed) ? parsed : obj.findings;
  const findings = (Array.isArray(rawFindings) ? rawFindings : []).filter(isValidFinding);
  const summary = isValidSummary(obj.summary) ? obj.summary : undefined;
  return { findings, summary };
}

/** First `{`…last `}` slice — recovers a JSON object wrapped in prose. */
function embeddedJsonObject(content: string): string | undefined {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  return start !== -1 && end > start ? content.slice(start, end + 1) : undefined;
}

/** Type guard to validate a summary object. */
function isValidSummary(value: unknown): value is AgentSummary {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.riskLevel === 'string' &&
    typeof obj.overview === 'string' &&
    Array.isArray(obj.keyChanges)
  );
}

/** Type guard to validate an agent finding has required fields. */
function isValidFinding(value: unknown): value is AgentFinding {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.filepath === 'string' &&
    typeof obj.line === 'number' &&
    (obj.severity === 'error' || obj.severity === 'warning') &&
    typeof obj.category === 'string' &&
    typeof obj.message === 'string'
  );
}
