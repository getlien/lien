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
  buildHeaderLine,
  buildDescriptionBadge,
  getMetricLabel,
  getMetricEmoji,
  formatComplexityValue,
  formatThresholdValue,
} from '../prompt.js';
import { formatDelta, calculateDeltaSummary, logDeltaSummary } from '../delta.js';
import { formatDeltaValue } from '../format.js';
import { updatePRDescription } from '../github-api.js';
import type { Logger } from '../logger.js';

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

    await updatePRDescription(
      octokit,
      pr,
      buildDescriptionBadge(context.complexityReport, context.deltaSummary, context.deltas),
      logger,
    );

    if (findings.length === 0) {
      return { posted: 0, skipped: 0, filtered: 0 };
    }

    if (context.deltaSummary) logDeltaSummary(context.deltaSummary, logger);

    const groups = splitFindingsByPlugin(findings);
    return this.postAllReviews(groups, octokit, pr, context);
  }

  private async postAllReviews(
    groups: FindingGroups,
    octokit: Octokit,
    pr: PRContext,
    context: AdapterContext,
  ): Promise<AdapterResult> {
    const totals = { posted: 0, skipped: 0, filtered: 0 };

    if (groups.complexity.length > 0) {
      const complexityResult = await this.postComplexityReview(
        groups.complexity,
        octokit,
        pr,
        context,
        groups.architectural,
        groups.logic,
        groups.other,
      );
      addResult(totals, complexityResult);
    }

    if (groups.logic.length > 0) {
      addResult(totals, await this.postLogicReview(groups.logic, octokit, pr, context));
    }

    if (groups.other.length > 0) {
      addResult(totals, await this.postGenericReview(groups.other, octokit, pr, context));
    }

    return totals;
  }

  private async postComplexityReview(
    findings: ReviewFinding[],
    octokit: Octokit,
    pr: PRContext,
    context: AdapterContext,
    architecturalFindings: ReviewFinding[],
    logicFindings: ReviewFinding[],
    otherFindings: ReviewFinding[] = [],
  ): Promise<AdapterResult> {
    const { logger } = context;
    const { diffLines } = await getPRPatchData(octokit, pr);
    logger.info(`Diff covers ${diffLines.size} files`);

    // Partition and filter findings
    const { inDiff, outOfDiff } = partitionByDiff(findings, diffLines);
    const { marginal, nonMarginal } = separateMarginalFindings(inDiff);
    logger.info(
      `${inDiff.length}/${findings.length} in diff, ${marginal.length} marginal, ${outOfDiff.length} outside`,
    );

    // Build and dedup line comments
    const lineComments: LineComment[] = nonMarginal.map(f => ({
      path: f.filepath,
      line: f.endLine ?? f.line,
      start_line: f.line,
      body: buildComplexityCommentBody(f),
    }));

    const { toPost, skippedKeys, commentUrls } = await dedupComments(
      lineComments,
      octokit,
      pr,
      'complexity',
      logger,
    );

    // Build summary
    const summaryBody = buildComplexitySummary(
      context,
      outOfDiff,
      marginal,
      skippedKeys,
      nonMarginal,
      commentUrls,
      architecturalFindings,
      logicFindings,
      otherFindings,
    );

    // Determine review event type: REQUEST_CHANGES if blockOnNewErrors and new errors exist
    const hasNewErrors = context.blockOnNewErrors && nonMarginal.some(f => f.severity === 'error');
    const event = hasNewErrors ? 'REQUEST_CHANGES' : 'COMMENT';

    if (toPost.length === 0) {
      await postPRComment(octokit, pr, summaryBody, logger);
    } else {
      await postPRReview(octokit, pr, toPost, summaryBody, logger, event);
      logger.info(`Posted review with ${toPost.length} inline comments (event: ${event})`);
    }

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

    const comments: LineComment[] = inDiff.map(buildLogicCommentBody);
    const { toPost, skippedKeys } = await dedupComments(comments, octokit, pr, 'logic', logger);
    const skipped = findings.length - inDiff.length + skippedKeys.length;

    if (toPost.length === 0) return { posted: 0, skipped, filtered: 0 };

    await postPRReview(
      octokit,
      pr,
      toPost,
      '**Logic Review** (beta) — see inline comments.',
      logger,
      'COMMENT',
    );

    return { posted: toPost.length, skipped, filtered: 0 };
  }

  /**
   * Post findings from custom/third-party plugins as generic inline comments.
   * Ensures new plugins are not silently dropped.
   */
  private async postGenericReview(
    findings: ReviewFinding[],
    octokit: Octokit,
    pr: PRContext,
    context: AdapterContext,
  ): Promise<AdapterResult> {
    const { logger } = context;
    const { diffLines } = await getPRPatchData(octokit, pr);

    // Filter to diff lines
    const inDiff = findings.filter(f => {
      if (f.line === 0) return false;
      return diffLines.get(f.filepath)?.has(f.line);
    });
    if (inDiff.length < findings.length) {
      logger.info(
        `${findings.length - inDiff.length} custom plugin findings skipped (not in diff)`,
      );
    }

    if (inDiff.length === 0) return { posted: 0, skipped: findings.length, filtered: 0 };

    // Build line comments
    const comments: LineComment[] = inDiff.map(f => {
      const severityEmoji = f.severity === 'error' ? '🔴' : f.severity === 'warning' ? '🟡' : 'ℹ️';
      const symbolRef = f.symbolName ? ` in \`${f.symbolName}\`` : '';
      const suggestionLine = f.suggestion ? `\n\n💡 *${f.suggestion}*` : '';
      return {
        path: f.filepath,
        line: f.line,
        body: `${severityEmoji} **${f.pluginId}** — ${f.category}${symbolRef}\n\n${f.message}${suggestionLine}`,
      };
    });

    await postPRReview(
      octokit,
      pr,
      comments,
      `**${findings[0].pluginId}** — ${inDiff.length} finding${inDiff.length === 1 ? '' : 's'}. See inline comments.`,
      logger,
      'COMMENT',
    );

    return { posted: comments.length, skipped: findings.length - inDiff.length, filtered: 0 };
  }
}

