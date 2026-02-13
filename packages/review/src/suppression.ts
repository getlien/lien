/**
 * Inline suppression for logic review findings.
 * Detects `// veille-ignore:` comments to suppress specific finding categories.
 */

import type { LogicFinding } from './types.js';

/**
 * Parsed suppression comment
 */
interface SuppressionComment {
  line: number;
  categories: string[];
}

/**
 * Parse veille-ignore comments from source code.
 * Supports:
 * - `// veille-ignore: breaking-change`
 * - `// veille-ignore: all`
 * - `// veille-ignore: breaking-change, unchecked-return`
 * - `# veille-ignore: missing-tests` (Python-style)
 */
export function parseSuppressionComments(code: string): SuppressionComment[] {
  const results: SuppressionComment[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/(?:\/\/|#)\s*veille-ignore:\s*(.+)/);
    if (match) {
      const categories = match[1].split(',').map(s => s.trim().toLowerCase());
      results.push({ line: i + 1, categories });
    }
  }

  return results;
}

/**
 * Map finding category (snake_case) to suppression category (kebab-case)
 */
function categoryToSuppressionKey(category: string): string {
  return category.replace(/_/g, '-');
}

/**
 * Check if a finding is suppressed by inline comments.
 * A finding is suppressed if there's a veille-ignore comment on the same line,
 * the line before the finding, or the line before the function start.
 */
export function isFindingSuppressed(finding: LogicFinding, codeSnippet: string): boolean {
  const suppressions = parseSuppressionComments(codeSnippet);
  if (suppressions.length === 0) return false;

  const findingKey = categoryToSuppressionKey(finding.category);

  for (const suppression of suppressions) {
    // Check if suppression is on the same line or one line before the finding
    const lineDiff = finding.line - suppression.line;
    if (lineDiff < 0 || lineDiff > 1) continue;

    // Check if this suppression covers the finding's category
    if (suppression.categories.includes('all') || suppression.categories.includes(findingKey)) {
      return true;
    }
  }

  return false;
}
