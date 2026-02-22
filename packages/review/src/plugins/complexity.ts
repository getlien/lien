/**
 * Complexity review plugin.
 *
 * Detects complexity violations using @liendev/parser, optionally generates
 * LLM refactoring suggestions. Inlined from review-engine.ts.
 */

import { z } from 'zod';
import { RISK_ORDER, type ComplexityViolation, type ComplexityReport } from '@liendev/parser';
import type {
  ReviewPlugin,
  ReviewContext,
  ReviewFinding,
  PresentContext,
  CheckAnnotation,
  ComplexityFindingMetadata,
} from '../plugin-types.js';
import { buildBatchedCommentsPrompt, getViolationKey, getMetricLabel } from '../prompt.js';
import { formatComplexityValue, formatThresholdValue, getMetricEmoji } from '../prompt.js';
import { formatDelta } from '../delta.js';
import { COMMENT_MARKER_PREFIX } from '../github-api.js';
import { estimatePromptTokens, parseJSONResponse } from '../llm-client.js';
import type { Logger } from '../logger.js';

/** Max tokens to reserve for the prompt (leaves room for output within 128K context) */
const PROMPT_TOKEN_BUDGET = 100_000;

/** Max violations to send to LLM in a single batch (prevents timeouts with reasoning models) */
const MAX_LLM_VIOLATIONS = 15;

export const complexityConfigSchema = z.object({
  threshold: z.number().default(15),
  blockOnNewErrors: z.boolean().default(false),
});

/**
 * Complexity review plugin: detects violations and generates LLM suggestions.
 */
export class ComplexityPlugin implements ReviewPlugin {
  id = 'complexity';
  name = 'Complexity Review';
  description = 'Detects complexity violations and suggests refactoring via LLM';
  requiresLLM = false;
  configSchema = complexityConfigSchema;
  defaultConfig = { threshold: 15, blockOnNewErrors: false };

  shouldActivate(context: ReviewContext): boolean {
    return context.complexityReport.summary.totalViolations > 0;
  }

  async analyze(context: ReviewContext): Promise<ReviewFinding[]> {
    const { complexityReport, deltas, logger } = context;

    const allViolations = Object.values(complexityReport.files).flatMap(f => f.violations);
    const violations = prioritizeViolations(allViolations, complexityReport);
    logger.info(`Complexity plugin: ${violations.length} violations to review`);

    const deltaMap = buildDeltaLookup(deltas);
    const suggestions = context.llm
      ? await this.generateSuggestions(violations, complexityReport, context)
      : new Map<string, string>();

    // Track which functions already got an LLM suggestion (avoid duplicating per-metric)
    const usedSuggestionKeys = new Set<string>();

    return violations.map(v => violationToFinding(v, deltaMap, suggestions, usedSuggestionKeys));
  }

  /**
   * Present complexity findings as check annotations and PR review comments.
   */
  async present(findings: ReviewFinding[], context: PresentContext): Promise<void> {
    const myFindings = findings.filter(f => f.pluginId === 'complexity');
    if (myFindings.length === 0) return;

    const { logger } = context;

    // Map findings to check annotations
    const annotations: CheckAnnotation[] = myFindings.map(f => ({
      path: f.filepath,
      start_line: f.line,
      end_line: f.endLine ?? f.line,
      annotation_level: mapSeverity(f.severity),
      message: buildAnnotationMessage(f),
      title: buildAnnotationTitle(f),
    }));
    context.addAnnotations(annotations);

    // Post review comment with inline comments (if available)
    if (context.postReviewComment) {
      const lineComments = myFindings
        .filter(f => !isMarginalFinding(f))
        .map(f => ({
          path: f.filepath,
          line: f.endLine ?? f.line,
          start_line: f.line,
          body: buildInlineCommentBody(f),
        }));

      if (lineComments.length > 0) {
        const summary = buildPresentSummary(myFindings);
        await context.postReviewComment(summary, lineComments);
      }
    }

    logger.info(`Complexity: ${annotations.length} annotations, ${myFindings.length} findings`);
  }