// ---------------------------------------------------------------------------
// Metadata Type Guards
// ---------------------------------------------------------------------------

function getComplexityMetadata(f: ReviewFinding): ComplexityFindingMetadata | undefined {
  const m = f.metadata as Record<string, unknown> | undefined;
  if (!m || typeof m.complexity !== 'number' || typeof m.threshold !== 'number') return undefined;
  return m as unknown as ComplexityFindingMetadata;
}

// ---------------------------------------------------------------------------
// Marginal Violation Detection
// ---------------------------------------------------------------------------

/**
 * Check if a finding is marginal (within 5% of threshold).
 * Marginal findings appear in the summary but don't get inline comments.
 */
function isMarginalFinding(f: ReviewFinding): boolean {
  const metadata = getComplexityMetadata(f);
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
  const metadata = getComplexityMetadata(finding);
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

function buildLogicCommentBody(f: ReviewFinding): LineComment {
  const category = f.category.replace(/_/g, ' ');
  return {
    path: f.filepath,
    line: f.line,
    body: `${LOGIC_MARKER_PREFIX}${f.filepath}::${f.line}::${f.category} -->\n**Logic Review** (beta) — ${category}\n\n${f.message}`,
  };
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
  const metadata = getComplexityMetadata(f);
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
  const metadata = getComplexityMetadata(f);
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
  const metadata = getComplexityMetadata(f);
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
  const metadata = getComplexityMetadata(f);
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
  otherFindingsCount?: number,
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

  const otherNote =
    otherFindingsCount && otherFindingsCount > 0
      ? `\n${otherFindingsCount} additional finding${otherFindingsCount === 1 ? '' : 's'} from custom plugins posted as inline comments.`
      : '';

  const costDisplay =
    llmUsage && llmUsage.totalTokens > 0
      ? `\n- Tokens: ${llmUsage.totalTokens.toLocaleString()} ($${llmUsage.cost.toFixed(4)})`
      : '';

  return `<!-- lien-ai-review -->
## Lien Review

${headerLine}${deltaDisplay}
${archNotesSection}
See inline comments on the diff for specific suggestions.${logicNote}${otherNote}${combinedNotes}

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
  if (existingKeys.size === 0) return { kept: comments, skippedKeys: [] };

  const kept: LineComment[] = [];
  const skippedKeys: string[] = [];

  for (const c of comments) {
    const foundKey = extractCommentKey(c.body);
    if (foundKey && existingKeys.has(foundKey)) {
      skippedKeys.push(foundKey);
    } else {
      kept.push(c);
    }
  }

  return { kept, skippedKeys };
}

/** Extract the dedup key from a comment body's marker prefix. */
function extractCommentKey(body: string): string | null {
  for (const prefix of [COMMENT_MARKER_PREFIX, LOGIC_MARKER_PREFIX]) {
    const markerStart = body.indexOf(prefix);
    if (markerStart === -1) continue;
    const keyStart = markerStart + prefix.length;
    const markerEnd = body.indexOf(' -->', keyStart);
    if (markerEnd === -1) continue;
    return body.slice(keyStart, markerEnd);
  }
  return null;
}

/**
 * Fetch existing comment keys from GitHub and filter out duplicates.
 */
async function dedupComments(
  lineComments: LineComment[],
  octokit: Octokit,
  pr: PRContext,
  type: 'complexity' | 'logic',
  logger: Logger,
): Promise<{ toPost: LineComment[]; skippedKeys: string[]; commentUrls: Map<string, string> }> {
  try {
    const existing = await getExistingCommentKeys(octokit, pr, logger);
    const existingKeys = type === 'complexity' ? existing.complexity : existing.logic;
    const { kept, skippedKeys } = filterDuplicateFindings(lineComments, existingKeys);

    if (skippedKeys.length > 0) {
      logger.info(`Dedup: skipped ${skippedKeys.length} already-posted ${type} comments`);
    }

    return { toPost: kept, skippedKeys, commentUrls: existing.complexity };
  } catch (error) {
    logger.warning(`Failed to fetch existing comments for ${type} dedup: ${error}`);
    return { toPost: lineComments, skippedKeys: [], commentUrls: new Map() };
  }
}

/**
 * Assemble the full complexity review summary including architectural/logic/other notes.
 */
function buildComplexitySummary(
  context: AdapterContext,
  outOfDiff: ReviewFinding[],
  marginal: ReviewFinding[],
  skippedKeys: string[],
  nonMarginal: ReviewFinding[],
  commentUrls: Map<string, string>,
  architecturalFindings: ReviewFinding[],
  logicFindings: ReviewFinding[],
  otherFindings: ReviewFinding[],
): string {
  const combinedNotes = buildReviewNotes(
    outOfDiff,
    marginal,
    skippedKeys,
    nonMarginal,
    commentUrls,
    context.deltas,
  );

  const archNotes = architecturalFindings.map(f => ({
    observation: f.message,
    evidence: f.evidence ?? '',
    suggestion: f.suggestion ?? '',
  }));

  return buildReviewSummary(
    context.complexityReport,
    context.deltas,
    combinedNotes,
    context.model ?? 'unknown',
    archNotes,
    context.llmUsage,
    logicFindings.length,
    otherFindings.length,
  );
}

// ---------------------------------------------------------------------------
// Shared Helpers
// ---------------------------------------------------------------------------

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Finding Grouping
// ---------------------------------------------------------------------------

interface FindingGroups {
  complexity: ReviewFinding[];
  logic: ReviewFinding[];
  architectural: ReviewFinding[];
  other: ReviewFinding[];
}

function splitFindingsByPlugin(findings: ReviewFinding[]): FindingGroups {
  const groups: FindingGroups = { complexity: [], logic: [], architectural: [], other: [] };
  for (const f of findings) {
    if (f.pluginId === 'complexity') groups.complexity.push(f);
    else if (f.pluginId === 'logic') groups.logic.push(f);
    else if (f.pluginId === 'architectural') groups.architectural.push(f);
    else groups.other.push(f);
  }
  return groups;
}

function addResult(totals: AdapterResult, result: AdapterResult): void {
  totals.posted += result.posted;
  totals.skipped += result.skipped;
  totals.filtered += result.filtered;
}
