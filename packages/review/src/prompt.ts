/**
 * Prompt builder for AI code review
 */

import collect from 'collect.js';
import type { ComplexityReport, ComplexityViolation } from '@liendev/core';
import type { PRContext } from './types.js';
import type { ComplexityDelta, DeltaSummary } from './delta.js';
import { formatTime } from './format.js';

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
 * Get human-readable label for a metric type
 */
export function getMetricLabel(metricType: string): string {
  switch (metricType) {
    case 'cognitive':
      return 'mental load';
    case 'cyclomatic':
      return 'test paths';
    case 'halstead_effort':
      return 'time to understand';
    case 'halstead_bugs':
      return 'estimated bugs';
    default:
      return 'complexity';
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
    ? fileData.dependents
        .slice(0, 10)
        .map(f => `  - ${f}`)
        .join('\n')
    : '';

  const complexityNote = fileData.dependentComplexityMetrics
    ? `\n- **Dependent complexity**: Avg ${fileData.dependentComplexityMetrics.averageComplexity.toFixed(1)}, Max ${fileData.dependentComplexityMetrics.maxComplexity}`
    : '';

  const moreNote = hasDependentsList && fileData.dependents.length > 10 ? '\n  ... (and more)' : '';

  return `\n**Dependency Impact**: ${emoji} ${fileData.riskLevel.toUpperCase()} risk
- **Dependents**: ${fileData.dependentCount} file(s) import this
${dependentsList ? `\n**Key dependents:**\n${dependentsList}${moreNote}` : ''}${complexityNote}
- **Review focus**: Changes here affect ${fileData.dependentCount} other file(s). Extra scrutiny recommended.`;
}

/**
 * Language name lookup by internal language identifier
 */
const LANGUAGE_NAMES: Record<string, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  php: 'PHP',
  python: 'Python',
  go: 'Go',
  rust: 'Rust',
  java: 'Java',
  ruby: 'Ruby',
  swift: 'Swift',
  kotlin: 'Kotlin',
  csharp: 'C#',
  scala: 'Scala',
  cpp: 'C++',
  c: 'C',
};

/**
 * Language name lookup by file extension
 */
const EXTENSION_LANGUAGES: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript React',
  js: 'JavaScript',
  jsx: 'JavaScript React',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  php: 'PHP',
  py: 'Python',
  go: 'Go',
  rs: 'Rust',
  java: 'Java',
  rb: 'Ruby',
  swift: 'Swift',
  kt: 'Kotlin',
  cs: 'C#',
  scala: 'Scala',
  cpp: 'C++',
  cc: 'C++',
  cxx: 'C++',
  c: 'C',
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
 * Build a minimal prompt when there are no violations
 */
export function buildNoViolationsMessage(
  prContext: PRContext,
  deltas: ComplexityDelta[] | null = null,
): string {
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
 * Architectural context for enriched reviews.
 * Provided by fingerprint.ts and dependent-context.ts.
 */
export interface ArchitecturalContext {
  /** Pre-formatted codebase fingerprint block (markdown) */
  fingerprint: string;
  /** Dependent usage snippets keyed by "filepath::symbolName" */
  dependentSnippets: Map<string, string>;
}

/**
 * Token usage info for display
 */
export interface TokenUsageInfo {
  totalTokens: number;
  cost: number;
}

/**
 * Count new/worsened vs pre-existing violations from deltas
 */
function countViolationsByNovelty(
  totalViolations: number,
  deltas: ComplexityDelta[] | null | undefined,
): { newCount: number; preExistingCount: number; improvedCount: number } {
  if (!deltas || deltas.length === 0) {
    return { newCount: 0, preExistingCount: 0, improvedCount: 0 };
  }

  const newCount = deltas
    .filter(d => d.severity === 'new' || d.severity === 'warning' || d.severity === 'error')
    .filter(d => d.severity === 'new' || d.delta > 0).length;

  const improvedCount = deltas.filter(d => d.severity === 'improved').length;

  const preExistingCount = Math.max(0, totalViolations - newCount);

  return { newCount, preExistingCount, improvedCount };
}

/**
 * Build the header line distinguishing new vs pre-existing violations
 */
export function buildHeaderLine(
  totalViolations: number,
  deltas: ComplexityDelta[] | null | undefined,
): string {
  const { newCount, preExistingCount, improvedCount } = countViolationsByNovelty(
    totalViolations,
    deltas,
  );

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
    parts.push(
      `${preExistingCount} pre-existing issue${preExistingCount === 1 ? '' : 's'} in touched files.`,
    );
  }

  return parts.join(' ');
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
  deltaSummary: DeltaSummary | null,
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
    return {
      emoji: '✅',
      message: `**Improved!** This PR reduces complexity by ${Math.abs(delta)}.`,
    };
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
    return {
      emoji: '➡️',
      message: '**Stable** - Complexity increased slightly but within limits.',
    };
  }

  return { emoji: '✅', message: '**Good** - No complexity issues found.' };
}

