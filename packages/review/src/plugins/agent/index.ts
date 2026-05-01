/**
 * Agent Review plugin — agentic code review using Anthropic tool_use.
 *
 * Replaces the bug finder, architectural, and summary plugins with a single
 * agent that investigates PRs autonomously using Lien's code analysis tools.
 * Produces bugs, architectural observations, and a risk summary in one run.
 */

import { z } from 'zod';

import type {
  ReviewPlugin,
  ReviewContext,
  ReviewFinding,
  PresentContext,
} from '../../plugin-types.js';
import { buildDependencyGraph } from '../../dependency-graph.js';
import { computeBlastRadius } from '../../blast-radius.js';
import type { Logger } from '../../logger.js';

import type { AgentConfig, AgentFinding, AgentResult } from './types.js';
import { AnthropicAgentClient } from './anthropic-client.js';
import { OpenAIAgentClient, toOpenAITools } from './openai-client.js';
import { buildSystemPrompt, buildInitialMessage } from './system-prompt.js';
import { BUILTIN_RULES, buildTriggerContext, selectRules } from './rules.js';
import { AGENT_TOOLS, dispatchTool } from './tools.js';

const configSchema = z.object({
  apiKey: z.string().min(1),
  model: z.string().default('google/gemini-3-flash-preview'),
  /** 'openai' for OpenRouter/Gemini/DeepSeek, 'anthropic' for Claude */
  provider: z.enum(['openai', 'anthropic']).default('openai'),
  baseUrl: z.string().default('https://openrouter.ai/api/v1'),
  inputCostPerMTok: z.number().optional(),
  outputCostPerMTok: z.number().optional(),
  maxTurns: z.number().int().min(1).max(30).default(15),
  maxTokenBudget: z.number().int().default(100_000),
  // Legacy — maps to apiKey
  anthropicApiKey: z.string().optional(),
  blastRadius: z
    .object({
      enabled: z.boolean().default(true),
      depth: z.number().int().min(1).max(4).default(2),
      maxNodes: z.number().int().min(5).max(200).default(30),
      maxSeeds: z.number().int().min(1).max(20).default(8),
    })
    .optional(),
});

export interface AgentReviewPluginOptions {
  id?: string;
  name?: string;
}

export class AgentReviewPlugin implements ReviewPlugin {
  id: string;
  name: string;
  description = 'AI-powered agentic code review using Anthropic-compatible tool_use';
  requiresLLM = false;
  requiresRepoChunks = true;
  configSchema = configSchema;

  constructor(options?: AgentReviewPluginOptions) {
    this.id = options?.id ?? 'agent-review';
    this.name = options?.name ?? 'Agent Review';
  }

  shouldActivate(context: ReviewContext): boolean {
    const apiKey =
      (context.config.apiKey as string) ?? (context.config.anthropicApiKey as string) ?? '';
    return apiKey.length > 0 && context.chunks.length > 0;
  }

  async analyze(context: ReviewContext): Promise<ReviewFinding[]> {
    const config = context.config as unknown as AgentConfig;
    const logger = context.logger;
    const apiKey = config.apiKey ?? config.anthropicApiKey ?? '';
    const provider = config.provider ?? (config.anthropicApiKey ? 'anthropic' : 'openai');

    // Build dependency graph from in-memory chunks (no embeddings needed)
    const graph = buildDependencyGraph(context.repoChunks!);

    const toolExecutor = (name: string, input: Record<string, unknown>) =>
      dispatchTool(name, input, {
        repoChunks: context.repoChunks!,
        repoRootDir: context.repoRootDir!,
        graph,
        logger,
      });

    // Select active rules based on PR content (languages, diff keywords)
    const triggerCtx = buildTriggerContext(context);
    const rules = selectRules(BUILTIN_RULES, triggerCtx);
    logger.info(
      `[${this.id}] Rules: ${rules.active.map(r => r.id).join(', ')} (skipped: ${rules.skipped.join(', ') || 'none'})`,
    );

    // Pre-compute transitive blast radius so the agent sees it in the initial
    // message instead of having to decide to call get_dependents itself.
    // Gated on an active rule opting in — saves compute on PRs where no
    // pattern-specific rule needs dependency context (docs, formatting, etc.).
    const blastRadiusConfig = config.blastRadius ?? {};
    const needsBlastRadius =
      blastRadiusConfig.enabled !== false && rules.active.some(r => r.requiresBlastRadius === true);
    const blastRadius = needsBlastRadius
      ? computeBlastRadius(context.chunks, graph, context.repoChunks!, {
          depth: blastRadiusConfig.depth,
          maxNodes: blastRadiusConfig.maxNodes,
          maxSeeds: blastRadiusConfig.maxSeeds,
          workspaceRoot: context.repoRootDir,
        })
      : null;
    if (blastRadius) {
      logger.info(
        `[${this.id}] Blast radius: ${blastRadius.totalDistinctDependents} deps, risk=${blastRadius.globalRisk.level}${blastRadius.truncated ? ' (truncated)' : ''}`,
      );
    }

    const systemPrompt = buildSystemPrompt(rules);
    const initialMessage = buildInitialMessage(context, { blastRadius });
    const result = await runAgentClient(
      provider,
      config,
      apiKey,
      logger,
      systemPrompt,
      initialMessage,
      toolExecutor,
    );

    logger.info(
      `[${this.id}] Review complete: ${result.findings.length} findings in ${result.turns} turns ($${result.usage.cost.toFixed(4)})`,
    );

    context.reportUsage?.(result.usage);

    const pluginId = this.id;
    const findings = result.findings.map(f => mapToReviewFinding(f, pluginId));

    // Add summary as a special finding so present() can render it
    if (result.summary) {
      findings.push({
        pluginId,
        filepath: '',
        line: 0,
        severity: 'info' as const,
        category: 'summary',
        message: result.summary.overview,
        metadata: {
          riskLevel: result.summary.riskLevel,
          overview: result.summary.overview,
          keyChanges: result.summary.keyChanges,
        },
      });
    }

    return findings;
  }

