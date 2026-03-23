/**
 * Anthropic agentic tool_use loop for the review agent.
 *
 * Wraps @anthropic-ai/sdk to run a multi-turn conversation where the model
 * can call tools to investigate the codebase. Accumulates usage across turns
 * and parses the final JSON findings from the model's text output.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Logger } from '../../logger.js';
import type { AgentFinding, AgentSummary, AgentResult } from './types.js';

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

  constructor(options: AgentClientOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
    });
    this.model = options.model;
    this.maxTurns = options.maxTurns;
    this.maxTokenBudget = options.maxTokenBudget;
    this.logger = options.logger;
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

    while (turn < this.maxTurns) {
      turn++;

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 8192,
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages,
        tools,
      });

      lastResponse = response;

      // Accumulate usage
      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

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

      // Done: model finished naturally
      if (response.stop_reason === 'end_turn') {
        break;
      }

      // Hard budget exceeded — stop immediately
      if (totalTokens >= this.maxTokenBudget) {
        this.logger.warning(
          `[agent] Token budget exceeded (${totalTokens}/${this.maxTokenBudget}), stopping`,
        );
        break;
      }

      // Approaching budget or last turn — tell the agent to wrap up
      const nearBudget = totalTokens >= this.maxTokenBudget * 0.7;
      const lastTurn = turn >= this.maxTurns - 1;
      const shouldWrapUp = nearBudget || lastTurn;

      // Process tool_use blocks
      if (response.stop_reason === 'tool_use' && toolUseBlocks.length > 0) {
        // Append assistant message with all content blocks
        messages.push({ role: 'assistant', content: response.content });

        // Execute each tool and collect results
        const toolResults: Anthropic.Messages.ToolResultBlockParam[] = await Promise.all(
          toolUseBlocks.map(async block => {
            let result: string;
            try {
              result = await toolExecutor(block.name, block.input as Record<string, unknown>);
            } catch (error) {
              result = `Tool error: ${error instanceof Error ? error.message : String(error)}`;
            }
            return {
              type: 'tool_result' as const,
              tool_use_id: block.id,
              content: result,
            };
          }),
        );

        // Nudge the agent to wrap up when budget is running low
        if (shouldWrapUp) {
          toolResults.push({
            type: 'text',
            text: 'You are running low on budget. Stop investigating and output your findings JSON now. Do not make any more tool calls. If you found no issues, output an empty findings array.',
          } as unknown as Anthropic.Messages.ToolResultBlockParam);
        }

        messages.push({ role: 'user', content: toolResults });
      } else {
        // Unexpected stop reason (max_tokens, stop_sequence, etc.) — stop looping
        this.logger.warning(`[agent] Unexpected stop_reason: ${response.stop_reason}, stopping`);
        break;
      }
    }

    if (turn >= this.maxTurns) {
      this.logger.warning(`[agent] Max turns reached (${this.maxTurns}), stopping`);
    }

    // Parse findings and summary from the final response
    const parsed = lastResponse ? extractResponse(lastResponse.content) : { findings: [] };

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
}

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

  const text = textBlocks[textBlocks.length - 1].text;

  const jsonMatch = text.match(/```json\s*\n([\s\S]*?)\n\s*```/);
  if (!jsonMatch) {
    return { findings: [] };
  }

  try {
    const parsed = JSON.parse(jsonMatch[1]);

    const findings: unknown[] = Array.isArray(parsed) ? parsed : (parsed.findings ?? []);
    const summary = isValidSummary(parsed.summary) ? parsed.summary : undefined;

    return { findings: findings.filter(isValidFinding), summary };
  } catch {
    return { findings: [] };
  }
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
