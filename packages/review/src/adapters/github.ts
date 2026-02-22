/**
 * GitHub output adapter.
 *
 * Extracts diff filtering, dedup, comment building, and posting from review-engine.ts.
 * Receives ReviewFinding[], handles all GitHub-specific concerns.
 */

import type { Octokit } from '@octokit/rest';
import type { ComplexityReport } from '@liendev/parser';
import type {
  OutputAdapter,
  AdapterResult,
  AdapterContext,
  ReviewFinding,
  ComplexityFindingMetadata,
} from '../plugin-types.js';
import type { PRContext, LineComment } from '../types.js';
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
import { formatDelta, calculateDeltaSummary, logDeltaSummary } from '../delta.js';
import { formatDeltaValue } from '../format.js';
import { updatePRDescription } from '../github-api.js';

const BOY_SCOUT_LINK =
  '[boy scout rule](https://www.oreilly.com/library/view/97-things-every/9780596809515/ch08.html)';

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

    // Post complexity review (inline comments + summary) — this is the main review
    const complexityResult = await this.postComplexityReview(
      complexityFindings,
      octokit,
      pr,
      context,
      architecturalFindings,
      logicFindings,
    );
    posted += complexityResult.posted;
    skipped += complexityResult.skipped;
    filtered += complexityResult.filtered;

    // Post logic review comments (separate review, no duplicate summary)
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
    logicFindings: ReviewFinding[],
  ): Promise<AdapterResult> {
    const { logger } = context;
    const { diffLines } = await getPRPatchData(octokit, pr);
    logger.info(`Diff covers ${diffLines.size} files`);

    // Partition complexity findings by diff
    const { inDiff, outOfDiff } = partitionByDiff(findings, diffLines);
    logger.info(
      `${inDiff.length}/${findings.length} complexity findings in diff (${outOfDiff.length} outside)`,
    );

    // Separate marginal findings (barely over threshold — summary only, no inline comments)
    const { marginal, nonMarginal } = separateMarginalFindings(inDiff);
    if (marginal.length > 0) {
      logger.info(`${marginal.length} findings near threshold (summary only)`);
    }

    // Build line comments for non-marginal in-diff findings
    const lineComments: LineComment[] = nonMarginal.map(f => ({
      path: f.filepath,
      line: f.endLine ?? f.line,
      start_line: f.line,
      body: buildComplexityCommentBody(f),
    }));

    // Dedup against existing comments
    let toPost = lineComments;
    let skippedKeys: string[] = [];
    let commentUrls = new Map<string, string>();
    try {
      const existing = await getExistingCommentKeys(octokit, pr, logger);
      commentUrls = existing.complexity;
      const dedup = filterDuplicateFindings(lineComments, existing.complexity);
      toPost = dedup.kept;
      skippedKeys = dedup.skippedKeys;
      if (skippedKeys.length > 0) {
        logger.info(`Dedup: ${skippedKeys.length} complexity comments already posted`);
      }
    } catch (error) {
      logger.warning(`Failed to fetch existing comments for dedup: ${error}`);
    }

    // Build combined notes for the summary
    const notes = buildReviewNotes(
      outOfDiff,
      marginal,
      skippedKeys,
      nonMarginal,
      commentUrls,
      context.deltas,
    );

    // Build architectural notes
    const archNotes = architecturalFindings.map(f => ({
      observation: f.message,
      evidence: f.evidence ?? '',
      suggestion: f.suggestion ?? '',
    }));

    // Build summary body with all sections
    const summaryBody = buildReviewSummary(
      context.complexityReport,
      context.deltas,
      notes,
      context.model ?? 'unknown',
      archNotes.length > 0 ? archNotes : undefined,
      context.llmUsage,
      logicFindings.length,
    );

    if (toPost.length === 0) {
      // No new inline comments — post summary as a regular comment
      await postPRComment(octokit, pr, summaryBody, logger);
      return {
        posted: 0,
        skipped: skippedKeys.length + outOfDiff.length + marginal.length,
        filtered: 0,
      };
    }

    // Post review with inline comments + summary
    await postPRReview(octokit, pr, toPost, summaryBody, logger, 'COMMENT');
    logger.info(`Posted review with ${toPost.length} inline comments`);

    return {
      posted: toPost.length,
      skipped: skippedKeys.length + outOfDiff.length + marginal.length,
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

    // Post logic review with brief summary (main summary is in complexity review)
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
// Marginal Violation Detection
// ---------------------------------------------------------------------------

/**
 * Check if a finding is marginal (within 5% of threshold).
 * Marginal findings appear in the summary but don't get inline comments.
 */
function isMarginalFinding(f: ReviewFinding): boolean {
  const metadata = f.metadata as ComplexityFindingMetadata | undefined;
  if (!metadata) return false;
  const { complexity, threshold } = metadata;
  if (threshold <= 0) return false;
  const overage = (complexity - threshold) / threshold;
  return overage > 0 && overage <= 0.05;
}

function separateMarginalFindings(findings: ReviewFinding[]): {
  marginal: ReviewFinding[];
  nonMarginal: ReviewFinding[];
} {
  const marginal: ReviewFinding[] = [];
  const nonMarginal: ReviewFinding[] = [];
  for (const f of findings) {
    if (isMarginalFinding(f)) {
      marginal.push(f);
    } else {
      nonMarginal.push(f);
    }
  }
  return { marginal, nonMarginal };
}

// ---------------------------------------------------------------------------
// Diff Partitioning
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

    // Check if any line in range is in diff
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

// ---------------------------------------------------------------------------
// Comment Body Building
// ---------------------------------------------------------------------------

function buildComplexityCommentBody(finding: ReviewFinding): string {
  const metadata = finding.metadata as ComplexityFindingMetadata | undefined;
  const metricType = metadata?.metricType ?? 'cyclomatic';
  const complexity = metadata?.complexity ?? 0;
  const threshold = metadata?.threshold ?? 15;
  const delta = metadata?.delta;
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

// ---------------------------------------------------------------------------
// Summary Note Building (matching old engine quality)
// ---------------------------------------------------------------------------

/**
 * Build combined notes string for the review summary.
 * This matches the old engine's buildReviewNotes() output.
 */
function buildReviewNotes(
  outOfDiff: ReviewFinding[],
  marginal: ReviewFinding[],
  skippedKeys: string[],
  inDiffFindings: ReviewFinding[],
  commentUrls: Map<string, string>,
  deltas: ComplexityDelta[] | null,
): string {
  return (
    buildUncoveredNote(outOfDiff, deltas) +
    buildMarginalNote(marginal) +
    buildDedupNote(skippedKeys, inDiffFindings, commentUrls)
  );
}

/**
 * Build note for violations outside the diff.
 * Splits into new/worsened (prominent) vs pre-existing (collapsed).
 */
function buildUncoveredNote(outOfDiff: ReviewFinding[], deltas: ComplexityDelta[] | null): string {
  if (outOfDiff.length === 0) return '';

  const deltaMap = buildDeltaMap(deltas);

  // Categorize by delta severity
  const newOrWorsened = outOfDiff.filter(f => {
    const delta = findDeltaForFinding(f, deltaMap);
    return delta !== null && (delta.severity === 'new' || delta.delta > 0);
  });

  const preExisting = outOfDiff.filter(f => {
    const delta = findDeltaForFinding(f, deltaMap);
    return delta === null || delta.delta === 0;
  });

  // Fallback: if no delta data, show all in collapsed section
  if (newOrWorsened.length === 0 && preExisting.length === 0) {
    return buildFallbackUncoveredSection(outOfDiff, deltaMap);
  }

  return (
    buildNewWorsenedSection(newOrWorsened, deltaMap) +
    buildPreExistingSection(preExisting, deltaMap)
  );
}

function buildNewWorsenedSection(
  findings: ReviewFinding[],
  deltaMap: Map<string, ComplexityDelta>,
): string {
  if (findings.length === 0) return '';
  const list = findings.map(f => formatUncoveredLine(f, deltaMap)).join('\n');
  return `\n\n⚠️ **${findings.length} new/worsened violation${findings.length === 1 ? '' : 's'} outside diff:**\n\n${list}`;
}

function buildPreExistingSection(
  findings: ReviewFinding[],
  deltaMap: Map<string, ComplexityDelta>,
): string {
  if (findings.length === 0) return '';
  const list = findings.map(f => formatUncoveredLine(f, deltaMap)).join('\n');
  return `\n\n<details>\n<summary>ℹ️ ${findings.length} pre-existing violation${findings.length === 1 ? '' : 's'} outside diff</summary>\n\n${list}\n\n> *These violations existed before this PR. No action required, but consider the ${BOY_SCOUT_LINK}!*\n\n</details>`;
}

function buildFallbackUncoveredSection(
  findings: ReviewFinding[],
  deltaMap: Map<string, ComplexityDelta>,
): string {
  const list = findings.map(f => formatUncoveredLine(f, deltaMap)).join('\n');
  return `\n\n<details>\n<summary>⚠️ ${findings.length} violation${findings.length === 1 ? '' : 's'} outside diff (no inline comment)</summary>\n\n${list}\n\n> 💡 *These exist in files touched by this PR but the function declarations aren't in the diff. Consider the ${BOY_SCOUT_LINK}!*\n\n</details>`;
}

function formatUncoveredLine(f: ReviewFinding, deltaMap: Map<string, ComplexityDelta>): string {
  const metadata = f.metadata as ComplexityFindingMetadata | undefined;
  const metricType = metadata?.metricType ?? 'cyclomatic';
  const complexity = metadata?.complexity ?? 0;
  const delta = findDeltaForFinding(f, deltaMap);
  const deltaStr = delta ? ` (${formatDelta(delta.delta)})` : '';
  const emoji = getMetricEmoji(metricType);
  const metricLabel = getMetricLabel(metricType);
  const valueDisplay = formatComplexityValue(metricType, complexity);
  return `* \`${f.symbolName ?? 'unknown'}\` in \`${f.filepath}\`: ${emoji} ${metricLabel} ${valueDisplay}${deltaStr}`;
}

/**
 * Build note for marginal violations (near threshold, no inline comment).
 */
function buildMarginalNote(marginal: ReviewFinding[]): string {
  if (marginal.length === 0) return '';

  const list = marginal.map(formatFindingListItem).join('\n');
  return `\n\n<details>\n<summary>ℹ️ ${marginal.length} near-threshold violation${marginal.length === 1 ? '' : 's'} (no inline comment)</summary>\n\n${list}\n\n> *These functions are within 5% of the threshold. A light-touch refactoring (early return, extract one expression) may bring them under.*\n\n</details>`;
}

/**
 * Build note for violations already commented on in a previous review round.
 * Groups all metrics under one symbol heading with severity and comment links.
 */
function buildDedupNote(
  skippedKeys: string[],
  inDiffFindings: ReviewFinding[],
  commentUrls: Map<string, string>,
): string {
  if (skippedKeys.length === 0) return '';

  // Group all findings by dedup key (filepath::symbolName) to show all triggered metrics
  const findingsByKey = new Map<string, ReviewFinding[]>();
  for (const f of inDiffFindings) {
    const key = `${f.filepath}::${f.symbolName ?? 'unknown'}`;
    const existing = findingsByKey.get(key);
    if (existing) {
      existing.push(f);
    } else {
      findingsByKey.set(key, [f]);
    }
  }

  const list = skippedKeys
    .map(key => formatDedupSymbol(key, findingsByKey, commentUrls))
    .join('\n');

  return `\n\n<details>\n<summary>ℹ️ ${skippedKeys.length} violation${skippedKeys.length === 1 ? '' : 's'} already reviewed in a previous round — not re-posted</summary>\n\n${list}\n\n</details>`;
}

function formatDedupSymbol(
  key: string,
  findingsByKey: Map<string, ReviewFinding[]>,
  commentUrls: Map<string, string>,
): string {
  const sep = key.lastIndexOf('::');
  const symbol = sep !== -1 ? key.slice(sep + 2) : key;
  const file = sep !== -1 ? key.slice(0, sep) : '';
  const url = commentUrls.get(key);
  const symbolRef = url
    ? `\`${symbol}\` in \`${file}\` ([review comment](${url}))`
    : `\`${symbol}\` in \`${file}\``;

  const fs = findingsByKey.get(key);
  if (!fs || fs.length === 0) return `  - ${symbolRef}`;

  const metricLines = fs.map(formatDedupMetricLine).join('\n');
  return `  - ${symbolRef}\n${metricLines}`;
}

function formatDedupMetricLine(f: ReviewFinding): string {
  const metadata = f.metadata as ComplexityFindingMetadata | undefined;
  const metricType = metadata?.metricType ?? 'cyclomatic';
  const complexity = metadata?.complexity ?? 0;
  const threshold = metadata?.threshold ?? 15;
  const severityEmoji = f.severity === 'error' ? '🔴' : '🟡';
  return `    - ${severityEmoji} ${getMetricEmoji(metricType)} ${getMetricLabel(metricType)}: ${formatComplexityValue(metricType, complexity)} (threshold: ${formatThresholdValue(metricType, threshold)})`;
}

/**
 * Format a finding as a summary list item (shared by marginal/skipped notes).
 */
function formatFindingListItem(f: ReviewFinding): string {
  const metadata = f.metadata as ComplexityFindingMetadata | undefined;
  const metricType = metadata?.metricType ?? 'cyclomatic';
  const complexity = metadata?.complexity ?? 0;
  const threshold = metadata?.threshold ?? 15;
  const metricLabel = getMetricLabel(metricType);
  const valueDisplay = formatComplexityValue(metricType, complexity);
  const thresholdDisplay = formatThresholdValue(metricType, threshold);
  return `  - \`${f.symbolName ?? 'unknown'}\` in \`${f.filepath}\`: ${metricLabel} ${valueDisplay} (threshold: ${thresholdDisplay})`;
}

// ---------------------------------------------------------------------------
// Delta Display (matching old engine)
// ---------------------------------------------------------------------------

function buildDeltaMap(deltas: ComplexityDelta[] | null): Map<string, ComplexityDelta> {
  const map = new Map<string, ComplexityDelta>();
  if (!deltas) return map;
  for (const d of deltas) {
    map.set(`${d.filepath}::${d.symbolName}::${d.metricType}`, d);
  }
  return map;
}

function findDeltaForFinding(
  f: ReviewFinding,
  deltaMap: Map<string, ComplexityDelta>,
): ComplexityDelta | null {
  const metadata = f.metadata as ComplexityFindingMetadata | undefined;
  const metricType = metadata?.metricType ?? 'cyclomatic';
  const key = `${f.filepath}::${f.symbolName ?? 'unknown'}::${metricType}`;
  return deltaMap.get(key) ?? null;
}

function formatDeltaDisplay(deltas: ComplexityDelta[] | null): string {
  if (!deltas || deltas.length === 0) return '';

  const deltaSummary = calculateDeltaSummary(deltas);

  if (
    deltaSummary.totalDelta === 0 &&
    deltaSummary.improved === 0 &&
    deltaSummary.newFunctions === 0
  ) {
    return '\n\n**Complexity:** No change from this PR.';
  }

  const metricBreakdown = buildMetricBreakdown(deltas);
  const trend = deltaSummary.totalDelta > 0 ? '⬆️' : deltaSummary.totalDelta < 0 ? '⬇️' : '➡️';

  let display = `\n\n**Complexity Change:** ${metricBreakdown} ${trend}`;
  if (deltaSummary.improved > 0) display += ` (${deltaSummary.improved} improved)`;
  if (deltaSummary.degraded > 0) display += ` (${deltaSummary.degraded} degraded)`;
  return display;
}

function buildMetricBreakdown(deltas: ComplexityDelta[]): string {
  const metricOrder = ['cyclomatic', 'cognitive', 'halstead_effort', 'halstead_bugs'];
  const deltaByMetric: Record<string, number> = {};

  for (const d of deltas) {
    deltaByMetric[d.metricType] = (deltaByMetric[d.metricType] || 0) + d.delta;
  }

  return metricOrder
    .map(metricType => {
      const metricDelta = deltaByMetric[metricType] || 0;
      const emoji = getMetricEmoji(metricType);
      const sign = metricDelta >= 0 ? '+' : '';
      return `${emoji} ${sign}${formatDeltaValue(metricType, metricDelta)}`;
    })
    .join(' | ');
}

// ---------------------------------------------------------------------------
// Review Summary Building (matching old engine quality)
// ---------------------------------------------------------------------------

function buildReviewSummary(
  report: ComplexityReport,
  deltas: ComplexityDelta[] | null,
  combinedNotes: string,
  model: string,
  archNotes?: Array<{ observation: string; evidence: string; suggestion: string }>,
  llmUsage?: { promptTokens: number; completionTokens: number; totalTokens: number; cost: number },
  logicFindingsCount?: number,
): string {
  const { summary } = report;
  const headerLine = buildHeaderLine(summary.totalViolations, deltas);
  const deltaDisplay = formatDeltaDisplay(deltas);

  const archNotesSection =
    archNotes && archNotes.length > 0
      ? `\n\n### Architectural observations (beta)\n\n${archNotes.map(n => `> **${n.observation}**\n> ${n.evidence}\n> *Suggestion: ${n.suggestion}*`).join('\n\n')}`
      : '';

  const logicNote =
    logicFindingsCount && logicFindingsCount > 0
      ? `\n${logicFindingsCount} logic finding${logicFindingsCount === 1 ? '' : 's'} posted as separate inline comments.`
      : '';

  const costDisplay =
    llmUsage && llmUsage.totalTokens > 0
      ? `\n- Tokens: ${llmUsage.totalTokens.toLocaleString()} ($${llmUsage.cost.toFixed(4)})`
      : '';

  return `<!-- lien-ai-review -->
## Lien Review

${headerLine}${deltaDisplay}
${archNotesSection}
See inline comments on the diff for specific suggestions.${logicNote}${combinedNotes}

<details>
<summary>📊 Analysis Details</summary>

- Model: \`${model}\`
- Files analyzed: ${summary.filesAnalyzed}
- Average complexity: ${summary.avgComplexity.toFixed(1)}
- Max complexity: ${summary.maxComplexity}${costDisplay}

</details>

*[Lien Review](https://lien.dev)*`;
}

// ---------------------------------------------------------------------------
// Dedup
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Shared Helpers
// ---------------------------------------------------------------------------

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
