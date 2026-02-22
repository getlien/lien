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
  ComplexityFindingMetadata,
} from '../plugin-types.js';
import { buildBatchedCommentsPrompt, getViolationKey, getMetricLabel } from '../prompt.js';
import { formatComplexityValue, formatThresholdValue } from '../prompt.js';
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