  /**
   * Generate LLM refactoring suggestions for violations in a single batch call.
   */
  private async generateSuggestions(
    violations: ComplexityViolation[],
    report: ComplexityReport,
    context: ReviewContext,
  ): Promise<Map<string, string>> {
    if (!context.llm || violations.length === 0) {
      return new Map();
    }

    const { logger } = context;
    logger.info(`Generating LLM suggestions for ${violations.length} violations`);

    const codeSnippets = collectCodeSnippets(context.chunks);
    const { prompt, usedViolations } = buildPromptWithBudget(
      violations,
      codeSnippets,
      report,
      logger,
    );

    try {
      const response = await context.llm.complete(prompt);
      return mapLLMResponses(response.content, usedViolations, logger);
    } catch (error) {
      logger.warning(
        `LLM suggestion generation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return new Map();
    }
  }
}

/**
 * Build a delta lookup from filepath::symbolName::metricType to delta value.
 */
function buildDeltaLookup(deltas: ReviewContext['deltas']): Map<string, number> {
  const map = new Map<string, number>();
  if (!deltas) return map;
  for (const d of deltas) {
    map.set(`${d.filepath}::${d.symbolName}::${d.metricType}`, d.delta);
  }
  return map;
}

/**
 * Convert a single ComplexityViolation into a ReviewFinding.
 * LLM suggestions are per-function, so only the first metric for each function gets one.
 */
function violationToFinding(
  v: ComplexityViolation,
  deltaMap: Map<string, number>,
  suggestions: Map<string, string>,
  usedSuggestionKeys: Set<string>,
): ReviewFinding {
  const key = getViolationKey(v);
  const metricType = v.metricType || 'cyclomatic';
  const delta = deltaMap.get(`${v.filepath}::${v.symbolName}::${metricType}`) ?? null;
  const metricLabel = getMetricLabel(metricType);
  const valueDisplay = formatComplexityValue(metricType, v.complexity);
  const thresholdDisplay = formatThresholdValue(metricType, v.threshold);

  const suggestion = suggestions.get(key);
  const isFirstForFunction = suggestion && !usedSuggestionKeys.has(key);
  if (isFirstForFunction) usedSuggestionKeys.add(key);

  const fallback = `This ${v.symbolType} has ${metricLabel} of ${valueDisplay} (threshold: ${thresholdDisplay}). Consider refactoring to improve readability and testability.`;

  return {
    pluginId: 'complexity',
    filepath: v.filepath,
    line: v.startLine,
    endLine: v.endLine,
    symbolName: v.symbolName,
    severity: v.severity,
    category: metricType,
    message: isFirstForFunction ? suggestion : fallback,
    evidence: `${metricLabel}: ${valueDisplay} (threshold: ${thresholdDisplay})`,
    metadata: {
      pluginType: 'complexity',
      metricType,
      complexity: v.complexity,
      threshold: v.threshold,
      delta,
      symbolType: v.symbolType,
    } satisfies ComplexityFindingMetadata,
  };
}

/**
 * Collect code snippets from chunks, keyed by file::symbolName.
 */
function collectCodeSnippets(chunks: ReviewContext['chunks']): Map<string, string> {
  const snippets = new Map<string, string>();
  for (const chunk of chunks) {
    if (chunk.metadata.symbolName) {
      const key = `${chunk.metadata.file}::${chunk.metadata.symbolName}`;
      if (!snippets.has(key)) {
        snippets.set(key, chunk.content);
      }
    }
  }
  return snippets;
}

/**
 * Build the LLM prompt, capping violations and enforcing token budget.
 */
function buildPromptWithBudget(
  violations: ComplexityViolation[],
  codeSnippets: Map<string, string>,
  report: ComplexityReport,
  logger: Logger,
): { prompt: string; usedViolations: ComplexityViolation[] } {
  let usedViolations =
    violations.length > MAX_LLM_VIOLATIONS ? violations.slice(0, MAX_LLM_VIOLATIONS) : violations;

  if (violations.length > MAX_LLM_VIOLATIONS) {
    logger.info(
      `Capping LLM suggestions to top ${MAX_LLM_VIOLATIONS}/${violations.length} violations (rest use fallback)`,
    );
  }

  let prompt = buildBatchedCommentsPrompt(usedViolations, codeSnippets, report);
  let estimatedTokens = estimatePromptTokens(prompt);

  if (estimatedTokens > PROMPT_TOKEN_BUDGET) {
    logger.warning(
      `Prompt exceeds token budget (${estimatedTokens.toLocaleString()} > ${PROMPT_TOKEN_BUDGET.toLocaleString()}). Truncating...`,
    );
    let count = usedViolations.length;
    while (count > 1 && estimatedTokens > PROMPT_TOKEN_BUDGET) {
      count = Math.ceil(count / 2);
      usedViolations = violations.slice(0, count);
      prompt = buildBatchedCommentsPrompt(usedViolations, codeSnippets, report);
      estimatedTokens = estimatePromptTokens(prompt);
    }
    logger.warning(`Truncated to ${usedViolations.length}/${violations.length} violations`);
  }

  return { prompt, usedViolations };
}

/**
 * Parse the LLM response and map comments to violation keys.
 */
function mapLLMResponses(
  content: string,
  usedViolations: ComplexityViolation[],
  logger: Logger,
): Map<string, string> {
  const parsed = parseJSONResponse(content, logger);
  if (!parsed) return new Map();

  const results = new Map<string, string>();
  for (const v of usedViolations) {
    const key = getViolationKey(v);
    const comment = parsed[key];
    if (comment) {
      results.set(key, comment.replace(/\\n/g, '\n'));
    }
  }
  return results;
}

/**
 * Prioritize violations by impact (dependents + severity).
 * Inlined from review-engine.ts.
 */
function prioritizeViolations(
  violations: ComplexityViolation[],
  report: ComplexityReport,
): ComplexityViolation[] {
  return [...violations].sort((a, b) => {
    const fileA = report.files[a.filepath];
    const fileB = report.files[b.filepath];

    const impactA = (fileA?.dependentCount || 0) * 10 + RISK_ORDER[fileA?.riskLevel || 'low'];
    const impactB = (fileB?.dependentCount || 0) * 10 + RISK_ORDER[fileB?.riskLevel || 'low'];

    if (impactB !== impactA) return impactB - impactA;

    const severityOrder = { error: 2, warning: 1 };
    return severityOrder[b.severity] - severityOrder[a.severity];
  });
}

// ---------------------------------------------------------------------------
// present() Helpers
// ---------------------------------------------------------------------------

function getComplexityMetadata(f: ReviewFinding): ComplexityFindingMetadata | undefined {
  const m = f.metadata as Record<string, unknown> | undefined;
  if (!m || typeof m.complexity !== 'number' || typeof m.threshold !== 'number') return undefined;
  return m as unknown as ComplexityFindingMetadata;
}

function mapSeverity(severity: ReviewFinding['severity']): CheckAnnotation['annotation_level'] {
  if (severity === 'error') return 'failure';
  if (severity === 'warning') return 'warning';
  return 'notice';
}

function buildAnnotationMessage(f: ReviewFinding): string {
  return f.message;
}

function buildAnnotationTitle(f: ReviewFinding): string {
  const metadata = getComplexityMetadata(f);
  if (!metadata) return f.symbolName ?? 'complexity';
  const metricLabel = getMetricLabel(metadata.metricType);
  const value = formatComplexityValue(metadata.metricType, metadata.complexity);
  const threshold = formatThresholdValue(metadata.metricType, metadata.threshold);
  return `${f.symbolName ?? 'unknown'}: ${metricLabel} ${value} (threshold: ${threshold})`;
}

/**
 * Check if a finding is marginal (within 5% of threshold).
 * Marginal findings get annotations but not inline PR comments.
 */
function isMarginalFinding(f: ReviewFinding): boolean {
  const metadata = getComplexityMetadata(f);
  if (!metadata) return false;
  const { complexity, threshold } = metadata;
  if (threshold <= 0) return false;
  const overage = (complexity - threshold) / threshold;
  return overage > 0 && overage <= 0.05;
}

function buildInlineCommentBody(f: ReviewFinding): string {
  const metadata = getComplexityMetadata(f);
  const metricType = metadata?.metricType ?? 'cyclomatic';
  const complexity = metadata?.complexity ?? 0;
  const threshold = metadata?.threshold ?? 15;
  const delta = metadata?.delta;
  const metricLabel = getMetricLabel(metricType);
  const valueDisplay = formatComplexityValue(metricType, complexity);
  const thresholdDisplay = formatThresholdValue(metricType, threshold);

  const deltaStr = delta !== null && delta !== undefined ? ` (${formatDelta(delta)})` : '';
  const severityEmoji = f.severity === 'error' ? '🔴' : '🟡';
  const metricEmoji = getMetricEmoji(metricType);

  const marker = `${COMMENT_MARKER_PREFIX}${f.filepath}::${f.symbolName ?? 'unknown'} -->`;
  const header = `${severityEmoji} ${metricEmoji} **${capitalize(metricLabel)}: ${valueDisplay}**${deltaStr} (threshold: ${thresholdDisplay})`;

  return `${marker}\n${header}\n\n${f.message}`;
}

function buildPresentSummary(findings: ReviewFinding[]): string {
  const errors = findings.filter(f => f.severity === 'error').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  return `**Complexity Review** — ${parts.join(', ')}. See inline comments.`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
