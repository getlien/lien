/**
 * Logic review plugin.
 *
 * Detects breaking changes, unchecked return values, and missing test coverage.
 * Uses LLM to validate findings and filter false positives.
 * Inlined from logic-review.ts.
 */

import { z } from 'zod';
import type { CodeChunk, ComplexityReport } from '@liendev/parser';
import type { LogicFinding } from '../types.js';
import type {
  ReviewPlugin,
  ReviewContext,
  ReviewFinding,
  LogicFindingMetadata,
} from '../plugin-types.js';
import { detectLogicFindings } from '../logic-review.js';
import { isFindingSuppressed } from '../suppression.js';
import { buildLogicReviewPrompt } from '../logic-prompt.js';
import { parseLogicReviewResponse } from '../logic-response.js';

export const logicConfigSchema = z.object({
  categories: z.array(z.string()).default(['breaking_change', 'unchecked_return', 'missing_tests']),
});

/**
 * Logic review plugin: AST-based detection + LLM validation.
 */
export class LogicPlugin implements ReviewPlugin {
  id = 'logic';
  name = 'Logic Review';
  description = 'Detects breaking changes, unchecked returns, and missing test coverage';
  requiresLLM = false;
  configSchema = logicConfigSchema;
  defaultConfig = { categories: ['breaking_change', 'unchecked_return', 'missing_tests'] };

  shouldActivate(context: ReviewContext): boolean {
    return context.chunks.length > 0;
  }

  async analyze(context: ReviewContext): Promise<ReviewFinding[]> {
    const { chunks, complexityReport, baselineReport, logger } = context;
    const categories = (context.config.categories as string[]) ?? this.defaultConfig.categories;

    // Build snippet map for suppression checks
    const snippetsMap = buildChunkSnippetsMap(chunks);

    // Detect raw findings
    let logicFindings = detectLogicFindings(chunks, complexityReport, baselineReport, categories);

    // Apply inline suppressions (// lien-ignore: comments)
    logicFindings = logicFindings.filter(finding => {
      const key = `${finding.filepath}::${finding.symbolName}`;
      const snippet = snippetsMap.get(key);
      if (snippet && isFindingSuppressed(finding, snippet)) {
        logger.info(`Suppressed finding: ${key} (${finding.category})`);
        return false;
      }
      return true;
    });

    if (logicFindings.length === 0) {
      logger.info('Logic plugin: no findings after filtering');
      return [];
    }

    logger.info(`Logic plugin: ${logicFindings.length} findings after suppression filtering`);

    // LLM validation (filter false positives)
    if (context.llm && logicFindings.length > 0) {
      logicFindings = await this.validateWithLLM(logicFindings, snippetsMap, context);
    }

    // Map to ReviewFinding format
    return logicFindings.map(f => {
      const metadata: LogicFindingMetadata = {
        pluginType: 'logic',
        evidence: f.evidence,
      };

      return {
        pluginId: 'logic',
        filepath: f.filepath,
        line: f.line,
        symbolName: f.symbolName,
        severity: f.severity,
        category: f.category,
        message: f.message,
        evidence: f.evidence,
        metadata,
      } satisfies ReviewFinding;
    });
  }

  /**
   * Validate findings via LLM to filter false positives.
   */
  private async validateWithLLM(
    findings: LogicFinding[],
    snippetsMap: Map<string, string>,
    context: ReviewContext,
  ): Promise<LogicFinding[]> {
    if (!context.llm) return findings;

    const { logger } = context;
    logger.info(`Validating ${findings.length} logic findings via LLM`);

    // Collect code snippets for the remaining findings
    const codeSnippets = new Map<string, string>();
    for (const finding of findings) {
      const key = `${finding.filepath}::${finding.symbolName}`;
      const snippet = snippetsMap.get(key);
      if (snippet) codeSnippets.set(key, snippet);
    }

    try {
      const prompt = buildLogicReviewPrompt(findings, codeSnippets, context.complexityReport);
      const response = await context.llm.complete(prompt);
      const parsed = parseLogicReviewResponse(response.content, logger);

      if (!parsed) {
        logger.warning('Failed to parse logic review LLM response, keeping all findings');
        return findings;
      }

      // Filter to only LLM-validated findings
      const validated = findings.filter(finding => {
        const key = `${finding.filepath}::${finding.symbolName}`;
        const entry = parsed[key];
        if (entry && !entry.valid) {
          logger.info(`Finding ${key} marked as false positive by LLM`);
          return false;
        }
        return !entry || entry.valid;
      });

      logger.info(`${validated.length}/${findings.length} findings validated as real issues`);
      return validated;
    } catch (error) {
      logger.warning(`LLM validation failed (keeping all findings): ${error}`);
      return findings;
    }
  }
}

/**
 * Build a map of chunk key -> content for suppression checks and code snippets.
 */
function buildChunkSnippetsMap(chunks: CodeChunk[]): Map<string, string> {
  const snippets = new Map<string, string>();
  for (const chunk of chunks) {
    if (chunk.metadata.symbolName) {
      snippets.set(`${chunk.metadata.file}::${chunk.metadata.symbolName}`, chunk.content);
    }
  }
  return snippets;
}