  async present(findings: ReviewFinding[], context: PresentContext): Promise<void> {
    const marker = `<!-- lien-plugin:${this.id}:`;

    const commitSha = context.pr?.headSha;

    // Separate bug findings (line > 0) from summary/architectural findings
    const bugFindings = findings.filter(
      f => f.line > 0 && f.category !== 'architectural' && f.category !== 'summary',
    );
    const archFindings = findings.filter(f => f.category === 'architectural');
    const summaryFinding = findings.find(f => f.category === 'summary');

    // 1. Post inline comments for bug findings on the diff
    //    Minimize outdated comments only when we have new ones to replace them
    if (bugFindings.length > 0 && context.postInlineComments) {
      if (context.minimizeOutdatedComments) {
        await context.minimizeOutdatedComments(marker);
      }
      const reviewBody = buildFixPrompt(bugFindings, marker);
      const result = await context.postInlineComments(bugFindings, reviewBody);

      // If some findings were outside the diff, post them as a review comment
      if (result && result.skipped > 0 && context.postReviewComment) {
        const outsideDiff = bugFindings.filter(f => !context.pr?.patches?.has(f.filepath));
        if (outsideDiff.length > 0) {
          const outsideBody = `${marker}outside-diff -->\n**⚠️ Issues found outside the diff:**\n\n${outsideDiff.map(f => `- 🔴 **${f.filepath}:${f.line}**${f.symbolName ? ` in \`${f.symbolName}\`` : ''}\n  ${f.message}${f.suggestion ? `\n  💡 *${f.suggestion}*` : ''}`).join('\n\n')}`;
          await context.postReviewComment(outsideBody);
        }
      }
    }

    // 2. Contribute to PR description — GitHub callout box style
    const description = buildDescription(bugFindings, summaryFinding, archFindings, commitSha);
    context.appendDescription(description, this.id);

    // 4. Append to check run summary
    context.appendSummary(formatCheckSummary(findings, this.name));
  }
}

// ---------------------------------------------------------------------------
// Agent client execution
// ---------------------------------------------------------------------------

type ToolExecutor = (name: string, input: Record<string, unknown>) => Promise<string>;

function runAgentClient(
  provider: string,
  config: AgentConfig,
  apiKey: string,
  logger: Logger,
  systemPrompt: string,
  initialMessage: string,
  toolExecutor: ToolExecutor,
): Promise<AgentResult> {
  if (provider === 'anthropic') {
    const client = new AnthropicAgentClient({
      apiKey,
      model: config.model,
      baseUrl: config.baseUrl,
      inputCostPerMTok: config.inputCostPerMTok,
      outputCostPerMTok: config.outputCostPerMTok,
      maxTurns: config.maxTurns,
      maxTokenBudget: config.maxTokenBudget,
      logger,
    });
    return client.run(systemPrompt, initialMessage, AGENT_TOOLS, toolExecutor);
  }

  const client = new OpenAIAgentClient({
    apiKey,
    model: config.model,
    baseUrl: config.baseUrl ?? 'https://openrouter.ai/api/v1',
    inputCostPerMTok: config.inputCostPerMTok,
    outputCostPerMTok: config.outputCostPerMTok,
    maxTurns: config.maxTurns,
    maxTokenBudget: config.maxTokenBudget,
    logger,
  });
  return client.run(systemPrompt, initialMessage, toOpenAITools(AGENT_TOOLS), toolExecutor);
}

// ---------------------------------------------------------------------------
// Finding mapping
// ---------------------------------------------------------------------------

