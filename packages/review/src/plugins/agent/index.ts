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

import type { AgentConfig, AgentFinding } from './types.js';
import { AnthropicAgentClient } from './anthropic-client.js';
import { buildSystemPrompt, buildInitialMessage } from './system-prompt.js';
import { buildFullIndex } from './indexing.js';
import { AGENT_TOOLS, dispatchTool } from './tools.js';

const configSchema = z.object({
  anthropicApiKey: z.string().min(1),
  model: z.string().default('claude-sonnet-4-6'),
  baseUrl: z.string().optional(),
  inputCostPerMTok: z.number().optional(),
  outputCostPerMTok: z.number().optional(),
  maxTurns: z.number().int().min(1).max(30).default(15),
  maxTokenBudget: z.number().int().default(100_000),
});

export interface AgentReviewPluginOptions {
  /** Plugin ID (must be unique per engine). Default: 'agent-review'. */
  id?: string;
  /** Human-readable name. Default: 'Agent Review'. */
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
    const apiKey = context.config.anthropicApiKey as string | undefined;
    return !!apiKey && context.chunks.length > 0;
  }

  async analyze(context: ReviewContext): Promise<ReviewFinding[]> {
    const config = context.config as unknown as AgentConfig;
    const logger = context.logger;

    // Build full index with embeddings for semantic_search
    const { vectorDB, embeddings } = await buildFullIndex(context.repoRootDir!, logger);

    try {
      // Build dependency graph from in-memory chunks
      const graph = buildDependencyGraph(context.repoChunks!);

      const agentClient = new AnthropicAgentClient({
        apiKey: config.anthropicApiKey,
        model: config.model,
        baseUrl: config.baseUrl,
        inputCostPerMTok: config.inputCostPerMTok,
        outputCostPerMTok: config.outputCostPerMTok,
        maxTurns: config.maxTurns,
        maxTokenBudget: config.maxTokenBudget,
        logger,
      });

      const result = await agentClient.run(
        buildSystemPrompt(),
        buildInitialMessage(context),
        AGENT_TOOLS,
        (name, input) =>
          dispatchTool(name, input, {
            vectorDB,
            embeddings,
            repoChunks: context.repoChunks!,
            repoRootDir: context.repoRootDir!,
            graph,
            logger,
          }),
      );

      logger.info(
        `[${this.id}] Review complete: ${result.findings.length} findings in ${result.turns} turns ($${result.usage.cost.toFixed(4)})`,
      );

      context.reportUsage?.(result.usage);

      const pluginId = this.id;
      return result.findings.map(f => mapToReviewFinding(f, pluginId));
    } finally {
      // Clean up embedding worker
      await embeddings.dispose().catch(() => {});
    }
  }

  async present(findings: ReviewFinding[], context: PresentContext): Promise<void> {
    const marker = `<!-- lien-plugin:${this.id}:`;

    if (findings.length === 0) {
      context.appendSummary(`### ${this.name}\n\nNo issues found.`);
      return;
    }

    // Separate bug findings (line > 0) from summary/architectural findings
    const bugFindings = findings.filter(
      f => f.line > 0 && f.category !== 'architectural' && f.category !== 'summary',
    );
    const archFindings = findings.filter(f => f.category === 'architectural');
    const summaryFinding = findings.find(f => f.category === 'summary');

    // 1. Minimize outdated comments from previous runs
    if (context.minimizeOutdatedComments) {
      await context.minimizeOutdatedComments(marker);
    }

    // 2. Post inline comments for bug findings on the diff
    if (bugFindings.length > 0 && context.postInlineComments) {
      const body = formatBugSummary(bugFindings, this.name);
      await context.postInlineComments(bugFindings, body);
    }

    // 3. Contribute to PR description
    const descParts: string[] = [];
    if (summaryFinding) {
      descParts.push(formatSummaryDescription(summaryFinding));
    }
    if (archFindings.length > 0) {
      descParts.push(formatArchDescription(archFindings));
    }
    if (descParts.length > 0) {
      context.appendDescription(descParts.join('\n\n'), this.id);
    }

    // 5. Append to check run summary
    context.appendSummary(formatCheckSummary(findings));
  }
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
  };
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

function formatBugSummary(findings: ReviewFinding[], name: string): string {
  const errors = findings.filter(f => f.severity === 'error').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  return `${name}: ${parts.join(', ')}`;
}

function formatSummaryDescription(finding: ReviewFinding): string {
  const meta = finding.metadata as
    | { riskLevel?: string; overview?: string; keyChanges?: string[] }
    | undefined;
  const risk = meta?.riskLevel ?? 'unknown';
  const overview = meta?.overview ?? finding.message;
  const keyChanges = meta?.keyChanges ?? [];

  let md = `**${capitalize(risk)} Risk** — ${overview}`;
  if (keyChanges.length > 0) {
    md += `\n\n**Key Changes**\n${keyChanges.map(c => `- ${c}`).join('\n')}`;
  }
  return md;
}

function formatArchDescription(findings: ReviewFinding[]): string {
  const count = findings.length;
  const rows = findings.map(f => {
    const scope = f.filepath ? `\`${f.filepath}:${f.line}\`` : 'General';
    return `| ${scope} | ${f.message} | ${f.suggestion ?? ''} |`;
  });
  const table = `| Scope | Observation | Suggestion |\n|---|---|---|\n${rows.join('\n')}`;
  return `<details>\n<summary>🏗️ <b>Architectural</b> · ${count} observation${count === 1 ? '' : 's'}</summary>\n\n${table}\n\n</details>`;
}

function formatCheckSummary(findings: ReviewFinding[]): string {
  const bugs = findings.filter(
    f => f.category !== 'architectural' && f.category !== 'summary' && f.line > 0,
  );
  const arch = findings.filter(f => f.category === 'architectural');
  const summary = findings.find(f => f.category === 'summary');

  const sections: string[] = ['### Agent Review'];

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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
