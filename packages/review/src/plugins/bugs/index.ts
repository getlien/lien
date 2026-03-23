/**
 * Bug Finder plugin.
 *
 * Analyzes changed functions in the context of their callers (from the full repo)
 * to find bugs introduced by the changes. Findings are anchored on the changed
 * function (in the diff), with affected callers listed in the message.
 */

import type {
  ReviewPlugin,
  ReviewContext,
  ReviewFinding,
  PresentContext,
} from '../../plugin-types.js';
import { buildDependencyGraph } from '../../dependency-graph.js';
import { BUG_REVIEW_MARKER } from './types.js';
import { collectChangedFunctions, buildBatches, buildBugFinderPrompt } from './forward.js';
import { analyzeChangedCallers } from './reverse.js';
import { analyzeChangedTypes } from './type-analysis.js';
import { analyzeChangedConstants } from './constants.js';
import { analyzeChangedEnums } from './enums.js';
import { analyzeChangedConfigKeys, CONFIG_FILE_PATTERNS } from './config.js';
import { detectDeletedFunctions, findDeletedFunctionCallers } from './deleted.js';
import {
  bugsToGroupedFindings,
  buildBlobBase,
  rebuildMessageWithLinks,
  formatBugReviewComment,
  formatBugSummary,
} from './formatting.js';
import { parseBugResponse } from './parsing.js';
import { suppressFalsePositives } from './filters.js';

export class BugFinderPlugin implements ReviewPlugin {
  id = 'bugs';
  name = 'Bug Finder';
  description = 'Finds bugs by analyzing changed functions in the context of their callers';
  requiresLLM = true;
  requiresRepoChunks = true;

  shouldActivate(context: ReviewContext): boolean {
    const hasFunctions = context.chunks.some(
      c => c.metadata.symbolType === 'function' || c.metadata.symbolType === 'method',
    );
    const hasTypes = context.chunks.some(
      c => c.metadata.symbolType === 'class' || c.metadata.symbolType === 'interface',
    );
    const hasDeletedFunctions =
      context.pr?.patches && detectDeletedFunctions(context.pr.patches, context.chunks).length > 0;
    const hasConfigChanges =
      context.pr?.patches && [...context.pr.patches.keys()].some(f => CONFIG_FILE_PATTERNS.test(f));
    return hasFunctions || hasTypes || !!hasDeletedFunctions || !!hasConfigChanges;
  }

  async analyze(context: ReviewContext): Promise<ReviewFinding[]> {
    const { chunks, logger } = context;

    if (!context.repoChunks) {
      logger.info('Bug finder: skipping — no repoChunks available');
      return [];
    }

    const graph = buildDependencyGraph(context.repoChunks);
    const allFindings: ReviewFinding[] = [];

    // 1. Detect deleted functions and find remaining callers (deterministic, no LLM)
    if (context.pr?.patches) {
      const deletedFindings = findDeletedFunctionCallers(
        context.pr.patches,
        chunks,
        graph,
        logger,
        context.repoChunks,
      );
      allFindings.push(...deletedFindings);
    }

    // 2-7. Run all LLM-based analyses in parallel — they share read-only context/graph
    if (context.llm) {
      const analyses: Promise<ReviewFinding[]>[] = [];

      // 2. Changed functions → callers
      const changedFunctions = collectChangedFunctions(chunks, context.pr?.diffLines);
      if (changedFunctions.length > 0) {
        const batches = buildBatches(changedFunctions, graph, logger);
        analyses.push(
          Promise.all(
            batches.map(async batch => {
              const prompt = buildBugFinderPrompt(batch, context);
              const response = await context.llm!.complete(prompt, { temperature: 0 });
              const bugs = parseBugResponse(response.content, logger);
              return bugsToGroupedFindings(bugs, batch);
            }),
          ).then(results => results.flat()),
        );
      }

      // 3. Changed types/interfaces
      analyses.push(analyzeChangedTypes(chunks, context));

      // 4. Changed constants
      if (context.pr?.patches && context.repoChunks) {
        analyses.push(analyzeChangedConstants(context));
      }

      // 5. Changed enums
      if (context.pr?.patches && context.repoChunks) {
        analyses.push(analyzeChangedEnums(context));
      }

      // 6. Changed config keys
      if (context.pr?.patches && context.repoChunks) {
        analyses.push(analyzeChangedConfigKeys(context));
      }

      // 7. Changed callers → callees
      analyses.push(analyzeChangedCallers(chunks, context, graph));

      const results = await Promise.all(analyses);
      for (const findings of results) {
        allFindings.push(...findings);
      }
    }

    const filtered = suppressFalsePositives(allFindings, logger);
    logger.info(`Bug finder: ${filtered.length} findings (grouped by changed function)`);
    return filtered;
  }

  async present(findings: ReviewFinding[], context: PresentContext): Promise<void> {
    if (findings.length === 0) return;

    const blobBase = buildBlobBase(context.pr);

    // Minimize previous bug finder review comments
    if (context.minimizeOutdatedComments) {
      await context.minimizeOutdatedComments(BUG_REVIEW_MARKER);
    }

    // Rebuild finding messages with GitHub links for inline comments
    const linkedFindings = findings.map(f => ({
      ...f,
      message: rebuildMessageWithLinks(f, blobBase),
    }));

    // Post inline comments on the diff (deduped automatically)
    if (context.postInlineComments) {
      await context.postInlineComments(linkedFindings, 'Bug Finder');
    }

    // Always post a review comment as the primary notification
    // (inline comments may be deduped from previous runs or filtered out of diff)
    if (context.postReviewComment) {
      const body = formatBugReviewComment(linkedFindings);
      await context.postReviewComment(body);
    }

    // Append to check run summary (also linked)
    context.appendSummary(formatBugSummary(linkedFindings, blobBase));
  }
}
