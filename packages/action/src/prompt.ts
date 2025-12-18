/**
 * Prompt builder for AI code review
 */

import collect from 'collect.js';
import type { ComplexityReport, ComplexityViolation } from '@liendev/core';
import type { PRContext } from './github.js';
import type { ComplexityDelta, DeltaSummary } from './delta.js';
import { formatDelta } from './delta.js';
import { formatTime, formatDeltaValue } from './format.js';
import type { ImpactAnalysis } from './impact-analysis.js';
import { formatImpactAnalysisForPrompt } from './impact-analysis.js';

/**
 * Create a unique key for delta lookups
 * Includes metricType since a function can have multiple metric violations
 */
function createDeltaKey(v: { filepath: string; symbolName: string; metricType: string }): string {
  return `${v.filepath}::${v.symbolName}::${v.metricType}`;
}

/**
 * Build a lookup map from deltas for quick access
 */
function buildDeltaMap(deltas: ComplexityDelta[] | null): Map<string, ComplexityDelta> {
  if (!deltas) return new Map();
  
  return new Map(
    collect(deltas)
      .map(d => [createDeltaKey(d), d] as [string, ComplexityDelta])
      .all()
  );
}

/**
 * Get human-readable label for a metric type
 */
export function getMetricLabel(metricType: string): string {
  switch (metricType) {
    case 'cognitive': return 'mental load';
    case 'cyclomatic': return 'test paths';
    case 'halstead_effort': return 'time to understand';
    case 'halstead_bugs': return 'estimated bugs';
    default: return 'complexity';
  }
}

/**
 * Format complexity value based on metric type for display
 */
export function formatComplexityValue(metricType: string, value: number): string {
  switch (metricType) {
    case 'halstead_effort':
      return `~${formatTime(value)}`;
    case 'halstead_bugs':
      return value.toFixed(2);
    case 'cyclomatic':
      return `${value} tests`;
    default:
      return value.toString();
  }
}

/**
 * Format threshold value based on metric type for display
 */
export function formatThresholdValue(metricType: string, value: number): string {
  switch (metricType) {
    case 'halstead_effort':
      return formatTime(value);
    case 'halstead_bugs':
      return value.toFixed(1);
    default:
      return value.toString();
  }
}

/**
 * Format a single violation line with optional delta
 */
function formatViolationLine(v: ComplexityViolation, deltaMap: Map<string, ComplexityDelta>): string {
  const delta = deltaMap.get(createDeltaKey(v));
  const deltaStr = delta ? ` (${formatDelta(delta.delta)})` : '';
  const metricLabel = getMetricLabel(v.metricType);
  const valueDisplay = formatComplexityValue(v.metricType, v.complexity);
  const thresholdDisplay = formatThresholdValue(v.metricType, v.threshold);
  return `  - ${v.symbolName} (${v.symbolType}): ${metricLabel} ${valueDisplay}${deltaStr} (threshold: ${thresholdDisplay}) [${v.severity}]`;
}

/**
 * Build violations summary grouped by file
 */
function buildViolationsSummary(
  files: ComplexityReport['files'],
  deltaMap: Map<string, ComplexityDelta>
): string {
  return Object.entries(files)
    .filter(([_, data]) => data.violations.length > 0)
    .map(([filepath, data]) => {
      const violationList = data.violations
        .map(v => formatViolationLine(v, deltaMap))
        .join('\n');
      return `**${filepath}** (risk: ${data.riskLevel})\n${violationList}`;
    })
    .join('\n\n');
}

/**
 * Build delta context section showing complexity changes
 */
