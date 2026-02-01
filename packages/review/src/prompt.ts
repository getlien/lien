/**
 * Prompt builder for AI code review
 */

import collect from 'collect.js';
import type { ComplexityReport, ComplexityViolation } from '@liendev/core';
import type { PRContext } from './types.js';
import type { ComplexityDelta, DeltaSummary } from './delta.js';
import { formatDelta } from './delta.js';
import { formatTime, formatDeltaValue } from './format.js';

/**
 * Few-shot examples for each complexity metric type.
 * These show the model what a good review comment looks like.
 *
 * Guidelines for these examples:
 * - Keep to 2-3 sentences (~30-40 words)
 * - Name specific functions to extract
 * - Mention line numbers or specific patterns
 * - State the concrete benefit
 */
const COMMENT_EXAMPLES: Record<string, string> = {
  cyclomatic: `The 5 permission cases (lines 45-67) can be extracted to \`checkAdminAccess()\`, \`checkEditorAccess()\`, \`checkViewerAccess()\`. Each returns early if unauthorized, reducing test paths from ~15 to ~5.`,

  cognitive: `The 6 levels of nesting create significant mental load. Flatten with guard clauses: \`if (!user) return null;\` at line 23, then \`if (!hasPermission) throw new UnauthorizedError();\` at line 28. The remaining logic becomes linear.`,

  halstead_effort: `This function uses 23 unique operators across complex expressions. Extract the date math (lines 34-41) into \`calculateDaysUntilExpiry()\` and replace magic numbers (30, 86400) with named constants.`,

  halstead_bugs: `High predicted bug density from complex expressions. The chained ternaries on lines 56-62 should be a lookup object: \`const STATUS_MAP = { pending: 'yellow', approved: 'green', ... }\`. Reduces operator count and improves readability.`,
};

// Default to cyclomatic if metric type not found
const DEFAULT_EXAMPLE = COMMENT_EXAMPLES.cyclomatic;

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
 * Build dependency context string for a file
 * Shows dependents count, key dependents list, and complexity metrics
 */
function buildDependencyContext(fileData: ComplexityReport['files'][string]): string {
  if (!fileData.dependentCount || fileData.dependentCount === 0) {
    return '';
  }

  const riskEmoji: Record<string, string> = {
    low: '🟢',
    medium: '🟡',
    high: '🟠',
    critical: '🔴',
  };

  const emoji = riskEmoji[fileData.riskLevel] || '⚪';

  // Build dependents list (only if we have the array and it's not empty)
  const hasDependentsList = fileData.dependents && fileData.dependents.length > 0;
  const dependentsList = hasDependentsList
    ? fileData.dependents.slice(0, 10).map(f => `  - ${f}`).join('\n')
    : '';

  const complexityNote = fileData.dependentComplexityMetrics
    ? `\n- **Dependent complexity**: Avg ${fileData.dependentComplexityMetrics.averageComplexity.toFixed(1)}, Max ${fileData.dependentComplexityMetrics.maxComplexity}`
    : '';

  const moreNote = hasDependentsList && fileData.dependents.length > 10
    ? '\n  ... (and more)'
    : '';

  return `\n**Dependency Impact**: ${emoji} ${fileData.riskLevel.toUpperCase()} risk
- **Dependents**: ${fileData.dependentCount} file(s) import this
${dependentsList ? `\n**Key dependents:**\n${dependentsList}${moreNote}` : ''}${complexityNote}
- **Review focus**: Changes here affect ${fileData.dependentCount} other file(s). Extra scrutiny recommended.`;
}

/**
 * Language name lookup by internal language identifier
 */
const LANGUAGE_NAMES: Record<string, string> = {
  'typescript': 'TypeScript',
  'javascript': 'JavaScript',
  'php': 'PHP',
  'python': 'Python',
  'go': 'Go',
  'rust': 'Rust',
  'java': 'Java',
  'ruby': 'Ruby',
  'swift': 'Swift',
  'kotlin': 'Kotlin',
  'csharp': 'C#',
  'scala': 'Scala',
  'cpp': 'C++',
  'c': 'C',
};

/**
 * Language name lookup by file extension
 */
