/**
 * OpenAI-compatible agentic tool_calls loop for the review agent.
 *
 * Works with any OpenAI-compatible API (OpenRouter, Gemini, DeepSeek, etc.)
 * using the standard chat completions format with tool_calls.
 */

import type { Logger } from '../../logger.js';
import { DEFAULT_PROVIDER_ROUTING, DEFAULT_CHAT_REQUEST_TIMEOUT_MS } from '../../defaults.js';
import type {
  AgentFinding,
  AgentSummary,
  AgentResult,
  AgentStopReason,
  TurnTrace,
  ToolInvocation,
} from './types.js';
import {
  TRACE_TOOL_OUTPUT_MAX,
  TOOL_RESULT_MAX_CHARS,
  WRAP_UP_NUDGE,
  truncate,
  envDisabled,
  logTurn,
  extractFindingsFromText,
} from './agent-client-shared.js';

// `envDisabled` is re-exported so its existing test import path
// (`plugins-agent-budget.test.ts`) stays valid after the move to the shared
// module — the parsing behavior it guards is unchanged.
export { envDisabled };

const RETRY_NUDGE =
  'You ran out of budget. Output ONLY the JSON block now with your findings and summary. No tool calls.';

/**
 * Transient-failure retry for the chat endpoint. OpenRouter/Kimi intermittently
 * returns a 200 with an empty/truncated body, a 429/5xx, or hangs the
 * connection — all recover on a retry. 2 attempts (one retry) absorbs flakes
 * while keeping worst-case latency bounded on a genuine outage.
 */
const CHAT_MAX_ATTEMPTS = 2;
const CHAT_RETRY_BASE_DELAY_MS = 500;
// Per-request abort timeout (headers + body) is per-instance and configurable —
// see `requestTimeoutMs` / DEFAULT_CHAT_REQUEST_TIMEOUT_MS.

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Rough token estimate from a serialized request body (~4 chars/token). */
const approxTokens = (bytes: number): number =>
  Number.isFinite(bytes) ? Math.round(bytes / 4) : 0;

/**
 * Build the diagnostic message for a request that hit the abort timeout. The
 * bare AbortError ("This operation was aborted") says nothing about why — this
 * surfaces how long we waited vs the limit, which phase hung (connection/headers
 * vs body read), and how big the request was, so a reader can tell a genuinely
 * slow/hung Kimi turn from an early provider reset or a ballooned context.
 * Exported for unit testing.
 */
export function formatChatTimeout(opts: {
  elapsedMs: number;
  limitMs: number;
  phase: 'connection/headers' | 'body read';
  bodyBytes: number;
  messageCount: number;
}): string {
  return (
    `timed out after ${opts.elapsedMs}ms (limit ${opts.limitMs}ms) during ${opts.phase} — ` +
    `request was ${opts.bodyBytes} bytes (~${approxTokens(opts.bodyBytes)} input tokens) ` +
    `across ${opts.messageCount} message(s)`
  );
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
  /**
   * OpenRouter `provider` routing block, sent verbatim on each request. Defaults
   * to DEFAULT_PROVIDER_ROUTING; pass `null` to send no routing preferences.
   */
  providerRouting?: Record<string, unknown> | null;
  /** Per-request abort timeout in ms. Defaults to DEFAULT_CHAT_REQUEST_TIMEOUT_MS. */
  requestTimeoutMs?: number;
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
  /**
   * OpenRouter routing metadata — names the upstream provider that actually
   * served the request. `endpoints.available[]` marks the selected one;
   * `attempt` > 1 means earlier providers failed and it fell back. Used only
   * for diagnostic logging (see describeServingProvider).
   */
  openrouter_metadata?: {
    summary?: string;
    attempt?: number;
    endpoints?: { available?: Array<{ provider?: string; selected?: boolean }> };
    attempts?: Array<{ provider?: string; status?: number }>;
  };
  /** Older/simpler top-level provider name some responses carry. */
  provider?: string;
}

/**
 * Extract a short "who served this" label from an OpenRouter response for
 * per-request logging. Prefers the selected endpoint's provider, then the last
 * attempt, then the top-level `provider`, then the human `summary`. Appends the
 * attempt number when it fell back (attempt > 1). Returns 'unknown' if the
 * response carried no routing metadata.
 */