function buildDeltaContext(deltas: ComplexityDelta[] | null): string {
  if (!deltas || deltas.length === 0) return '';
  
  const improved = deltas.filter(d => d.severity === 'improved');
  const degraded = deltas.filter(d => (d.severity === 'error' || d.severity === 'warning') && d.delta > 0);
  const newFuncs = deltas.filter(d => d.severity === 'new');
  const deleted = deltas.filter(d => d.severity === 'deleted');
  
  const formatChange = (d: ComplexityDelta): string => {
    const from = d.baseComplexity ?? 'new';
    const to = d.headComplexity ?? 'removed';
    return `  - ${d.symbolName}: ${from} → ${to} (${formatDelta(d.delta)})`;
  };
  
  const sections = [
    `\n## Complexity Changes (vs base branch)`,
    `- **Degraded**: ${degraded.length} function(s) got more complex`,
    `- **Improved**: ${improved.length} function(s) got simpler`,
    `- **New**: ${newFuncs.length} new complex function(s)`,
    `- **Removed**: ${deleted.length} complex function(s) deleted`,
  ];
  
  if (degraded.length > 0) sections.push(`\nFunctions that got worse:\n${degraded.map(formatChange).join('\n')}`);
  if (improved.length > 0) sections.push(`\nFunctions that improved:\n${improved.map(formatChange).join('\n')}`);
  if (newFuncs.length > 0) sections.push(`\nNew complex functions:\n${newFuncs.map(d => `  - ${d.symbolName}: complexity ${d.headComplexity}`).join('\n')}`);
  
  return sections.join('\n');
}

/**
 * Build code snippets section
 */
function buildSnippetsSection(codeSnippets: Map<string, string>): string {
  return Array.from(codeSnippets.entries())
    .map(([key, code]) => {
      const [filepath, symbolName] = key.split('::');
      return `### ${filepath} - ${symbolName}\n\`\`\`\n${code}\n\`\`\``;
    })
    .join('\n\n');
}

/**
 * Build the review prompt from complexity report
 */
export function buildReviewPrompt(
  report: ComplexityReport,
  prContext: PRContext,
  codeSnippets: Map<string, string>,
  deltas: ComplexityDelta[] | null = null,
  impactAnalyses: ImpactAnalysis[] = []
): string {
  const { summary, files } = report;
  const deltaMap = buildDeltaMap(deltas);
  const violationsByFile = Object.entries(files).filter(([_, data]) => data.violations.length > 0);
  const violationsSummary = buildViolationsSummary(files, deltaMap);
  const snippetsSection = buildSnippetsSection(codeSnippets);
  const deltaContext = buildDeltaContext(deltas);
  const impactSection = formatImpactAnalysisForPrompt(impactAnalyses);

  return `# Code Complexity Review Request

## Context
- **Repository**: ${prContext.owner}/${prContext.repo}
- **PR**: #${prContext.pullNumber} - ${prContext.title}
- **Files with violations**: ${violationsByFile.length}
- **Total violations**: ${summary.totalViolations} (${summary.bySeverity.error} errors, ${summary.bySeverity.warning} warnings)
${deltaContext}${impactSection ? `\n${impactSection}` : ''}
## Complexity Violations Found

${violationsSummary}

## Code Snippets

${snippetsSection || '_No code snippets available_'}

## Your Task

For each violation:
1. **Explain** why this complexity is problematic in this specific context
2. **Suggest** concrete refactoring steps (not generic advice like "break into smaller functions")
3. **Prioritize** which violations are most important to address - focus on functions that got WORSE (higher delta) or are in HIGH-IMPACT files (many dependents)
4. If the complexity seems justified for the use case, say so
5. Celebrate improvements! If a function got simpler, acknowledge it.
6. **Consider impact**: Pay extra attention to violations in files with many dependents - changes there affect more of the codebase.

Format your response as a PR review comment with:
- A brief summary at the top (2-3 sentences)
- File-by-file breakdown with specific suggestions
- Prioritized list of recommended changes

Be concise but actionable. Focus on the highest-impact improvements.`;
}

/**
 * Build a minimal prompt when there are no violations
 */
export function buildNoViolationsMessage(prContext: PRContext, deltas: ComplexityDelta[] | null = null): string {
  let deltaMessage = '';
  
  if (deltas && deltas.length > 0) {
    const improved = deltas.filter(d => d.severity === 'improved' || d.severity === 'deleted');
    if (improved.length > 0) {
      deltaMessage = `\n\n🎉 **Great job!** This PR improved complexity in ${improved.length} function(s).`;
    }
  }

  return `<!-- lien-ai-review -->
## ✅ Lien Complexity Analysis

No complexity violations found in PR #${prContext.pullNumber}.

All analyzed functions are within the configured complexity threshold.${deltaMessage}`;
}

