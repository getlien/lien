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

    // Collect and prioritize violations
    const allViolations = Object.values(complexityReport.files).flatMap(f => f.violations);
    const violations = prioritizeViolations(allViolations, complexityReport);

    logger.info(`Complexity plugin: ${violations.length} violations to review`);

    // Build delta lookup
    const deltaMap = new Map<string, number>();
    if (deltas) {
      for (const d of deltas) {
        deltaMap.set(`${d.filepath}::${d.symbolName}::${d.metricType}`, d.delta);
      }
    }

    // Generate LLM suggestions if available
    const suggestions = context.llm
      ? await this.generateSuggestions(violations, complexityReport, context)
      : new Map<string, string>();

    // Map violations to findings.
    // LLM suggestions are per-function (not per-metric), so only attach the suggestion
    // to the first violation for each function. The rest use the metric-specific fallback
    // to avoid printing the same refactoring suggestion 4 times.
    const usedSuggestionKeys = new Set<string>();

    return violations.map(v => {
      const key = getViolationKey(v);
      const deltaKey = `${v.filepath}::${v.symbolName}::${v.metricType}`;
      const delta = deltaMap.get(deltaKey) ?? null;
      const metricLabel = getMetricLabel(v.metricType || 'cyclomatic');
      const valueDisplay = formatComplexityValue(v.metricType || 'cyclomatic', v.complexity);
      const thresholdDisplay = formatThresholdValue(v.metricType || 'cyclomatic', v.threshold);

      // Only use the LLM suggestion once per function
      const suggestion = suggestions.get(key);
      const isFirstForFunction = suggestion && !usedSuggestionKeys.has(key);
      if (isFirstForFunction) usedSuggestionKeys.add(key);

      const fallback = `This ${v.symbolType} has ${metricLabel} of ${valueDisplay} (threshold: ${thresholdDisplay}). Consider refactoring to improve readability and testability.`;

      const metadata: ComplexityFindingMetadata = {
        pluginType: 'complexity',
        metricType: v.metricType || 'cyclomatic',
        complexity: v.complexity,
        threshold: v.threshold,
        delta,
        symbolType: v.symbolType,
      };

      return {
        pluginId: 'complexity',
        filepath: v.filepath,
        line: v.startLine,
        endLine: v.endLine,
        symbolName: v.symbolName,
        severity: v.severity,
        category: v.metricType || 'cyclomatic',
        message: isFirstForFunction ? suggestion : fallback,
        evidence: `${metricLabel}: ${valueDisplay} (threshold: ${thresholdDisplay})`,
        metadata,
      } satisfies ReviewFinding;
    });
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

    // Collect code snippets from chunks
    const codeSnippets = new Map<string, string>();
    for (const chunk of context.chunks) {
      if (chunk.metadata.symbolName) {
        const key = `${chunk.metadata.file}::${chunk.metadata.symbolName}`;
        if (!codeSnippets.has(key)) {
          codeSnippets.set(key, chunk.content);
        }
      }
    }

    // Cap violations to prevent LLM timeouts (already sorted by priority)
    let usedViolations = violations;
    if (violations.length > MAX_LLM_VIOLATIONS) {
      usedViolations = violations.slice(0, MAX_LLM_VIOLATIONS);
      logger.info(
        `Capping LLM suggestions to top ${MAX_LLM_VIOLATIONS}/${violations.length} violations (rest use fallback)`,
      );
    }

    // Build prompt with token budget enforcement
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

    try {
      const response = await context.llm.complete(prompt);
      const parsed = parseJSONResponse(response.content, logger);

      if (!parsed) {
        return new Map();
      }

      // Map AI responses to violation keys
      const results = new Map<string, string>();
      for (const v of usedViolations) {
        const key = getViolationKey(v);
        const comment = parsed[key];
        if (comment) {
          results.set(key, comment.replace(/\\n/g, '\n'));
        }
      }

      return results;
    } catch (error) {
      logger.warning(`LLM suggestion generation failed: ${error}`);
      return new Map();
    }
  }
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
