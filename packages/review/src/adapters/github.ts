/**
 * GitHub output adapter.
 *
 * Extracts diff filtering, dedup, comment building, and posting from review-engine.ts.
 * Receives ReviewFinding[], handles all GitHub-specific concerns.
 */

import type { Octokit } from '@octokit/rest';
import type { ComplexityReport, ComplexityViolation } from '@liendev/parser';
import type {
  OutputAdapter,
  AdapterResult,
  AdapterContext,
  ReviewFinding,
  ComplexityFindingMetadata,
} from '../plugin-types.js';
import type { PRContext, LineComment } from '../types.js';
import type { Logger } from '../logger.js';
import type { ComplexityDelta } from '../delta.js';
import {
  postPRComment,
  postPRReview,
  getPRPatchData,
  getExistingCommentKeys,
  COMMENT_MARKER_PREFIX,
  LOGIC_MARKER_PREFIX,
} from '../github-api.js';
import {
  buildNoViolationsMessage,
  buildHeaderLine,
  buildDescriptionBadge,
  getMetricLabel,
  formatComplexityValue,
  formatThresholdValue,
} from '../prompt.js';
import {
  calculateDeltaSummary,
  formatDelta,
  formatSeverityEmoji,
  logDeltaSummary,
} from '../delta.js';
import { formatDeltaValue } from '../format.js';
import { updatePRDescription } from '../github-api.js';

/**
 * GitHub PR output adapter.
 * Posts review comments, summary, and PR description badge.
 */
export class GitHubAdapter implements OutputAdapter {
  async present(findings: ReviewFinding[], context: AdapterContext): Promise<AdapterResult> {
    const { logger } = context;
    const octokit = context.octokit as Octokit;
    const pr = context.pr;

    if (!octokit || !pr) {
      logger.warning('GitHub adapter requires octokit and PR context');
      return { posted: 0, skipped: 0, filtered: 0 };
    }

    // Update PR description badge
    await updatePRDescription(
      octokit,
      pr,
      buildDescriptionBadge(context.complexityReport, context.deltaSummary, context.deltas),
      logger,
    );

    // Handle no findings
    if (findings.length === 0) {
      const successMessage = buildNoViolationsMessage(pr, context.deltas);
      await postPRComment(octokit, pr, successMessage, logger);
      return { posted: 0, skipped: 0, filtered: 0 };
    }

    // Log delta summary
    if (context.deltaSummary) {
      logDeltaSummary(context.deltaSummary, logger);
    }

    // Separate findings by plugin
    const complexityFindings = findings.filter(f => f.pluginId === 'complexity');
    const logicFindings = findings.filter(f => f.pluginId === 'logic');
    const architecturalFindings = findings.filter(f => f.pluginId === 'architectural');

    let posted = 0;
    let skipped = 0;
    let filtered = 0;

    // Post complexity review (inline comments + summary)
    if (complexityFindings.length > 0) {
      const result = await this.postComplexityReview(
        complexityFindings,
        octokit,
        pr,
        context,
        architecturalFindings,
      );
      posted += result.posted;
      skipped += result.skipped;
      filtered += result.filtered;
    }

    // Post logic review comments
    if (logicFindings.length > 0) {
      const result = await this.postLogicReview(logicFindings, octokit, pr, context);
      posted += result.posted;
      skipped += result.skipped;
    }

    return { posted, skipped, filtered };
  }