/**
 * Token usage info for display
 */
export interface TokenUsageInfo {
  totalTokens: number;
  cost: number;
}

/**
 * Group deltas by metric type and sum their values
 */
function groupDeltasByMetric(deltas: ComplexityDelta[]): Record<string, number> {
  return collect(deltas)
    .groupBy('metricType')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((group: any) => group.sum('delta'))
    .all() as unknown as Record<string, number>;
}

/**
 * Build metric breakdown string with emojis
 * Note: getMetricEmoji is defined below (line ~441) to avoid duplication
 */
function buildMetricBreakdownForDisplay(deltaByMetric: Record<string, number>): string {
  const metricOrder = ['cyclomatic', 'cognitive', 'halstead_effort', 'halstead_bugs'];
  const emojiMap: Record<string, string> = {
    cyclomatic: '🔀',
    cognitive: '🧠',
    halstead_effort: '⏱️',
    halstead_bugs: '🐛',
  };
  return collect(metricOrder)
    .map(metricType => {
      const metricDelta = deltaByMetric[metricType] || 0;
      const emoji = emojiMap[metricType] || '📊';
      const sign = metricDelta >= 0 ? '+' : '';
      return `${emoji} ${sign}${formatDeltaValue(metricType, metricDelta)}`;
    })
    .all()
    .join(' | ');
}

/**
 * Categorize deltas into improved vs degraded counts
 */
function categorizeDeltas(deltas: ComplexityDelta[]): { improved: number; degraded: number } {
  return deltas.reduce((acc, d) => {
    if (['improved', 'deleted'].includes(d.severity)) acc.improved++;
    else if (['warning', 'error', 'new'].includes(d.severity)) acc.degraded++;
    return acc;
  }, { improved: 0, degraded: 0 });
}

/**
 * Determine trend emoji based on total delta
 */
function getTrendEmoji(totalDelta: number): string {
  if (totalDelta > 0) return '⬆️';
  if (totalDelta < 0) return '⬇️';
  return '➡️';
}

/**
 * Format delta display with per-metric breakdown
 */
function formatDeltaDisplay(deltas: ComplexityDelta[] | null | undefined): string {
  if (!deltas || deltas.length === 0) return '';
  
  const { improved, degraded } = categorizeDeltas(deltas);
  const deltaByMetric = groupDeltasByMetric(deltas);
  const metricBreakdown = buildMetricBreakdownForDisplay(deltaByMetric);
  const totalDelta = Object.values(deltaByMetric).reduce((sum, v) => sum + v, 0);
  const trend = getTrendEmoji(totalDelta);

  let display = `\n\n**Complexity Change:** ${metricBreakdown} ${trend}`;
  if (improved > 0) display += ` | ${improved} improved`;
  if (degraded > 0) display += ` | ${degraded} degraded`;
  return display;
}

/**
 * Format token usage stats for display
 */
function formatTokenStats(tokenUsage: TokenUsageInfo | undefined): string {
  if (!tokenUsage || tokenUsage.totalTokens <= 0) return '';
  return `\n- Tokens: ${tokenUsage.totalTokens.toLocaleString()} ($${tokenUsage.cost.toFixed(4)})`;
}

/**
 * Format fallback note for boy scout rule
 */
function formatFallbackNote(isFallback: boolean): string {
  if (!isFallback) return '';
  return `\n\n> 💡 *These violations exist in files touched by this PR but not on changed lines. Consider the [boy scout rule](https://www.oreilly.com/library/view/97-things-every/9780596809515/ch08.html): leave the code cleaner than you found it!*\n`;
}

/**
 * Format the AI review as a GitHub comment
 */
