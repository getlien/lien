/**
 * OpenAI-compatible agentic tool_calls loop for the review agent.
 *
 * Works with any OpenAI-compatible API (OpenRouter, Gemini, DeepSeek, etc.)
 * using the standard chat completions format with tool_calls.
 */

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
 * ~24K chars ≈ 6K tokens — enough context for a review, bounded per call.
 */
const TOOL_RESULT_MAX_CHARS = 24_000;

const WRAP_UP_NUDGE =
  'You are running low on budget. Stop investigating and output your findings JSON now. Do not make any more tool calls. If you found no issues, output an empty findings array.';

const RETRY_NUDGE =
  'You ran out of budget. Output ONLY the JSON block now with your findings and summary. No tool calls.';

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]` : s;
}

/**
 * Parse + validate a tool call's JSON arguments. Returns the parsed
 * input on success, throws on parse failure or non-object payload (a
 * cleaner surface than letting the executor crash on a primitive cast).
 */
function parseToolArguments(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Invalid tool arguments JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    const got = parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed;
    throw new Error(`Invalid tool arguments: expected JSON object, got ${got}`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Assemble a per-turn trace entry from a chat-completion choice.
 * Pulled out of `run()` so the turn-trace shape can grow (e.g. the
 * reasoning field added in #552) without bumping the loop body's
 * time-to-understand against the complexity threshold.
 */
function buildTurnTrace(
  turnNumber: number,
  choice: ChatResponse['choices'][number],
  inputTokens: number,
  outputTokens: number,
): TurnTrace {
  return {
    turnNumber,
    responseText: choice.message.content ?? '',
    // OpenRouter surfaces extended-reasoning prose here for models like
    // gemini-3-flash-preview; on tool-calling turns this is where the
    // model's intermediate thinking lives (#552).
    reasoning: choice.message.reasoning ?? undefined,
    toolCalls: [],
    finishReason: choice.finish_reason,
    inputTokens,
    outputTokens,
  };
}

/** Build a ToolInvocation from a tool call's name, parsed input, and raw output. */
function buildInvocation(
  name: string,
  rawArgs: string,
  parsed: unknown,
  output: string,
  startedAt: number,
): ToolInvocation {
  return {
    name,
    // Keep the raw args string on parse-failure so the trace shows the
    // exact malformed payload rather than `null`.
    input: parsed === undefined ? rawArgs : parsed,
    output: truncate(output, TRACE_TOOL_OUTPUT_MAX),
    durationMs: Date.now() - startedAt,
  };
}

/** Default Gemini Flash pricing via OpenRouter: $0.30/$2.50 per MTok. */
const DEFAULT_INPUT_COST_PER_MTOK = 0.3;
const DEFAULT_OUTPUT_COST_PER_MTOK = 2.5;

interface OpenAIClientOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  inputCostPerMTok?: number;
  outputCostPerMTok?: number;
  maxTurns: number;
  maxTokenBudget: number;
  logger: Logger;
}

// ---------------------------------------------------------------------------
// OpenAI types (minimal — just what we need, no SDK dependency)
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface ToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface ChatResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      /**
       * Extended-reasoning prose, surfaced by OpenRouter for models
       * with reasoning support (e.g. gemini-3-flash-preview when we
       * pass `reasoning: { effort: 'high' }`). Lives separate from
       * `content`, which on tool-calling turns is typically null.
       */
      reasoning?: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

/**
 * OpenAI-compatible agent client that runs a tool_calls loop.
 */
export class OpenAIAgentClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private maxTurns: number;
  private maxTokenBudget: number;
  private logger: Logger;
  private inputCostPerToken: number;
  private outputCostPerToken: number;
  // Verbose per-turn reasoning/output logging, gated by env so normal runs
  // stay readable. The last turn's reasoning is always logged on an
  // incomplete run (see below) regardless of this flag.
  private logAgentTurns: boolean;

  constructor(options: OpenAIClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl;
    this.model = options.model;
    this.maxTurns = options.maxTurns;
    this.maxTokenBudget = options.maxTokenBudget;
    this.logger = options.logger;
    this.logAgentTurns = !!process.env.LIEN_REVIEW_LOG_AGENT;
    this.inputCostPerToken = (options.inputCostPerMTok ?? DEFAULT_INPUT_COST_PER_MTOK) / 1_000_000;
    this.outputCostPerToken =
      (options.outputCostPerMTok ?? DEFAULT_OUTPUT_COST_PER_MTOK) / 1_000_000;
  }

  async run(
    systemPrompt: string,
    initialMessage: string,
    tools: ToolDef[],
    toolExecutor: (name: string, input: Record<string, unknown>) => Promise<string>,
  ): Promise<AgentResult> {
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: initialMessage },
    ];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let turn = 0;
    let lastContent: string | null = null;
    const turnTraces: TurnTrace[] = [];
    // Defaults to 'max_turns': if the loop exits via its `while` condition
    // without any explicit break below, the turn budget was the limit.
    let stopReason: AgentStopReason = 'max_turns';
    // Once near budget we drop the tools so the model is *forced* to emit its
    // verdict next turn. Kimi otherwise ignores the soft wrap-up nudge and
    // keeps tool-calling until the hard cap, bailing without findings.
    let forceFinish = false;

    while (turn < this.maxTurns) {
      turn++;

      const response = await this.chatCompletion(messages, tools, forceFinish);

      const turnInputTokens = response.usage?.prompt_tokens ?? 0;
      const turnOutputTokens = response.usage?.completion_tokens ?? 0;
      totalInputTokens += turnInputTokens;
      totalOutputTokens += turnOutputTokens;

      const totalTokens = totalInputTokens + totalOutputTokens;
      const choice = response.choices[0];

      this.logger.info(
        `[agent] Turn ${turn}: finish_reason=${choice.finish_reason}, tokens=${totalTokens}`,
      );

      // Log tool calls
      if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
        const toolNames = choice.message.tool_calls.map(tc => tc.function.name).join(', ');
        this.logger.info(`[agent] Turn ${turn} tools: ${toolNames}`);
      }

      lastContent = choice.message.content;
      const turnTrace = buildTurnTrace(turn, choice, turnInputTokens, turnOutputTokens);
      turnTraces.push(turnTrace);
      if (this.logAgentTurns) this.logTurn(turnTrace);

      // Done: model finished naturally
      if (choice.finish_reason === 'stop') {
        stopReason = 'completed';
        break;
      }

      // Budget exceeded
      if (totalTokens >= this.maxTokenBudget) {
        this.logger.warning(
          `[agent] Token budget exceeded (${totalTokens}/${this.maxTokenBudget}), stopping`,
        );
        stopReason = 'budget';
        break;
      }

      // Approaching budget or last turn — nudge to wrap up.
      // Threshold kept below the hard cap with headroom so a single capped
      // tool result can't skip past the wrap-up window into the hard stop.
      const nearBudget = totalTokens >= this.maxTokenBudget * 0.6;
      const lastTurn = turn >= this.maxTurns - 1;

      // Process tool calls
      if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
        await this.dispatchToolCalls(
          choice.message.tool_calls,
          choice.message.content,
          messages,
          turnTrace,
          toolExecutor,
        );
        if (nearBudget || lastTurn) {
          messages.push({ role: 'user', content: WRAP_UP_NUDGE });
          // Next turn runs without tools so the model must produce findings.
          forceFinish = true;
        }
      } else {
        this.logger.warning(`[agent] Unexpected finish_reason: ${choice.finish_reason}, stopping`);
        stopReason = 'error';
        break;
      }
    }

    if (turn >= this.maxTurns) {
      this.logger.warning(`[agent] Max turns reached (${this.maxTurns}), stopping`);
    }

    // Capture the last *investigation* turn before the summary-retry appends
    // its own (reasoning-less) trace — that's what we want to surface on bail.
    const lastLoopTurn = turnTraces[turnTraces.length - 1];

    let parsed = extractResponse(lastContent);
    // Fire the summary-retry whenever we have *any* loop history but no
    // findings JSON. The previous guard `lastContent !== null` skipped
    // retry whenever the model emitted reasoning but null content — the
    // exact case gemini-3-flash-preview produces when it ends a turn
    // with finish_reason=tool_calls but no actual tool_calls (its
    // mid-investigation reasoning lives in the separate `reasoning`
    // field, not `content`). Result: silent-bail failures on rules
    // whose runs the model was actively investigating. Trace evidence
    // gathered after #553 — see PR description.
    if (!parsed.summary && turn > 0) {
      const retry = await this.runSummaryRetry(messages, turn);
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

    // Incomplete = the loop bailed on a limit (or error) AND never produced a
    // verdict (no summary, even after the retry). Such a run must not be shown
    // as a clean review.
    const incomplete = stopReason !== 'completed' && !parsed.summary;
    if (incomplete) {
      this.logger.warning(
        `[agent] Review incomplete (stopReason=${stopReason}, no summary after ${turn} turns)`,
      );
      // Always surface what the agent was doing when it bailed — the single
      // most useful datum for diagnosing an incomplete run in CI logs.
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
   * Append the assistant's tool_calls turn to the message history,
   * dispatch each tool, record its invocation on the trace, and append
   * the tool_result messages. Pulled out of `run()` to keep its
   * time-to-understand under the complexity threshold.
   */
  private async dispatchToolCalls(
    toolCalls: ToolCall[],
    assistantContent: string | null,
    messages: ChatMessage[],
    turnTrace: TurnTrace,
    toolExecutor: (name: string, input: Record<string, unknown>) => Promise<string>,
  ): Promise<void> {
    messages.push({
      role: 'assistant',
      content: assistantContent,
      tool_calls: toolCalls,
    });
    for (const tc of toolCalls) {
      const startedAt = Date.now();
      let parsed: Record<string, unknown> | undefined;
      let result: string;
      try {
        parsed = parseToolArguments(tc.function.arguments);
        result = await toolExecutor(tc.function.name, parsed);
      } catch (error) {
        result = `Tool error: ${error instanceof Error ? error.message : String(error)}`;
      }
      turnTrace.toolCalls.push(
        buildInvocation(tc.function.name, tc.function.arguments, parsed, result, startedAt),
      );
      messages.push({
        role: 'tool',
        content: truncate(result, TOOL_RESULT_MAX_CHARS),
        tool_call_id: tc.id,
      });
    }
  }

  /**
   * Final cheap call asking the model to emit just the findings JSON
   * after the main loop ran out of budget. Returns the parsed result,
   * a TurnTrace for the retry call, and per-call token counts. Returns
   * null if the retry itself fails (logged); the caller falls back to
   * the (empty) findings already extracted.
   */
  private async runSummaryRetry(
    messages: ChatMessage[],
    turn: number,
  ): Promise<{
    parsed: { findings: AgentFinding[]; summary?: AgentSummary };
    traceTurn: TurnTrace;
    inputTokens: number;
    outputTokens: number;
  } | null> {
    this.logger.info('[agent] No JSON output — requesting summary...');
    await new Promise(resolve => setTimeout(resolve, 3_000));
    messages.push({ role: 'user', content: RETRY_NUDGE });
    try {
      const response = await this.chatCompletion(messages, []);
      const inputTokens = response.usage?.prompt_tokens ?? 0;
      const outputTokens = response.usage?.completion_tokens ?? 0;
      const choice = response.choices[0];
      const traceTurn: TurnTrace = {
        turnNumber: turn + 1,
        responseText: choice?.message.content ?? '',
        reasoning: choice?.message.reasoning ?? undefined,
        toolCalls: [],
        finishReason: choice?.finish_reason,
        inputTokens,
        outputTokens,
      };
      const parsed = extractResponse(choice?.message.content);
      return { parsed, traceTurn, inputTokens, outputTokens };
    } catch (err) {
      this.logger.warning(
        `[agent] Summary retry failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Print a turn's reasoning + output to the logger so CI logs show what the
   * agent was actually thinking. Truncated so a verbose reasoning model (Kimi)
   * doesn't flood the log.
   */
  private logTurn(turn: TurnTrace | undefined, label?: string): void {
    if (!turn) return;
    const tag = label ? ` (${label})` : '';
    if (turn.reasoning) {
      this.logger.info(
        `[agent] Turn ${turn.turnNumber} reasoning${tag}:\n${truncate(turn.reasoning, AGENT_LOG_MAX)}`,
      );
    }
    if (turn.responseText) {
      this.logger.info(
        `[agent] Turn ${turn.turnNumber} output${tag}:\n${truncate(turn.responseText, AGENT_LOG_MAX)}`,
      );
    }
  }

  private async chatCompletion(
    messages: ChatMessage[],
    tools: ToolDef[],
    forceNoTools = false,
  ): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      max_tokens: 16384,
      temperature: 0,
      reasoning: { effort: 'high' },
    };
    if (tools.length > 0) {
      body.tools = tools;
      // tool_choice:'none' forbids tool calls server-side, forcing a text
      // (findings) response. An empty tools array is too weak — the model
      // still emits tool calls it learned from the system prompt.
      if (forceNoTools) body.tool_choice = 'none';
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://lien.dev',
        'X-Title': 'Lien Review',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`API error (${response.status}): ${err}`);
    }

    return (await response.json()) as ChatResponse;
  }
}

// ---------------------------------------------------------------------------
// Convert Anthropic tool defs to OpenAI format
// ---------------------------------------------------------------------------

export function toOpenAITools(
  anthropicTools: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>,
): ToolDef[] {
  return anthropicTools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

// ---------------------------------------------------------------------------
// Response parsing (same as anthropic-client.ts)
// ---------------------------------------------------------------------------

function extractResponse(content: string | null): {
  findings: AgentFinding[];
  summary?: AgentSummary;
} {
  if (!content) return { findings: [] };

  const jsonMatch = content.match(/```json\s*\n([\s\S]*?)\n\s*```/);
  if (!jsonMatch) return { findings: [] };

  try {
    const parsed = JSON.parse(jsonMatch[1]);
    const findings: unknown[] = Array.isArray(parsed) ? parsed : (parsed.findings ?? []);
    const summary = isValidSummary(parsed.summary) ? parsed.summary : undefined;
    return { findings: findings.filter(isValidFinding), summary };
  } catch {
    return { findings: [] };
  }
}

function isValidSummary(value: unknown): value is AgentSummary {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.riskLevel === 'string' &&
    typeof obj.overview === 'string' &&
    Array.isArray(obj.keyChanges)
  );
}

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