/**
 * Get emoji for metric type
 */
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

/**
 * Build metric breakdown table for violations
 */
function buildMetricTable(
  report: ComplexityReport | null,
  deltas: ComplexityDelta[] | null,
): string {
  if (!report || report.summary.totalViolations === 0) return '';

  const byMetric = collect(Object.values(report.files))
    .flatMap(f => f.violations)
    .countBy('metricType')
    .all() as unknown as Record<string, number>;

  const deltaByMetric: Record<string, number> = deltas
    ? (collect(deltas)
        .groupBy('metricType')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((group: any) => group.sum('delta'))
        .all() as unknown as Record<string, number>)
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

  const filesWithDependents = Object.values(report.files).filter(
    f => f.dependentCount && f.dependentCount > 0,
  );

  if (filesWithDependents.length === 0) return '';

  const totalDependents = filesWithDependents.reduce((sum, f) => sum + (f.dependentCount || 0), 0);
  const highRiskFiles = filesWithDependents.filter(f =>
    ['high', 'critical'].includes(f.riskLevel),
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
  deltas: ComplexityDelta[] | null,
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
  codeSnippet: string | null,
): string {
  const snippetSection = codeSnippet ? `\n\n**Code:**\n\`\`\`\n${codeSnippet}\n\`\`\`` : '';

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
export function buildLineSummaryComment(report: ComplexityReport, _prContext: PRContext): string {
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

  const maxType = Object.entries(counts).reduce(
    (max, [type, count]) => (count > max.count ? { type, count } : max),
    { type: 'cyclomatic', count: 0 },
  ).type;

  return COMMENT_EXAMPLES[maxType] || DEFAULT_EXAMPLE;
}

/**
 * Format a single metric line for a violation
 */
function formatMetricLine(v: ComplexityViolation): string {
  const metricType = v.metricType || 'cyclomatic';
  const metricLabel = getMetricLabel(metricType);
  const valueDisplay = formatComplexityValue(metricType, v.complexity);
  const thresholdDisplay = formatThresholdValue(metricType, v.threshold);
  const halsteadContext = formatHalsteadContext(v);
  return `- **${metricLabel}**: ${valueDisplay} (threshold: ${thresholdDisplay}) [${v.severity}]${halsteadContext}`;
}

/**
 * Build a prompt section for a single function's violations
 */
function buildViolationSection(
  index: number,
  key: string,
  groupViolations: ComplexityViolation[],
  codeSnippets: Map<string, string>,
  report: ComplexityReport,
  diffHunks?: Map<string, string>,
  dependentSnippets?: Map<string, string>,
): string {
  const first = groupViolations[0];
  const snippet = codeSnippets.get(key);
  const snippetSection = snippet ? `\nCode:\n\`\`\`\n${snippet}\n\`\`\`` : '';

  const metricLines = groupViolations.map(formatMetricLine).join('\n');

  const fileData = report.files[first.filepath];
  const dependencyContext = fileData ? buildDependencyContext(fileData) : '';
  const fileContext = fileData ? buildFileContext(first.filepath, fileData) : '';

  const testContext =
    fileData && fileData.testAssociations && fileData.testAssociations.length > 0
      ? `\n- **Test files**: ${fileData.testAssociations.join(', ')}`
      : fileData
        ? '\n- **Tests**: None found — consider adding tests'
        : '';

  const hunk = diffHunks?.get(key);
  const diffSection = hunk ? `\n**Changes in this PR (diff):**\n\`\`\`diff\n${hunk}\n\`\`\`` : '';

  const dependentSection = dependentSnippets?.get(key) ? `\n\n${dependentSnippets.get(key)}` : '';

  return `### ${index}. ${key}
- **Function**: \`${first.symbolName}\` (${first.symbolType})
${metricLines}${fileContext}${testContext}${dependencyContext}${snippetSection}${diffSection}${dependentSection}`;
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
  report: ComplexityReport,
  diffHunks?: Map<string, string>,
  archContext?: ArchitecturalContext,
): string {
  // Group violations by filepath::symbolName so one function gets one comment
  const grouped = new Map<string, ComplexityViolation[]>();
  for (const v of violations) {
    const key = `${v.filepath}::${v.symbolName}`;
    const existing = grouped.get(key) || [];
    existing.push(v);
    grouped.set(key, existing);
  }

  let sectionIndex = 0;
  const violationsText = Array.from(grouped.entries())
    .map(([key, groupViolations]) => {
      sectionIndex++;
      return buildViolationSection(
        sectionIndex,
        key,
        groupViolations,
        codeSnippets,
        report,
        diffHunks,
        archContext?.dependentSnippets,
      );
    })
    .join('\n\n');

  // Build JSON keys for the response format (one per function, not per metric)
  const jsonKeys = Array.from(grouped.keys())
    .map(key => `  "${key}": "your comment here"`)
    .join(',\n');

  // Conditional sections when architectural context is provided
  const systemRole = archContext
    ? 'You are a senior engineer reviewing code for complexity and architectural coherence. Generate thoughtful, context-aware review comments.'
    : 'You are a senior engineer reviewing code for complexity. Generate thoughtful, context-aware review comments.';

  const fingerprintSection = archContext?.fingerprint ? `\n${archContext.fingerprint}\n` : '';

  const coherenceInstructions = archContext
    ? `
**Architectural observations — look for these across the changed files:**
- **DRY violations**: duplicated logic, repeated patterns, or copy-pasted code across functions/files that should be shared
- **Single Responsibility**: functions or files doing too many unrelated things (mixing I/O with business logic, orchestration with computation)
- **Coupling issues**: functions that know too much about each other's internals, or tight coupling between modules that should be independent
- **Missing abstractions**: repeated conditional patterns that should be a lookup table, strategy, or shared helper
- **KISS violations**: over-engineered solutions where a simpler approach exists — unnecessary abstractions, premature generalization, wrapper functions that add no value
- **Cross-file coherence**: pattern conflicts (class-based service in a functional codebase), naming convention violations
- Do NOT flag minor style variations, metric values already covered by inline comments, or intentional deviations (test utilities, generated code)

`
    : '';

  const prSummaryInstructions = archContext
    ? `
**PR-level summary**: After reviewing all functions, produce a brief PR-level summary:
- 1-2 sentences: overall assessment and any cross-cutting concerns
- If the PR touches 3+ files: whether changes are cohesive or could be split
- If nothing notable at PR level, set \`pr_summary\` to null

`
    : '';

  const archExamples = archContext
    ? `
**Examples of GOOD architectural observations:**
- "Both \`computeNaming()\` and \`computeAsyncPattern()\` iterate all chunks filtering by symbolType — extract a shared \`filterFunctionChunks(chunks)\` helper to eliminate the duplication."
- "\`hasExportChanges()\` builds a Map, iterates baseline, then iterates chunks again. This mixes 3 responsibilities (data building, comparison, detection) — split into \`buildExportMap()\`, \`hasRemovedSymbols()\`, \`hasNewExports()\`."
- "The return type of \`computeFingerprint()\` changed but its 3 dependents still expect the old shape — this will cause runtime errors."

**Examples of BAD architectural observations (do NOT produce):**
- "Consider using the repository pattern for data access." — Generic advice not grounded in specific code.
- "Halstead Volume of 3,056 indicates many unique operations." — Just restating metric values already shown in inline comments.
- "This function has HIGH risk dependency impact." — Restating metadata without actionable insight.

`
    : '';

  const responseFormatSection = archContext
    ? `## Response Format

Respond with ONLY valid JSON. Structure:

\`\`\`json
{
  "comments": {
${jsonKeys}
  },
  "architectural_notes": [
    {
      "scope": "filepath::symbolName or PR-level",
      "observation": "1 sentence describing the issue",
      "evidence": "specific file/line/metric backing it",
      "suggestion": "what to do about it"
    }
  ],
  "pr_summary": "1-2 sentences or null"
}
\`\`\`

Rules for \`comments\`: Use \\n for newlines within comments.

Rules for \`architectural_notes\`:
- ONLY include notes backed by specific evidence (file names, function names, code patterns)
- Focus on design principles (DRY, SRP, coupling) — do NOT restate complexity metrics already in inline comments
- Maximum 3 notes per review — quality over quantity
- If no architectural issues found, return an empty array

Rules for \`pr_summary\`:
- 1-2 sentences maximum
- Focus on cross-cutting concerns, not per-function details
- If nothing notable at PR level, set to null`
    : `## Response Format

Respond with ONLY valid JSON. Each key is "filepath::symbolName", value is the comment text.
Use \\n for newlines within comments.

\`\`\`json
{
${jsonKeys}
}
\`\`\``;

  return `${systemRole}
${fingerprintSection}
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

**Anti-patterns — do NOT suggest these:**
- **Extracting a helper that needs 5+ parameters.** If you have to pass most of the parent's state to a new function/method, you're moving complexity, not reducing it. Prefer restructuring the data flow (e.g., grouping parameters into a single object, using built-in collection methods) over mechanical extraction.
- **Wrapping a single-use block in a new function/method with no independent testability benefit.** Three clear lines inline are better than one opaque call plus a new definition elsewhere.
- **Suggesting a design pattern (strategy, visitor, builder, etc.) for a problem that can be solved with a conditional, a lookup table, or a simple loop.** Patterns earn their cost only when there's real variation to model.
- **Replacing straightforward imperative code with an abstraction that's equally long.** If the "after" isn't shorter, clearer, or more testable than the "before", don't suggest it.
- **Ignoring the threshold margin.** If the metric is barely over the threshold (within ~10%), say so and suggest a light touch (e.g., extracting one expression, adding an early return) rather than a full rewrite.

**Refactoring correctness:**
- When suggesting to split or extract a function, ensure ALL branches of the original code are preserved in the refactored version. Do not drop else-branches, error paths, or edge case handling.
- When your code suggestion introduces new types, interfaces, or imported symbols, include the necessary import statements.
${coherenceInstructions}${prSummaryInstructions}**IMPORTANT**: When a diff is provided, focus your review on the CHANGED lines shown in the diff. Pre-existing complexity is context, not the primary target. If the complexity was introduced or worsened in this PR, say so. If it's pre-existing, note that and suggest improvements the author could make while they're already in the file.

Be direct and specific to THIS code. Avoid generic advice like "break into smaller functions."

**Example of a good comment:**
"${getExampleForPrimaryMetric(violations)}"
${archExamples}Write comments of similar quality and specificity for each violation below.

IMPORTANT: Do NOT include headers like "Complexity: X" or emojis - we add those.

**GitHub Suggestions**: You MUST use \`\`\`suggestion blocks (not \`\`\`typescript) when proposing a concrete code replacement. The suggestion block replaces the lines the comment is attached to.

Example in the JSON response:
"src/utils.ts::processItems": "The nested loop increases mental load. Use early return to flatten.\\n\\n\`\`\`suggestion\\nfunction processItems(items: Item[]) {\\n  if (items.length === 0) return [];\\n  return items.filter(isValid).map(transform);\\n}\\n\`\`\`"

Rules:
- Use \`\`\`suggestion for ANY concrete code fix (not \`\`\`typescript or \`\`\`ts)
- The suggestion must be complete, runnable code that replaces the lines the comment is attached to
- Only use \`\`\`suggestion when you have a clear, complete replacement
- For structural advice without a concrete replacement, use plain text (no code block)

${responseFormatSection}`;
}