export function formatReviewComment(
  aiReview: string,
  report: ComplexityReport,
  isFallback = false,
  tokenUsage?: TokenUsageInfo,
  deltas?: ComplexityDelta[] | null,
  impactAnalyses: ImpactAnalysis[] = []
): string {
  const { summary } = report;
  const deltaDisplay = formatDeltaDisplay(deltas);
  const fallbackNote = formatFallbackNote(isFallback);
  const tokenStats = formatTokenStats(tokenUsage);
  const impactNote = formatImpactAnalysisForComment(impactAnalyses);
  const impactSection = impactNote ? `\n\n${impactNote}` : '';

  return `<!-- lien-ai-review -->
## 👁️ Veille

${summary.totalViolations} issue${summary.totalViolations === 1 ? '' : 's'} spotted in this PR.${deltaDisplay}${impactSection}${fallbackNote}

---

${aiReview}

---

<details>
<summary>📊 Analysis Details</summary>

- Files analyzed: ${summary.filesAnalyzed}
- Average complexity: ${summary.avgComplexity.toFixed(1)}
- Max complexity: ${summary.maxComplexity}${tokenStats}

</details>

*[Veille](https://lien.dev) by Lien*`;
}

/**
 * Get the key for a violation (for code snippet mapping)
 */
export function getViolationKey(violation: ComplexityViolation): string {
  return `${violation.filepath}::${violation.symbolName}`;
}

/**
 * Determine human-friendly status message based on violations and delta.
 * Prioritizes positive messaging when PR improves complexity.
 */
function determineStatus(
  report: ComplexityReport | null,
  deltaSummary: DeltaSummary | null
): { emoji: string; message: string } {
  const violations = report?.summary.totalViolations ?? 0;
  const errors = report?.summary.bySeverity.error ?? 0;
  const delta = deltaSummary?.totalDelta ?? 0;
  const newViolations = deltaSummary?.newFunctions ?? 0;
  const preExisting = Math.max(0, violations - newViolations);

  // PR improved complexity - celebrate it!
  if (delta < 0) {
    if (preExisting > 0) {
      return {
        emoji: '✅',
        message: `**Improved!** Complexity reduced by ${Math.abs(delta)}. ${preExisting} pre-existing issue${preExisting === 1 ? '' : 's'} remain${preExisting === 1 ? 's' : ''} in touched files.`,
      };
    }
    return { emoji: '✅', message: `**Improved!** This PR reduces complexity by ${Math.abs(delta)}.` };
  }

  // New violations introduced - these need attention
  if (newViolations > 0 && errors > 0) {
    return {
      emoji: '🔴',
      message: `**Review required** - ${newViolations} new function${newViolations === 1 ? ' is' : 's are'} too complex.`,
    };
  }

  if (newViolations > 0) {
    return {
      emoji: '⚠️',
      message: `**Needs attention** - ${newViolations} new function${newViolations === 1 ? ' is' : 's are'} more complex than recommended.`,
    };
  }

  // Only pre-existing violations (no new ones)
  if (violations > 0) {
    return {
      emoji: '➡️',
      message: `**Stable** - ${preExisting} pre-existing issue${preExisting === 1 ? '' : 's'} in touched files (none introduced).`,
    };
  }

  // No violations at all
  if (delta > 0) {
    return { emoji: '➡️', message: '**Stable** - Complexity increased slightly but within limits.' };
  }

  return { emoji: '✅', message: '**Good** - No complexity issues found.' };
}

/**
 * Format delta display string with sign and trend emoji
 */
function formatBadgeDelta(deltaSummary: DeltaSummary | null): string {
  if (!deltaSummary) return '—';

  const sign = deltaSummary.totalDelta >= 0 ? '+' : '';
  const trend = deltaSummary.totalDelta > 0 ? '⬆️' : deltaSummary.totalDelta < 0 ? '⬇️' : '➡️';
  return `${sign}${deltaSummary.totalDelta} ${trend}`;
}

/**
 * Get emoji for metric type
 */
function getMetricEmoji(metricType: string): string {
  switch (metricType) {
    case 'cyclomatic': return '🔀';
    case 'cognitive': return '🧠';
    case 'halstead_effort': return '⏱️';
    case 'halstead_bugs': return '🐛';
    default: return '📊';
  }
}

/**
 * Build the PR description stats badge
 * Human-friendly summary with metrics table
 */
