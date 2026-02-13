/**
 * Prompt builder for logic review LLM validation
 */

import type { ComplexityReport } from '@liendev/core';
import type { LogicFinding } from './types.js';

/**
 * Category display names and descriptions for LLM context
 */
const CATEGORY_INFO: Record<string, { label: string; instruction: string }> = {
  breaking_change: {
    label: 'Breaking Change',
    instruction:
      'An exported symbol was removed or renamed. Verify this is intentional and note the downstream impact.',
  },
  unchecked_return: {
    label: 'Unchecked Return Value',
    instruction:
      'A function call return value is not captured. Determine if ignoring it could lead to silent failures or data loss.',
  },
  missing_tests: {
    label: 'Missing Test Coverage',
    instruction:
      'A high-risk function (many dependents, high complexity) has no associated test files. Assess whether this is a testing gap.',
  },
};

/**
 * Build a prompt section for a single finding
 */
function buildFindingSection(
  index: number,
  finding: LogicFinding,
  report: ComplexityReport,
): string {
  const info = CATEGORY_INFO[finding.category] || {
    label: finding.category,
    instruction: '',
  };
  const fileData = report.files[finding.filepath];

  const dependentInfo = fileData?.dependentCount
    ? `\n- **Dependents**: ${fileData.dependentCount} file(s)`
    : '';
  const riskInfo = fileData?.riskLevel ? `\n- **Risk level**: ${fileData.riskLevel}` : '';
  const testInfo = fileData?.testAssociations?.length
    ? `\n- **Test files**: ${fileData.testAssociations.join(', ')}`
    : '\n- **Tests**: None found';

  return `### ${index}. [${info.label}] ${finding.filepath}::${finding.symbolName} (line ${finding.line})
- **Category**: ${info.label}
- **Severity**: ${finding.severity}
- **Evidence**: ${finding.evidence}${dependentInfo}${riskInfo}${testInfo}

${info.instruction}`;
}

/**
 * Build the batched logic review prompt for LLM validation
 */
export function buildLogicReviewPrompt(
  findings: LogicFinding[],
  codeSnippets: Map<string, string>,
  report: ComplexityReport,
  diffHunks?: Map<string, string>,
): string {
  const findingSections = findings
    .map((finding, i) => {
      let section = buildFindingSection(i + 1, finding, report);

      const snippetKey = `${finding.filepath}::${finding.symbolName}`;
      const snippet = codeSnippets.get(snippetKey);
      if (snippet) {
        section += `\n\n**Code:**\n\`\`\`\n${snippet}\n\`\`\``;
      }

      const hunk = diffHunks?.get(snippetKey);
      if (hunk) {
        section += `\n\n**Diff:**\n\`\`\`diff\n${hunk}\n\`\`\``;
      }

      return section;
    })
    .join('\n\n');

  const jsonKeys = findings
    .map(
      f =>
        `  "${f.filepath}::${f.symbolName}": { "valid": true, "comment": "...", "category": "${f.category}" }`,
    )
    .join(',\n');

  return `You are a senior engineer validating potential code issues detected by static analysis.

## Findings to Validate

${findingSections}

## Instructions

For each finding, determine if it is a **real issue** that warrants a review comment.

- For **breaking changes**: confirm the export was actually removed/renamed and whether dependents will break.
- For **unchecked returns**: confirm the return value matters and ignoring it could cause bugs.
- For **missing tests**: confirm the function is high-risk enough to warrant a test recommendation.

Set \`valid: false\` if the finding is a false positive (e.g., the function is intentionally void, the export was replaced by an equivalent, the function is trivial).

Write concise, actionable comments (2-3 sentences max). Be specific about what the developer should do.

## Response Format

Respond with ONLY valid JSON. Each key is "filepath::symbolName".

\`\`\`json
{
${jsonKeys}
}
\`\`\``;
}
