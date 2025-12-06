/**
 * Prompt builder for AI code review
 */

import type { ComplexityReport, ComplexityViolation, PRContext, ComplexityDelta, DeltaSummary } from './types.js';
import { formatDelta } from './delta.js';

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

  // Build delta lookup map
  const deltaMap = new Map<string, ComplexityDelta>();
  if (deltas) {
    for (const d of deltas) {
      deltaMap.set(`${d.filepath}::${d.symbolName}`, d);
    }
  }

  // Build violations summary
  const violationsByFile = Object.entries(files)
    .filter(([_, data]) => data.violations.length > 0)
    .map(([filepath, data]) => ({
      filepath,
      violations: data.violations,
      riskLevel: data.riskLevel,
    }));

  const violationsSummary = violationsByFile
    .map(({ filepath, violations, riskLevel }) => {
      const violationList = violations
        .map((v) => {
          const delta = deltaMap.get(`${v.filepath}::${v.symbolName}`);
          const deltaStr = delta ? ` (${formatDelta(delta.delta)})` : '';
          return `  - ${v.symbolName} (${v.symbolType}): complexity ${v.complexity}${deltaStr} (threshold: ${v.threshold}) [${v.severity}]`;
        })
        .join('\n');
      return `**${filepath}** (risk: ${riskLevel})\n${violationList}`;
    })
    .join('\n\n');

  // Build code snippets section
  const snippetsSection = Array.from(codeSnippets.entries())
    .map(([key, code]) => {
      const [filepath, symbolName] = key.split('::');
      return `### ${filepath} - ${symbolName}\n\`\`\`\n${code}\n\`\`\``;
    })
    .join('\n\n');

  // Add delta context if available
  let deltaContext = '';
  if (deltas && deltas.length > 0) {
    // Use severity-based filtering for accuracy
    const improved = deltas.filter(d => d.severity === 'improved');
    const degraded = deltas.filter(d => (d.severity === 'error' || d.severity === 'warning') && d.delta > 0);
    const newFuncs = deltas.filter(d => d.severity === 'new');
    const deleted = deltas.filter(d => d.severity === 'deleted');
    
    // Helper to format complexity display (handles null for new/deleted)
    const formatComplexityChange = (d: ComplexityDelta): string => {
      const from = d.baseComplexity ?? 'new';
      const to = d.headComplexity ?? 'removed';
      return `  - ${d.symbolName}: ${from} → ${to} (${formatDelta(d.delta)})`;
    };
    
    deltaContext = `
## Complexity Changes (vs base branch)
- **Degraded**: ${degraded.length} function(s) got more complex
- **Improved**: ${improved.length} function(s) got simpler
- **New**: ${newFuncs.length} new complex function(s)
- **Removed**: ${deleted.length} complex function(s) deleted
${degraded.length > 0 ? `\nFunctions that got worse:\n${degraded.map(formatComplexityChange).join('\n')}` : ''}
${improved.length > 0 ? `\nFunctions that improved:\n${improved.map(formatComplexityChange).join('\n')}` : ''}
${newFuncs.length > 0 ? `\nNew complex functions:\n${newFuncs.map(d => `  - ${d.symbolName}: complexity ${d.headComplexity}`).join('\n')}` : ''}
`;
  }

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

For each violation:
1. **Explain** why this complexity is problematic in this specific context
2. **Suggest** concrete refactoring steps (not generic advice like "break into smaller functions")
3. **Prioritize** which violations are most important to address - focus on functions that got WORSE (higher delta)
4. If the complexity seems justified for the use case, say so
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
 * Format delta summary for display
 */
function formatDeltaDisplay(deltaSummary: DeltaSummary | null | undefined): string {
  if (!deltaSummary) return '';
  
  const sign = deltaSummary.totalDelta >= 0 ? '+' : '';
  const trend = deltaSummary.totalDelta > 0 ? '⬆️' : deltaSummary.totalDelta < 0 ? '⬇️' : '➡️';
  let display = `\n\n**Complexity Change:** ${sign}${deltaSummary.totalDelta} ${trend}`;
  if (deltaSummary.improved > 0) display += ` | ${deltaSummary.improved} improved`;
  if (deltaSummary.degraded > 0) display += ` | ${deltaSummary.degraded} degraded`;
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
  deltaSummary?: DeltaSummary | null
): string {
  const { summary } = report;
  const deltaDisplay = formatDeltaDisplay(deltaSummary);
  const fallbackNote = formatFallbackNote(isFallback);
  const tokenStats = formatTokenStats(tokenUsage);

  return `<!-- lien-ai-review -->
## 👁️ Veille

${summary.totalViolations} issue${summary.totalViolations === 1 ? '' : 's'} spotted in this PR.${deltaDisplay}${fallbackNote}

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
 * Determine human-friendly status message based on violations and delta
 */
function determineStatus(
  report: ComplexityReport | null,
  deltaSummary: DeltaSummary | null
): { emoji: string; message: string } {
  const violations = report?.summary.totalViolations ?? 0;
  const errors = report?.summary.bySeverity.error ?? 0;
  const delta = deltaSummary?.totalDelta ?? 0;

  // Violations take priority - these need attention
  if (errors > 0) {
    return {
      emoji: '🔴',
      message: `**Review required** - ${errors} function${errors === 1 ? ' is' : 's are'} too complex and should be refactored.`,
    };
  }

  if (violations > 0) {
    return {
      emoji: '⚠️',
      message: `**Needs attention** - ${violations} function${violations === 1 ? ' is' : 's are'} more complex than recommended.`,
    };
  }

  // No violations - check delta for status
  if (delta < 0) {
    return { emoji: '✅', message: '**Improved** - This PR makes the code easier to maintain.' };
  }

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
 * Build the PR description stats badge
 * Human-friendly summary with technical details collapsed
 */
export function buildDescriptionBadge(
  report: ComplexityReport | null,
  deltaSummary: DeltaSummary | null
): string {
  const violations = report ? String(report.summary.totalViolations) : '0';
  const maxComplexity = report ? String(report.summary.maxComplexity) : '—';
  const deltaDisplay = formatBadgeDelta(deltaSummary);
  const status = determineStatus(report, deltaSummary);

  return `### 👁️ Veille

${status.emoji} ${status.message}

<details>
<summary>📊 Details</summary>

| Violations | Max Complexity | Change |
|:----------:|:--------------:|:------:|
| ${violations} | ${maxComplexity} | ${deltaDisplay} |

</details>`;
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

  return `You are reviewing code for complexity. Generate an actionable review comment.

**Function**: \`${violation.symbolName}\` (${violation.symbolType})
**Complexity**: ${violation.complexity} (threshold: ${violation.threshold})
${snippetSection}

Write a code review comment that includes:

1. **Problem** (1 sentence): What specific pattern makes this complex (e.g., "5 levels of nested conditionals", "switch with embedded if-chains")

2. **Refactoring** (2-3 sentences): Concrete steps to reduce complexity. Be SPECIFIC:
   - Name the exact functions to extract (e.g., "Extract \`handleAdminDelete()\` and \`handleModeratorDelete()\`")
   - Suggest specific patterns (strategy, lookup table, early returns)
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

      return `### ${i + 1}. ${v.filepath}::${v.symbolName}
- **Function**: \`${v.symbolName}\` (${v.symbolType})
- **Complexity**: ${v.complexity} (threshold: ${v.threshold})
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
   - Be specific: "5 levels of nesting" not "deeply nested"

2. **Suggests a concrete fix** with a short code example (3-5 lines)
   - Consider: early returns, guard clauses, lookup tables, extracting helpers, strategy pattern
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