export function buildDescriptionBadge(
  report: ComplexityReport | null,
  deltaSummary: DeltaSummary | null,
  deltas: ComplexityDelta[] | null,
  impactAnalyses: ImpactAnalysis[] = []
): string {
  const status = determineStatus(report, deltaSummary);

  // Build metric breakdown table with violations and deltas
  let metricTable = '';
  if (report && report.summary.totalViolations > 0) {
    // Count violations by metric type using collect.js
    const byMetric = collect(Object.values(report.files))
      .flatMap(f => f.violations)
      .countBy('metricType')
      .all() as unknown as Record<string, number>;

    // Calculate delta by metric type using collect.js
    // Note: collect.js groupBy returns groups needing sum() - types are limited
    const deltaByMetric: Record<string, number> = deltas
      ? collect(deltas)
          .groupBy('metricType')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((group: any) => group.sum('delta'))
          .all() as unknown as Record<string, number>
      : {};

    // Build table rows (only show metrics with violations)
    const metricOrder = ['cyclomatic', 'cognitive', 'halstead_effort', 'halstead_bugs'];
    const rows = collect(metricOrder)
      .filter(metricType => byMetric[metricType] > 0)
      .map(metricType => {
        const emoji = getMetricEmoji(metricType);
        const label = getMetricLabel(metricType);
        const count = byMetric[metricType];
        const delta = deltaByMetric[metricType] || 0;
        const deltaStr = deltas ? (delta >= 0 ? `+${delta}` : `${delta}`) : '—';
        return `| ${emoji} ${label} | ${count} | ${deltaStr} |`;
      })
      .all() as string[];

    if (rows.length > 0) {
      metricTable = `
| Metric | Violations | Change |
|--------|:----------:|:------:|
${rows.join('\n')}
`;
    }
  }

  // Add impact analysis summary if available
  let impactSummary = '';
  if (impactAnalyses.length > 0) {
    const highImpactCount = impactAnalyses.filter(a => ['high', 'critical'].includes(a.impactLevel)).length;
    const totalAffected = impactAnalyses.reduce((sum, a) => sum + a.totalDependents, 0);
    
    if (highImpactCount > 0) {
      impactSummary = `\n🔗 **Impact**: ${highImpactCount} high/critical impact file${highImpactCount === 1 ? '' : 's'} (${totalAffected} total affected)`;
    } else if (totalAffected > 0) {
      impactSummary = `\n🔗 **Impact**: ${totalAffected} file${totalAffected === 1 ? '' : 's'} affected (low impact)`;
    }
  }

  return `### 👁️ Veille

${status.emoji} ${status.message}${impactSummary}
${metricTable}
*[Veille](https://lien.dev) by Lien*`;
}

/**
 * Build Halstead details string for prompts
 */
function formatHalsteadContext(violation: ComplexityViolation): string {
  if (!violation.metricType?.startsWith('halstead_')) return '';
  if (!violation.halsteadDetails) return '';
  
  const details = violation.halsteadDetails;
  return `\n**Halstead Metrics**: Volume: ${details.volume?.toLocaleString()}, Difficulty: ${details.difficulty?.toFixed(1)}, Effort: ${details.effort?.toLocaleString()}, Est. bugs: ${details.bugs?.toFixed(3)}`;
}

/**
 * Build a prompt for generating a single line comment for a violation
 */
export function buildLineCommentPrompt(
  violation: ComplexityViolation,
  codeSnippet: string | null
): string {
  const snippetSection = codeSnippet
    ? `\n\n**Code:**\n\`\`\`\n${codeSnippet}\n\`\`\``
    : '';
  
  const metricType = violation.metricType || 'cyclomatic';
  const metricLabel = getMetricLabel(metricType);
  const valueDisplay = formatComplexityValue(metricType, violation.complexity);
  const thresholdDisplay = formatThresholdValue(metricType, violation.threshold);
  const halsteadContext = formatHalsteadContext(violation);

  return `You are reviewing code for complexity. Generate an actionable review comment.

**Function**: \`${violation.symbolName}\` (${violation.symbolType})
**Complexity**: ${valueDisplay} ${metricLabel} (threshold: ${thresholdDisplay})${halsteadContext}
${snippetSection}

Write a code review comment that includes:

1. **Problem** (1 sentence): What specific pattern makes this complex (e.g., "5 levels of nested conditionals", "switch with embedded if-chains", "many unique operators")

2. **Refactoring** (2-3 sentences): Concrete steps to reduce complexity. Be SPECIFIC:
   - Name the exact functions to extract (e.g., "Extract \`handleAdminDelete()\` and \`handleModeratorDelete()\`")
   - Suggest specific patterns (strategy, lookup table, early returns)
   - For Halstead metrics: suggest introducing named constants, reducing operator variety, or extracting complex expressions
   - If applicable, show a brief code sketch

3. **Benefit** (1 sentence): What improves (testability, readability, etc.)

Format as a single cohesive comment without headers. Be direct and specific to THIS code.`;
}