function mapToReviewFinding(f: AgentFinding, pluginId: string): ReviewFinding {
  return {
    pluginId,
    filepath: f.filepath,
    line: f.line,
    endLine: f.endLine,
    symbolName: f.symbolName,
    severity: f.severity,
    category: f.category,
    message: f.message,
    suggestion: f.suggestion,
    evidence: f.evidence,
    ...(f.ruleId ? { metadata: { ruleId: f.ruleId } } : {}),
  };
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

function formatArchDescription(findings: ReviewFinding[]): string {
  const count = findings.length;
  const rows = findings.map(f => {
    const scope = f.filepath ? `\`${f.filepath}:${f.line}\`` : 'General';
    return `| ${scope} | ${f.message} | ${f.suggestion ?? ''} |`;
  });
  const table = `| Scope | Observation | Suggestion |\n|---|---|---|\n${rows.join('\n')}`;
  return `<details>\n<summary>🏗️ <b>Architectural</b> · ${count} observation${count === 1 ? '' : 's'}</summary>\n\n${table}\n\n</details>`;
}

function formatCheckSummary(findings: ReviewFinding[], name: string): string {
  const bugs = findings.filter(
    f => f.category !== 'architectural' && f.category !== 'summary' && f.line > 0,
  );
  const arch = findings.filter(f => f.category === 'architectural');
  const summary = findings.find(f => f.category === 'summary');

  const sections: string[] = [`### ${name}`];

  if (summary) {
    const meta = summary.metadata as { riskLevel?: string; overview?: string } | undefined;
    sections.push(
      `**${capitalize(meta?.riskLevel ?? 'unknown')} Risk** — ${meta?.overview ?? summary.message}`,
    );
  }

  if (bugs.length > 0) {
    const bugLines = bugs.map(f => {
      const icon = f.severity === 'error' ? '🔴' : '🟡';
      return `- ${icon} **${f.filepath}:${f.line}** — ${f.message}`;
    });
    sections.push(`**Findings (${bugs.length})**\n${bugLines.join('\n')}`);
  }

  if (arch.length > 0) {
    const archLines = arch.map(f => `- ${f.message}`);
    sections.push(`**Architectural (${arch.length})**\n${archLines.join('\n')}`);
  }

  if (bugs.length === 0 && arch.length === 0 && !summary) {
    sections.push('No issues found.');
  }

  return sections.join('\n\n');
}

/**
 * Build the PR description section using GitHub's callout blockquote syntax.
 * Uses > [!NOTE] for clean PRs, > [!WARNING] when issues are found.
 */
function buildDescription(
  bugFindings: ReviewFinding[],
  summaryFinding: ReviewFinding | undefined,
  archFindings: ReviewFinding[],
  commitSha?: string,
): string {
  const meta = summaryFinding?.metadata as
    | { riskLevel?: string; overview?: string; keyChanges?: string[] }
    | undefined;
  const risk = meta?.riskLevel ?? 'low';
  const overview = meta?.overview ?? summaryFinding?.message ?? '';

  const calloutType = bugFindings.length > 0 ? 'WARNING' : 'NOTE';
  const headline =
    bugFindings.length > 0
      ? `**${bugFindings.length} issue${bugFindings.length === 1 ? '' : 's'} found** · ${capitalize(risk)} Risk`
      : `**${capitalize(risk)} Risk**`;

  const lines: string[] = [];
  lines.push(`> [!${calloutType}]`);
  lines.push(`> ${headline}`);

  if (overview) {
    lines.push(`>`);
    lines.push(`> ${overview}`);
  }

  if (meta?.keyChanges && meta.keyChanges.length > 0) {
    lines.push(`>`);
    for (const change of meta.keyChanges) {
      lines.push(`> - ${change}`);
    }
  }

  const parts: string[] = [lines.join('\n')];

  if (archFindings.length > 0) {
    parts.push(formatArchDescription(archFindings));
  }

  // Footer with commit SHA
  const shortSha = commitSha ? commitSha.slice(0, 7) : '';
  const footer = shortSha
    ? `<sup>Reviewed by [Lien Review](https://lien.dev) for commit ${shortSha}. Updates automatically on new commits.</sup>`
    : `<sup>Reviewed by [Lien Review](https://lien.dev). Updates automatically on new commits.</sup>`;
  parts.push(footer);

  return parts.join('\n\n');
}

/**
 * Build the review-level comment body with a collapsed "fix all" prompt.
 * Includes the dedup marker so minimizeOutdatedComments can clean up on reruns.
 */
function buildFixPrompt(findings: ReviewFinding[], marker: string): string {
  const count = findings.length;
  const headline = `**${count} issue${count === 1 ? '' : 's'} found**`;

  const instructions = findings.map(f => {
    const loc = `\`${f.filepath}:${f.line}\``;
    const symbol = f.symbolName ? ` in \`${f.symbolName}\`` : '';
    const fix = f.suggestion ? ` Fix: ${f.suggestion}` : '';
    return `- ${loc}${symbol}: ${f.message}${fix}`;
  });

  const prompt = `Verify each finding against the current code and only fix it if the issue is real.\n\n${instructions.join('\n')}`;

  return `${marker}review -->\n${headline}\n\n<details>\n<summary>🤖 Prompt for AI Agents</summary>\n\n\`\`\`\n${prompt}\n\`\`\`\n\n</details>`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