  private async postComplexityReview(
    findings: ReviewFinding[],
    octokit: Octokit,
    pr: PRContext,
    context: AdapterContext,
    architecturalFindings: ReviewFinding[],
  ): Promise<AdapterResult> {
    const { logger } = context;
    const { diffLines, patches } = await getPRPatchData(octokit, pr);
    logger.info(`Diff covers ${diffLines.size} files`);

    // Filter findings to diff lines
    const { inDiff, outOfDiff } = partitionByDiff(findings, diffLines);
    logger.info(
      `${inDiff.length}/${findings.length} complexity findings in diff (${outOfDiff.length} outside)`,
    );

    // Build line comments for in-diff findings
    const lineComments: LineComment[] = inDiff.map(f => ({
      path: f.filepath,
      line: f.endLine ?? f.line,
      start_line: f.line,
      body: buildComplexityCommentBody(f, context),
    }));

    // Dedup against existing comments
    let toPost = lineComments;
    let skippedKeys: string[] = [];
    try {
      const existing = await getExistingCommentKeys(octokit, pr, logger);
      const dedup = filterDuplicateFindings(lineComments, existing.complexity);
      toPost = dedup.kept;
      skippedKeys = dedup.skippedKeys;
      if (skippedKeys.length > 0) {
        logger.info(`Dedup: ${skippedKeys.length} complexity comments already posted`);
      }
    } catch (error) {
      logger.warning(`Failed to fetch existing comments for dedup: ${error}`);
    }

    // Build summary body
    const archNotes = architecturalFindings.map(f => ({
      observation: f.message,
      evidence: f.evidence ?? '',
      suggestion: f.suggestion ?? '',
    }));

    const summaryBody = buildSummary(
      context.complexityReport,
      context.deltas,
      outOfDiff.length,
      context.model ?? 'unknown',
      archNotes.length > 0 ? archNotes : undefined,
    );

    if (toPost.length === 0) {
      await postPRComment(octokit, pr, summaryBody, logger);
      return { posted: 0, skipped: skippedKeys.length + outOfDiff.length, filtered: 0 };
    }

    await postPRReview(octokit, pr, toPost, summaryBody, logger, 'COMMENT');
    logger.info(`Posted review with ${toPost.length} inline comments`);

    return {
      posted: toPost.length,
      skipped: skippedKeys.length + outOfDiff.length,
      filtered: 0,
    };
  }