/**
 * Build a summary comment when using line-specific reviews
 */
export function buildLineSummaryComment(
  report: ComplexityReport,
  prContext: PRContext
): string {
  const { summary } = report;
  const emoji = summary.bySeverity.error > 0 ? '🔴' : '🟡';

  return `<!-- lien-ai-review -->
## ${emoji} Veille

${summary.totalViolations} issue${summary.totalViolations === 1 ? '' : 's'} spotted in this PR.

See inline comments below for specific suggestions.

<details>
<summary>📊 Details</summary>

- Files analyzed: ${summary.filesAnalyzed}
- Average complexity: ${summary.avgComplexity.toFixed(1)}
- Max complexity: ${summary.maxComplexity}

</details>

*[Veille](https://lien.dev) by Lien*`;
}

/**
 * Build a batched prompt for generating multiple line comments at once
 * This is more efficient than individual prompts as:
 * - System prompt only sent once
 * - AI has full context of all violations
 * - Fewer API calls = faster + cheaper
 */
export function buildBatchedCommentsPrompt(
  violations: ComplexityViolation[],
  codeSnippets: Map<string, string>
): string {
  const violationsText = violations
    .map((v, i) => {
      const key = `${v.filepath}::${v.symbolName}`;
      const snippet = codeSnippets.get(key);
      const snippetSection = snippet
        ? `\nCode:\n\`\`\`\n${snippet}\n\`\`\``
        : '';
      
      const metricType = v.metricType || 'cyclomatic';
      const metricLabel = getMetricLabel(metricType);
      const valueDisplay = formatComplexityValue(metricType, v.complexity);
      const thresholdDisplay = formatThresholdValue(metricType, v.threshold);
      const halsteadContext = formatHalsteadContext(v);

      return `### ${i + 1}. ${v.filepath}::${v.symbolName}
- **Function**: \`${v.symbolName}\` (${v.symbolType})
- **Complexity**: ${valueDisplay} ${metricLabel} (threshold: ${thresholdDisplay})${halsteadContext}
- **Severity**: ${v.severity}${snippetSection}`;
    })
    .join('\n\n');

  // Build JSON keys for the response format
  const jsonKeys = violations
    .map((v) => `  "${v.filepath}::${v.symbolName}": "your comment here"`)
    .join(',\n');

  return `You are a senior engineer reviewing code for complexity. Generate thoughtful, context-aware review comments.

## Violations to Review

${violationsText}

## Instructions

For each violation, write a code review comment that:

1. **Identifies the specific pattern** causing complexity (not just "too complex")
   - Is it nested conditionals? Long parameter lists? Multiple responsibilities?
   - For Halstead metrics: many unique operators/operands, complex expressions
   - Be specific: "5 levels of nesting" not "deeply nested"

2. **Suggests a concrete fix** with a short code example (3-5 lines)
   - Consider: early returns, guard clauses, lookup tables, extracting helpers, strategy pattern
   - For Halstead: named constants, reducing operator variety, extracting complex expressions
   - Name specific functions: "Extract \`handleAdminCase()\`" not "extract a function"
   - Choose the SIMPLEST fix that addresses the issue (KISS principle)

3. **Acknowledges context** when relevant
   - If this is an orchestration function, complexity may be acceptable
   - If the logic is inherently complex (state machines, parsers), say so
   - Don't suggest over-engineering for marginal gains

Be direct and specific to THIS code. Avoid generic advice like "break into smaller functions."

IMPORTANT: Do NOT include headers like "Complexity: X" or emojis - we add those.

## Response Format

Respond with ONLY valid JSON. Each key is "filepath::symbolName", value is the comment text.
Use \\n for newlines within comments.

\`\`\`json
{
${jsonKeys}
}
\`\`\``;
}

