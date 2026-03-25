/**
 * OpenAI-compatible agentic tool_calls loop for the review agent.
 *
 * Works with any OpenAI-compatible API (OpenRouter, Gemini, DeepSeek, etc.)
 * using the standard chat completions format with tool_calls.
 */

import type { Logger } from '../../logger.js';
import type { AgentFinding, AgentSummary, AgentResult } from './types.js';

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
    message: { role: string; content: string | null; tool_calls?: ToolCall[] };
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

  constructor(options: OpenAIClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl;
    this.model = options.model;
    this.maxTurns = options.maxTurns;
    this.maxTokenBudget = options.maxTokenBudget;
    this.logger = options.logger;
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

    while (turn < this.maxTurns) {
      turn++;

      const response = await this.chatCompletion(messages, tools);

      totalInputTokens += response.usage?.prompt_tokens ?? 0;
      totalOutputTokens += response.usage?.completion_tokens ?? 0;

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

      // Done: model finished naturally
      if (choice.finish_reason === 'stop') {
        break;
      }

      // Budget exceeded
      if (totalTokens >= this.maxTokenBudget) {
        this.logger.warning(
          `[agent] Token budget exceeded (${totalTokens}/${this.maxTokenBudget}), stopping`,
        );
        break;
      }

      // Approaching budget or last turn — nudge to wrap up
      const nearBudget = totalTokens >= this.maxTokenBudget * 0.7;
      const lastTurn = turn >= this.maxTurns - 1;

      // Process tool calls
      if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
        // Add assistant message with tool calls
        messages.push({
          role: 'assistant',
          content: choice.message.content,
          tool_calls: choice.message.tool_calls,
        });

        // Execute each tool and add results
        for (const tc of choice.message.tool_calls) {
          let result: string;
          try {
            const input = JSON.parse(tc.function.arguments);
            result = await toolExecutor(tc.function.name, input);
          } catch (error) {
            result = `Tool error: ${error instanceof Error ? error.message : String(error)}`;
          }
          messages.push({
            role: 'tool',
            content: result,
            tool_call_id: tc.id,
          });
        }

        // Nudge to wrap up if near budget
        if (nearBudget || lastTurn) {
          messages.push({
            role: 'user',
            content:
              'You are running low on budget. Stop investigating and output your findings JSON now. Do not make any more tool calls. If you found no issues, output an empty findings array.',
          });
        }
      } else {
        this.logger.warning(`[agent] Unexpected finish_reason: ${choice.finish_reason}, stopping`);
        break;
      }
    }

    if (turn >= this.maxTurns) {
      this.logger.warning(`[agent] Max turns reached (${this.maxTurns}), stopping`);
    }

    // Parse findings from the final response
    let parsed = extractResponse(lastContent);

    // If no JSON output, request summary
    if (!parsed.summary && lastContent !== null) {
      this.logger.info('[agent] No JSON output — requesting summary...');
      await new Promise(resolve => setTimeout(resolve, 3_000));

      // Add a wrap-up request
      messages.push({
        role: 'user',
        content:
          'You ran out of budget. Output ONLY the JSON block now with your findings and summary. No tool calls.',
      });

      try {
        const retryResponse = await this.chatCompletion(messages, []);
        totalInputTokens += retryResponse.usage?.prompt_tokens ?? 0;
        totalOutputTokens += retryResponse.usage?.completion_tokens ?? 0;

        const retryParsed = extractResponse(retryResponse.choices[0]?.message.content);
        if (retryParsed.summary || retryParsed.findings.length > 0) {
          parsed = retryParsed;
        }
      } catch (err) {
        this.logger.warning(
          `[agent] Summary retry failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const cost =
      totalInputTokens * this.inputCostPerToken + totalOutputTokens * this.outputCostPerToken;

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
    };
  }

  private async chatCompletion(messages: ChatMessage[], tools: ToolDef[]): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      max_tokens: 8192,
      temperature: 0,
    };
    if (tools.length > 0) {
      body.tools = tools;
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