  private async postLogicReview(
    findings: ReviewFinding[],
    octokit: Octokit,
    pr: PRContext,
    context: AdapterContext,
  ): Promise<AdapterResult> {
    const { logger } = context;
    const { diffLines } = await getPRPatchData(octokit, pr);

    // Filter to diff lines
    const inDiff = findings.filter(f => diffLines.get(f.filepath)?.has(f.line));
    if (inDiff.length < findings.length) {
      logger.info(`${findings.length - inDiff.length} logic findings skipped (not in diff)`);
    }

    if (inDiff.length === 0) return { posted: 0, skipped: findings.length, filtered: 0 };

    // Build line comments
    const comments: LineComment[] = inDiff.map(f => ({
      path: f.filepath,
      line: f.line,
      body: `${LOGIC_MARKER_PREFIX}${f.filepath}::${f.line}::${f.category} -->\n**Logic Review** (beta) — ${f.category.replace(/_/g, ' ')}\n\n${f.message}`,
    }));

    // Dedup
    let toPost = comments;
    try {
      const existing = await getExistingCommentKeys(octokit, pr, logger);
      const dedup = filterDuplicateFindings(comments, existing.logic);
      toPost = dedup.kept;
      if (dedup.skippedKeys.length > 0) {
        logger.info(`Dedup: skipped ${dedup.skippedKeys.length} already-posted logic comments`);
      }
    } catch (error) {
      logger.warning(`Failed to fetch existing comments for logic dedup: ${error}`);
    }

    if (toPost.length === 0) return { posted: 0, skipped: findings.length, filtered: 0 };

    await postPRReview(
      octokit,
      pr,
      toPost,
      '**Logic Review** (beta) — see inline comments.',
      logger,
      'COMMENT',
    );

    return { posted: toPost.length, skipped: findings.length - inDiff.length, filtered: 0 };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function partitionByDiff(
  findings: ReviewFinding[],
  diffLines: Map<string, Set<number>>,
): { inDiff: ReviewFinding[]; outOfDiff: ReviewFinding[] } {
  const inDiff: ReviewFinding[] = [];
  const outOfDiff: ReviewFinding[] = [];

  for (const f of findings) {
    const fileLines = diffLines.get(f.filepath);
    if (!fileLines) {
      outOfDiff.push(f);
      continue;
    }

    // Check if startLine is in diff, or any line in range
    let found = false;
    const endLine = f.endLine ?? f.line;
    for (let line = f.line; line <= endLine; line++) {
      if (fileLines.has(line)) {
        found = true;
        break;
      }
    }

    if (found) {
      inDiff.push(f);
    } else {
      outOfDiff.push(f);
    }
  }

  return { inDiff, outOfDiff };
}

function buildComplexityCommentBody(finding: ReviewFinding, context: AdapterContext): string {
  const metadata = finding.metadata as ComplexityFindingMetadata | undefined;
  const metricType = metadata?.metricType ?? 'cyclomatic';
  const complexity = metadata?.complexity ?? 0;
  const threshold = metadata?.threshold ?? 15;
  const delta = metadata?.delta;
  const symbolType = metadata?.symbolType ?? 'function';

  const metricLabel = getMetricLabel(metricType);
  const valueDisplay = formatComplexityValue(metricType, complexity);
  const thresholdDisplay = formatThresholdValue(metricType, threshold);

  const deltaStr = delta !== null && delta !== undefined ? ` (${formatDelta(delta)})` : '';
  const severityEmoji = finding.severity === 'error' ? '🔴' : '🟡';
  const metricEmoji = getMetricEmoji(metricType);

  const marker = `${COMMENT_MARKER_PREFIX}${finding.filepath}::${finding.symbolName ?? 'unknown'} -->`;
  const header = `${severityEmoji} ${metricEmoji} **${capitalize(metricLabel)}: ${valueDisplay}**${deltaStr} (threshold: ${thresholdDisplay})`;

  return `${marker}\n${header}\n\n${finding.message}`;
}

function getMetricEmoji(metricType: string): string {
  switch (metricType) {
    case 'cyclomatic':
      return '🔀';
    case 'cognitive':
      return '🧠';
    case 'halstead_effort':
      return '⏱️';
    case 'halstead_bugs':
      return '🐛';
    default:
      return '📊';
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildSummary(
  report: ComplexityReport,
  deltas: ComplexityDelta[] | null,
  uncoveredCount: number,
  model: string,
  archNotes?: Array<{ observation: string; evidence: string; suggestion: string }>,
): string {
  const { summary } = report;
  const headerLine = buildHeaderLine(summary.totalViolations, deltas);
  const uncoveredNote =
    uncoveredCount > 0
      ? `\n\n<details>\n<summary>ℹ️ ${uncoveredCount} violation${uncoveredCount === 1 ? '' : 's'} outside diff</summary>\n\nThese violations are in files touched by this PR but the affected lines aren't in the diff.\n\n</details>`
      : '';

  const archNotesSection =
    archNotes && archNotes.length > 0
      ? `\n\n### Architectural observations (beta)\n\n${archNotes.map(n => `> **${n.observation}**\n> ${n.evidence}\n> *Suggestion: ${n.suggestion}*`).join('\n\n')}`
      : '';

  return `<!-- lien-ai-review -->
## Lien Review

${headerLine}
${archNotesSection}
See inline comments on the diff for specific suggestions.${uncoveredNote}

<details>
<summary>📊 Analysis Details</summary>

- Model: \`${model}\`
- Files analyzed: ${summary.filesAnalyzed}
- Average complexity: ${summary.avgComplexity.toFixed(1)}
- Max complexity: ${summary.maxComplexity}

</details>

*[Lien Review](https://lien.dev)*`;
}

interface DedupResult {
  kept: LineComment[];
  skippedKeys: string[];
}

function filterDuplicateFindings(
  comments: LineComment[],
  existingKeys: Map<string, string> | Set<string>,
): DedupResult {
  if (
    (existingKeys instanceof Map && existingKeys.size === 0) ||
    (existingKeys instanceof Set && existingKeys.size === 0)
  ) {
    return { kept: comments, skippedKeys: [] };
  }

  const kept: LineComment[] = [];
  const skippedKeys: string[] = [];

  for (const c of comments) {
    // Try to extract key from comment marker
    const markerPrefixes = [COMMENT_MARKER_PREFIX, LOGIC_MARKER_PREFIX];
    let foundKey: string | null = null;

    for (const prefix of markerPrefixes) {
      const markerStart = c.body.indexOf(prefix);
      if (markerStart === -1) continue;
      const keyStart = markerStart + prefix.length;
      const markerEnd = c.body.indexOf(' -->', keyStart);
      if (markerEnd === -1) continue;
      foundKey = c.body.slice(keyStart, markerEnd);
      break;
    }

    if (
      foundKey &&
      (existingKeys instanceof Map ? existingKeys.has(foundKey) : existingKeys.has(foundKey))
    ) {
      skippedKeys.push(foundKey);
    } else {
      kept.push(c);
    }
  }

  return { kept, skippedKeys };
}