export function describeServingProvider(
  resp: Pick<ChatResponse, 'openrouter_metadata' | 'provider'>,
): string {
  const meta = resp.openrouter_metadata;
  const selected = meta?.endpoints?.available?.find(e => e.selected)?.provider;
  const lastAttempt = meta?.attempts?.[meta.attempts.length - 1]?.provider;
  const name = selected ?? lastAttempt ?? resp.provider ?? meta?.summary ?? 'unknown';
  const attempt = meta?.attempt ?? 0;
  return attempt > 1 ? `${name} (attempt ${attempt}, fell back)` : name;
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
  /** OpenRouter `provider` routing block sent on each request (null = omit). */
  private providerRouting: Record<string, unknown> | null;
  /** Per-request abort timeout (ms). */
  private requestTimeoutMs: number;
  // Verbose per-turn reasoning/output logging — ON by default so every review
  // is diagnosable; set LIEN_REVIEW_LOG_AGENT=0 (or false) to silence it. The
  // last turn's reasoning is always logged on an incomplete run regardless.
  private logAgentTurns: boolean;

  constructor(options: OpenAIClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl;
    this.model = options.model;
    this.maxTurns = options.maxTurns;
    this.maxTokenBudget = options.maxTokenBudget;
    this.logger = options.logger;
    this.logAgentTurns = !envDisabled(process.env.LIEN_REVIEW_LOG_AGENT);
    this.inputCostPerToken = (options.inputCostPerMTok ?? DEFAULT_INPUT_COST_PER_MTOK) / 1_000_000;
    this.outputCostPerToken =
      (options.outputCostPerMTok ?? DEFAULT_OUTPUT_COST_PER_MTOK) / 1_000_000;
    // Explicit config wins on any endpoint (opt-in). When unset, the default
    // routing applies ONLY to OpenRouter — other OpenAI-compatible endpoints
    // (Gemini/DeepSeek direct) reject an unknown top-level `provider` field, so
    // omit it there. `null` explicitly omits it anywhere.
    this.providerRouting =
      options.providerRouting !== undefined
        ? options.providerRouting
        : options.baseUrl.includes('openrouter.ai')
          ? DEFAULT_PROVIDER_ROUTING
          : null;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_CHAT_REQUEST_TIMEOUT_MS;
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

      let response: ChatResponse;
      try {
        response = await this.chatCompletion(messages, tools, forceFinish);
      } catch (err) {
        // Transient failures are already retried inside chatCompletion; a throw
        // here means it gave up. End the run gracefully (stopReason 'error' → no
        // summary → incomplete notice) rather than crashing the whole plugin.
        this.logger.warning(
          `[agent] chat request failed after retries (${err instanceof Error ? err.message : String(err)}); ending run`,
        );
        stopReason = 'error';
        break;
      }

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
      if (this.logAgentTurns) logTurn(this.logger, turnTrace);

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
          // Next turn is forced to emit a JSON verdict (no tools).
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

    // Incomplete = the agent never produced a structured verdict (no summary,
    // even after the retry). A genuine clean review always carries a summary, so
    // the ABSENCE of one — not the stop reason — is what marks a run incomplete.
    // Critically this also catches a `finish_reason: 'stop'` turn that emitted
    // prose instead of the findings JSON (the model "completed" but delivered no
    // verdict): that must NOT be reported as a clean 0-findings review.
    const incomplete = !parsed.summary;
    if (incomplete) {
      this.logger.warning(
        `[agent] Review incomplete (stopReason=${stopReason}, no verdict/summary after ${turn} turns)`,
      );
      // Always surface what the agent was doing when it bailed — the single
      // most useful datum for diagnosing an incomplete run in CI logs.
      logTurn(this.logger, lastLoopTurn, 'last turn before bail');
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
      // forceVerdict: response_format:json_object guarantees a JSON response,
      // the reliable safety net when the loop bailed without a verdict.
      const response = await this.chatCompletion(messages, [], true);
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

  private async chatCompletion(
    messages: ChatMessage[],
    tools: ToolDef[],
    forceVerdict = false,
  ): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      // Headroom so a multi-finding verdict completes instead of truncating
      // mid-JSON (a truncated verdict is unparseable and wastes the whole run).
      max_tokens: 24_576,
      temperature: 0,
      // High reasoning drives investigation quality, but on the forced-verdict
      // turn the findings are already decided — high effort there just makes the
      // model re-reason and ramble into the JSON (blowing the output cap). Use
      // low effort to emit the verdict concisely.
      reasoning: { effort: forceVerdict ? 'low' : 'high' },
    };
    if (forceVerdict) {
      // Force a JSON verdict (no tools). response_format:json_object makes the
      // output be a JSON object — the model cannot emit tool calls. It's more
      // reliably honored across OpenRouter providers than tool_choice:'none'
      // (which a Kimi provider ignored mid-investigation), and an empty tools
      // array is too weak (the model still emits tool calls from the prompt).
      body.response_format = { type: 'json_object' };
    } else if (tools.length > 0) {
      body.tools = tools;
    }
    // Steer OpenRouter routing (e.g. prefer fastest providers) to cut the
    // intermittent upstream timeouts. Omitted when providerRouting is null.
    if (this.providerRouting) body.provider = this.providerRouting;

    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= CHAT_MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) await sleep(CHAT_RETRY_BASE_DELAY_MS * (attempt - 1));

      let res: { ok: boolean; status: number; text: string; elapsedMs: number };
      try {
        res = await this.postChat(body);
      } catch (err) {
        // Network error, or the abort timeout firing on a hung connection
        // (header OR body stream). Transient — retry.
        lastError = new Error(
          `Request to ${this.model} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        this.logger.warning(`[agent] ${lastError.message} — retry ${attempt}/${CHAT_MAX_ATTEMPTS}`);
        continue;
      }

      if (!res.ok) {
        // 429/5xx are transient — retry; other 4xx are fatal (bad request/auth).
        if (res.status === 429 || res.status >= 500) {
          lastError = new Error(`API error (${res.status}): ${truncate(res.text, 200)}`);
          this.logger.warning(
            `[agent] ${lastError.message} — retry ${attempt}/${CHAT_MAX_ATTEMPTS}`,
          );
          continue;
        }
        throw new Error(`API error (${res.status}): ${res.text}`);
      }

      // Parse defensively: an empty/truncated 200 body would otherwise throw a
      // bare "Unexpected end of JSON input" and crash the review. Retry it.
      if (!res.text.trim()) {
        lastError = new Error(`Empty response body from ${this.model} (status ${res.status})`);
        this.logger.warning(`[agent] ${lastError.message} — retry ${attempt}/${CHAT_MAX_ATTEMPTS}`);
        continue;
      }
      try {
        const parsed = JSON.parse(res.text) as ChatResponse;
        // Per-request diagnostics: which upstream provider served this, and how
        // long it took — so slow/aborted turns can be traced to a provider.
        if (this.logAgentTurns) {
          this.logger.info(
            `[agent] served by ${describeServingProvider(parsed)} in ${res.elapsedMs}ms`,
          );
        }
        return parsed;
      } catch {
        lastError = new Error(
          `Unparseable response body from ${this.model} (status ${res.status}): ${truncate(res.text, 200)}`,
        );
        this.logger.warning(`[agent] ${lastError.message} — retry ${attempt}/${CHAT_MAX_ATTEMPTS}`);
      }
    }

    throw lastError ?? new Error(`chatCompletion failed for ${this.model}`);
  }

  /**
   * POST the chat request and read the FULL body under a single abort timeout,
   * so a hang in either the headers or the body stream rejects (and is retried)
   * rather than stalling the turn indefinitely (the body read was previously
   * outside the timeout, which let a hung stream hang the whole review).
   */
  private async postChat(
    body: Record<string, unknown>,
  ): Promise<{ ok: boolean; status: number; text: string; elapsedMs: number }> {
    const payload = JSON.stringify(body);
    const messageCount = Array.isArray(body.messages) ? body.messages.length : 0;
    const bodyBytes = Buffer.byteLength(payload, 'utf8'); // true UTF-8 size, not UTF-16 units

    const controller = new AbortController();
    let timedOut = false;
    // Stamp the start instant right as the timeout window opens (before the timer
    // is armed and the request begins) so reported elapsed lines up with the limit.
    const startedAt = Date.now();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.requestTimeoutMs);
    // Track which phase is in flight so a timeout can report whether the hang was
    // before the response headers arrived or during the body stream.
    let phase: 'connection/headers' | 'body read' = 'connection/headers';

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://lien.dev',
          'X-Title': 'Lien Review',
        },
        body: payload,
        signal: controller.signal,
      });
      phase = 'body read';
      const text = await response.text();
      return { ok: response.ok, status: response.status, text, elapsedMs: Date.now() - startedAt };
    } catch (err) {
      // The controller is aborted only by our own timer, so any abort here is a
      // timeout — replace the opaque AbortError with actionable diagnostics.
      if (timedOut) {
        throw new Error(
          formatChatTimeout({
            elapsedMs: Date.now() - startedAt,
            limitMs: this.requestTimeoutMs,
            phase,
            bodyBytes,
            messageCount,
          }),
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
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
// Response parsing
// ---------------------------------------------------------------------------

/**
 * Extract findings from a chat completion's message content, delegating to the
 * shared fence-priority recovery pipeline (see `extractFindingsFromText`). A
 * null/empty content (e.g. a tool-calls turn) yields no findings.
 */
function extractResponse(content: string | null): {
  findings: AgentFinding[];
  summary?: AgentSummary;
} {
  return content ? extractFindingsFromText(content) : { findings: [] };
}