const EXTENSION_LANGUAGES: Record<string, string> = {
  'ts': 'TypeScript', 'tsx': 'TypeScript React',
  'js': 'JavaScript', 'jsx': 'JavaScript React', 'mjs': 'JavaScript', 'cjs': 'JavaScript',
  'php': 'PHP', 'py': 'Python', 'go': 'Go', 'rs': 'Rust',
  'java': 'Java', 'rb': 'Ruby', 'swift': 'Swift', 'kt': 'Kotlin',
  'cs': 'C#', 'scala': 'Scala', 'cpp': 'C++', 'cc': 'C++', 'cxx': 'C++', 'c': 'C',
};

/**
 * File type patterns detected from path
 */
const FILE_TYPE_PATTERNS: Array<{ pattern: string; type: string }> = [
  { pattern: 'controller', type: 'Controller' },
  { pattern: 'service', type: 'Service' },
  { pattern: 'component', type: 'Component' },
  { pattern: 'middleware', type: 'Middleware' },
  { pattern: 'handler', type: 'Handler' },
  { pattern: 'util', type: 'Utility' },
  { pattern: 'helper', type: 'Utility' },
  { pattern: '_test.', type: 'Test' },
  { pattern: '/model/', type: 'Model' },
  { pattern: '/models/', type: 'Model' },
  { pattern: '/repository/', type: 'Repository' },
  { pattern: '/repositories/', type: 'Repository' },
];

/**
 * Detect language display name from violation data or file extension
 */
function detectLanguage(filepath: string, violations: ComplexityViolation[]): string | null {
  const languageFromViolation = violations[0]?.language;
  if (languageFromViolation) {
    return LANGUAGE_NAMES[languageFromViolation.toLowerCase()] || languageFromViolation;
  }

  const ext = filepath.split('.').pop()?.toLowerCase();
  return ext ? EXTENSION_LANGUAGES[ext] || null : null;
}

/**
 * Detect file type from path patterns
 */
function detectFileType(filepath: string): string | null {
  const pathLower = filepath.toLowerCase();
  const match = FILE_TYPE_PATTERNS.find(p => pathLower.includes(p.pattern));
  return match?.type || null;
}

/**
 * Build file-level context (other violations, file purpose hints)
 * Uses language from violations when available, falls back to file extension
 */
function buildFileContext(filepath: string, fileData: ComplexityReport['files'][string]): string {
  const parts: string[] = [];

  const language = detectLanguage(filepath, fileData.violations);
  if (language) parts.push(`Language: ${language}`);

  const fileType = detectFileType(filepath);
  if (fileType) parts.push(`Type: ${fileType}`);

  if (fileData.violations.length > 1) {
    parts.push(`${fileData.violations.length} total violations in this file`);
  }

  return parts.length > 0 ? `\n*Context: ${parts.join(', ')}*` : '';
}

/**
 * Check if a violation is new or worsened based on delta data
 */
function isNewOrWorsened(v: ComplexityViolation, deltaMap: Map<string, ComplexityDelta>): boolean {
  const delta = deltaMap.get(createDeltaKey(v));
  return !!delta && (delta.severity === 'new' || delta.delta > 0);
}

/**
 * Group violations by filepath
 */
function groupViolationsByFile(violations: ComplexityViolation[]): Map<string, ComplexityViolation[]> {
  const byFile = new Map<string, ComplexityViolation[]>();
  for (const v of violations) {
    const existing = byFile.get(v.filepath) || [];
    existing.push(v);
    byFile.set(v.filepath, existing);
  }
  return byFile;
}

/**
 * Format a group of violations organized by file
 */
function formatFileGroup(
  violations: ComplexityViolation[],
  files: ComplexityReport['files'],
  deltaMap: Map<string, ComplexityDelta>
): string {
  return Array.from(groupViolationsByFile(violations).entries())
    .map(([filepath, vs]) => {
      const fileData = files[filepath];
      const violationList = vs.map(v => formatViolationLine(v, deltaMap)).join('\n');
      const dependencyContext = fileData ? buildDependencyContext(fileData) : '';
      const fileContext = fileData ? buildFileContext(filepath, fileData) : '';
      return `**${filepath}** (risk: ${fileData?.riskLevel || 'unknown'})${fileContext}\n${violationList}${dependencyContext}`;
    })
    .join('\n\n');
}

/**
 * Build violations summary grouped by file
 * When delta data is available, separates new/worsened from pre-existing
 */
function buildViolationsSummary(
  files: ComplexityReport['files'],
  deltaMap: Map<string, ComplexityDelta>
): string {
  if (deltaMap.size === 0) {
    const allViolations = Object.values(files).flatMap(data => data.violations);
    return formatFileGroup(allViolations, files, deltaMap);
  }

  const allViolations = Object.values(files)
    .filter(data => data.violations.length > 0)
    .flatMap(data => data.violations);

  const newViolations = allViolations.filter(v => isNewOrWorsened(v, deltaMap));
  const preExisting = allViolations.filter(v => !isNewOrWorsened(v, deltaMap));

  const sections: string[] = [];

  if (newViolations.length > 0) {
    sections.push(`### New/Worsened Violations (introduced or worsened in this PR)\n\n${formatFileGroup(newViolations, files, deltaMap)}`);
  }

  if (preExisting.length > 0) {
    sections.push(`### Pre-existing Violations (in files touched by this PR)\n\n${formatFileGroup(preExisting, files, deltaMap)}`);
  }

  return sections.join('\n\n');
}

/**
 * Format a single delta change for display
 */
function formatDeltaChange(d: ComplexityDelta): string {
  const from = d.baseComplexity ?? 'new';
  const to = d.headComplexity ?? 'removed';
  return `  - ${d.symbolName}: ${from} → ${to} (${formatDelta(d.delta)})`;
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

  const sections = [
    `\n## Complexity Changes (vs base branch)`,
    `- **Degraded**: ${degraded.length} function(s) got more complex`,
    `- **Improved**: ${improved.length} function(s) got simpler`,
    `- **New**: ${newFuncs.length} new complex function(s)`,
    `- **Removed**: ${deleted.length} complex function(s) deleted`,
  ];

  if (degraded.length > 0) {
    sections.push(`\nFunctions that got worse:\n${degraded.map(formatDeltaChange).join('\n')}`);
  }
  if (improved.length > 0) {
    sections.push(`\nFunctions that improved:\n${improved.map(formatDeltaChange).join('\n')}`);
  }
  if (newFuncs.length > 0) {
    sections.push(`\nNew complex functions:\n${newFuncs.map(d => `  - ${d.symbolName}: complexity ${d.headComplexity}`).join('\n')}`);
  }

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
  deltas: ComplexityDelta[] | null = null
): string {
  const { summary, files } = report;
  const deltaMap = buildDeltaMap(deltas);
  const violationsByFile = Object.entries(files).filter(([_, data]) => data.violations.length > 0);
  const violationsSummary = buildViolationsSummary(files, deltaMap);
  const snippetsSection = buildSnippetsSection(codeSnippets);
  const deltaContext = buildDeltaContext(deltas);

  return `# Code Complexity Review Request

## Context
- **Repository**: ${prContext.owner}/${prContext.repo}
- **PR**: #${prContext.pullNumber} - ${prContext.title}
- **Files with violations**: ${violationsByFile.length}
- **Total violations**: ${summary.totalViolations} (${summary.bySeverity.error} errors, ${summary.bySeverity.warning} warnings)
${deltaContext}
## Complexity Violations Found

${violationsSummary}

## Code Snippets

${snippetsSection || '_No code snippets available_'}

## Your Task

**IMPORTANT**: Before suggesting refactorings, analyze the code snippets below to identify the codebase's patterns:
- Are utilities implemented as functions or classes?
- How are similar refactorings done elsewhere in the codebase?
- What naming conventions are used?
- How is code organized (modules, files, exports)?

For each violation:
1. **Explain** why this complexity is problematic in this specific context
   - Consider the file type (controller, service, component, etc.) and language
   - Note if this is the only violation in the file or one of many
   - Consider dependency impact - high-risk files need extra scrutiny
2. **Suggest** concrete refactoring steps (not generic advice like "break into smaller functions")
   - Be specific to the language and framework patterns
   - Consider file type conventions (e.g., controllers often delegate to services)
   - **Match the existing codebase patterns** - if utilities are functions, suggest functions; if they're classes, suggest classes
3. **Prioritize** which violations are most important to address - focus on functions that got WORSE (higher delta)
4. If the complexity seems justified for the use case, say so
   - Some patterns (orchestration, state machines) may legitimately be complex
5. Celebrate improvements! If a function got simpler, acknowledge it.

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
 * When all deltas are zero, shows a simple "no change" message
 */
function formatDeltaDisplay(deltas: ComplexityDelta[] | null | undefined): string {
  if (!deltas || deltas.length === 0) return '';

  const { improved, degraded } = categorizeDeltas(deltas);
  const deltaByMetric = groupDeltasByMetric(deltas);
  const totalDelta = Object.values(deltaByMetric).reduce((sum, v) => sum + v, 0);

  // When nothing changed, keep it simple
  // Note: pre-existing violations may have severity 'warning' but delta=0
  if (totalDelta === 0 && improved === 0) {
    return '\n\n**Complexity:** No change from this PR.';
  }

  const metricBreakdown = buildMetricBreakdownForDisplay(deltaByMetric);
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
 * Count new/worsened vs pre-existing violations from deltas
 */
function countViolationsByNovelty(
  totalViolations: number,
  deltas: ComplexityDelta[] | null | undefined
): { newCount: number; preExistingCount: number; improvedCount: number } {
  if (!deltas || deltas.length === 0) {
    return { newCount: 0, preExistingCount: 0, improvedCount: 0 };
  }

  const newCount = deltas.filter(d =>
    d.severity === 'new' || d.severity === 'warning' || d.severity === 'error'
  ).filter(d => d.severity === 'new' || d.delta > 0).length;

  const improvedCount = deltas.filter(d => d.severity === 'improved').length;

  const preExistingCount = Math.max(0, totalViolations - newCount);

  return { newCount, preExistingCount, improvedCount };
}

/**
 * Build the header line distinguishing new vs pre-existing violations
 */
export function buildHeaderLine(
  totalViolations: number,
  deltas: ComplexityDelta[] | null | undefined
): string {
  const { newCount, preExistingCount, improvedCount } = countViolationsByNovelty(totalViolations, deltas);

  // No delta data available - fall back to old behavior
  if (!deltas || deltas.length === 0) {
    return `${totalViolations} issue${totalViolations === 1 ? '' : 's'} spotted in this PR.`;
  }

  const parts: string[] = [];

  if (newCount > 0) {
    parts.push(`${newCount} new issue${newCount === 1 ? '' : 's'} spotted in this PR.`);
  } else {
    parts.push('No new complexity introduced.');
  }

  if (improvedCount > 0) {
    parts.push(`${improvedCount} function${improvedCount === 1 ? '' : 's'} improved.`);
  }

  if (preExistingCount > 0) {
    parts.push(`${preExistingCount} pre-existing issue${preExistingCount === 1 ? '' : 's'} in touched files.`);
  }

  return parts.join(' ');
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
  uncoveredNote: string = ''
): string {
  const { summary } = report;
  const deltaDisplay = formatDeltaDisplay(deltas);
  const fallbackNote = formatFallbackNote(isFallback);
  const tokenStats = formatTokenStats(tokenUsage);

  const headerLine = buildHeaderLine(summary.totalViolations, deltas);

  return `<!-- lien-ai-review -->
## 👁️ Veille

${headerLine}${deltaDisplay}${fallbackNote}

---

${aiReview}

---${uncoveredNote}

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
 * Build metric breakdown table for violations
 */
function buildMetricTable(
  report: ComplexityReport | null,
  deltas: ComplexityDelta[] | null
): string {
  if (!report || report.summary.totalViolations === 0) return '';

  const byMetric = collect(Object.values(report.files))
    .flatMap(f => f.violations)
    .countBy('metricType')
    .all() as unknown as Record<string, number>;

  const deltaByMetric: Record<string, number> = deltas
    ? collect(deltas)
        .groupBy('metricType')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((group: any) => group.sum('delta'))
        .all() as unknown as Record<string, number>
    : {};

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

  if (rows.length === 0) return '';

  return `
| Metric | Violations | Change |
|--------|:----------:|:------:|
${rows.join('\n')}
`;
}

/**
 * Build dependency impact summary
 */
function buildImpactSummary(report: ComplexityReport | null): string {
  if (!report) return '';

  const filesWithDependents = Object.values(report.files)
    .filter(f => f.dependentCount && f.dependentCount > 0);

  if (filesWithDependents.length === 0) return '';

  const totalDependents = filesWithDependents.reduce((sum, f) => sum + (f.dependentCount || 0), 0);
  const highRiskFiles = filesWithDependents.filter(f =>
    ['high', 'critical'].includes(f.riskLevel)
  ).length;

  if (highRiskFiles === 0) return '';

  return `\n🔗 **Impact**: ${highRiskFiles} high-risk file(s) with ${totalDependents} total dependents`;
}

/**
 * Build the PR description stats badge
 * Human-friendly summary with metrics table
 */
export function buildDescriptionBadge(
  report: ComplexityReport | null,
  deltaSummary: DeltaSummary | null,
  deltas: ComplexityDelta[] | null
): string {
  const status = determineStatus(report, deltaSummary);
  const metricTable = buildMetricTable(report, deltas);
  const impactSummary = buildImpactSummary(report);

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

**IMPORTANT**: Before suggesting refactorings, analyze the code snippet above to identify the codebase's patterns (functions vs classes, naming conventions, module organization). Match your suggestions to those patterns.

Write a code review comment that includes:

1. **Problem** (1 sentence): What specific pattern makes this complex (e.g., "5 levels of nested conditionals", "switch with embedded if-chains", "many unique operators")

2. **Refactoring** (2-3 sentences): Concrete steps to reduce complexity. Be SPECIFIC:
   - Name the exact functions to extract (e.g., "Extract \`handleAdminDelete()\` and \`handleModeratorDelete()\`")
   - Suggest specific patterns (strategy, lookup table, early returns)
   - For Halstead metrics: suggest introducing named constants, reducing operator variety, or extracting complex expressions
   - If applicable, show a brief code sketch
   - **Match the existing codebase patterns** - if utilities are functions, suggest functions; if they're classes, suggest classes

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
 * Get the example that matches the most common metric type in the violations.
 * This ensures the example is relevant to what we're reviewing.
 */
function getExampleForPrimaryMetric(violations: ComplexityViolation[]): string {
  if (violations.length === 0) return DEFAULT_EXAMPLE;

  const counts = collect(violations)
    .countBy((v: ComplexityViolation) => v.metricType || 'cyclomatic')
    .all() as Record<string, number>;

  const maxType = Object.entries(counts)
    .reduce(
      (max, [type, count]) =>
        count > max.count ? { type, count } : max,
      { type: 'cyclomatic', count: 0 }
    ).type;

  return COMMENT_EXAMPLES[maxType] || DEFAULT_EXAMPLE;
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
  codeSnippets: Map<string, string>,
  report: ComplexityReport
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

      // Add dependency context for this violation's file
      const fileData = report.files[v.filepath];
      const dependencyContext = fileData ? buildDependencyContext(fileData) : '';

      // Add file-level context (language, type, other violations)
      const fileContext = fileData ? buildFileContext(v.filepath, fileData) : '';

      return `### ${i + 1}. ${v.filepath}::${v.symbolName}
- **Function**: \`${v.symbolName}\` (${v.symbolType})
- **Complexity**: ${valueDisplay} ${metricLabel} (threshold: ${thresholdDisplay})${halsteadContext}
- **Severity**: ${v.severity}${fileContext}${dependencyContext}${snippetSection}`;
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

**IMPORTANT**: Before suggesting refactorings, analyze the code snippets provided to identify the codebase's patterns:
- Are utilities implemented as functions or classes?
- How are similar refactorings done elsewhere in the codebase?
- What naming conventions are used?

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
   - **Match the existing codebase patterns** - if utilities are functions, suggest functions; if they're classes, suggest classes

3. **Acknowledges context** when relevant
   - If this is an orchestration function, complexity may be acceptable
   - If the logic is inherently complex (state machines, parsers), say so
   - Don't suggest over-engineering for marginal gains

Be direct and specific to THIS code. Avoid generic advice like "break into smaller functions."

**Example of a good comment:**
"${getExampleForPrimaryMetric(violations)}"

Write comments of similar quality and specificity for each violation below.

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
