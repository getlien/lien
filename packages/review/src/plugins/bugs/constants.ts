/**
 * Changed constant/variable analysis.
 *
 * Detects constants whose values changed in the diff and checks if
 * consuming code's assumptions are broken by the change.
 */

import type { ReviewContext, ReviewFinding, BugCallerInfo } from '../../plugin-types.js';
import { MAX_CALLER_SNIPPET_CHARS } from './types.js';
import { truncateContent, formatCallerTable } from './formatting.js';
import { parseBugResponse } from './parsing.js';
import { findImporters } from './type-analysis.js';

/** Patterns that match constant/variable definitions across languages. */
const CONST_DEF_PATTERNS = [
  // TypeScript/JavaScript: export const NAME =, const NAME =, let NAME =
  /(?:export\s+)?(?:const|let|var)\s+([A-Z][A-Z0-9_]+)\s*[:=]/,
  // Python: NAME = value (top-level UPPER_CASE assignments)
  /^([A-Z][A-Z0-9_]+)\s*[:=]/,
  // Rust: pub const NAME:, pub static NAME:, const NAME:
  /(?:pub\s+)?(?:const|static)\s+([A-Z][A-Z0-9_]+)\s*:/,
  // PHP: const NAME =
  /const\s+([A-Z][A-Z0-9_]+)\s*=/,
];

const MAX_TYPE_IMPORTERS = 5;

interface ChangedConstant {
  filepath: string;
  name: string;
  oldValue: string;
  newValue: string;
}

/**
 * Detect constants whose values changed in the diff.
 * Only catches constants that appear in both removed and added lines
 * with different values (i.e., value modifications, not additions/deletions).
 */
export function detectChangedConstants(patches: Map<string, string>): ChangedConstant[] {
  const results: ChangedConstant[] = [];

  for (const [filepath, patch] of patches) {
    const removed = new Map<string, string>();
    const added = new Map<string, string>();

    for (const line of patch.split('\n')) {
      if (!line.startsWith('-') && !line.startsWith('+')) continue;
      if (line.startsWith('---') || line.startsWith('+++')) continue;

      const content = line.slice(1).trim();
      for (const pattern of CONST_DEF_PATTERNS) {
        const match = content.match(pattern);
        if (match?.[1]) {
          if (line.startsWith('-')) removed.set(match[1], content);
          else added.set(match[1], content);
        }
      }
    }

    // Constants that changed value (present in both removed and added with different content)
    for (const [name, oldLine] of removed) {
      const newLine = added.get(name);
      if (newLine && newLine !== oldLine) {
        results.push({ filepath, name, oldValue: oldLine, newValue: newLine });
      }
    }
  }

  return results;
}

/**
 * Analyze changed constants by finding importers and checking if the
 * value change breaks assumptions in consuming code.
 */
export async function analyzeChangedConstants(context: ReviewContext): Promise<ReviewFinding[]> {
  if (!context.llm || !context.repoChunks || !context.pr?.patches) return [];

  const changedConstants = detectChangedConstants(context.pr.patches);
  if (changedConstants.length === 0) return [];

  context.logger.info(`Bug finder: ${changedConstants.length} changed constant(s) to analyze`);

  const findings = (
    await Promise.all(
      changedConstants
        .map(c => ({ ...c, importers: findImporters(c.name, c.filepath, context.repoChunks!) }))
        .filter(c => c.importers.length > 0)
        .map(async ({ filepath, name, oldValue, newValue, importers }) => {
          const topImporters = importers.slice(0, MAX_TYPE_IMPORTERS);
          const importerSections = topImporters
            .map(c => {
              const content = truncateContent(c.content, MAX_CALLER_SNIPPET_CHARS);
              return `**${c.metadata.file}::${c.metadata.symbolName}** (line ${c.metadata.startLine})\n\`\`\`${c.metadata.language ?? ''}\n${content}\n\`\`\``;
            })
            .join('\n\n');

          const prompt = `Check if this constant value change breaks assumptions in consuming code. Be terse — write like a linter, not a human.

## Changed Constant

File: ${filepath}
Before: \`${oldValue}\`
After:  \`${newValue}\`

## Code that uses ${name}

${importerSections}

## Response Format

ONLY valid JSON. Report the FILE that breaks, not the constant definition.

\`\`\`json
{
  "bugs": [
    {
      "changedFunction": "${name}",
      "callerFilepath": "path/to/consumer.ts",
      "callerLine": 42,
      "callerSymbol": "functionThatBreaks",
      "severity": "error or warning",
      "category": "broken_assumption",
      "description": "Short statement (max 15 words)",
      "suggestion": "Short fix (max 15 words)"
    }
  ]
}
\`\`\`

Rules:
- ONLY report bugs you are confident about
- Look for: hardcoded assumptions about the value, boundary conditions, off-by-one errors from value changes
- If no bugs, return \`{ "bugs": [] }\``;

          const response = await context.llm!.complete(prompt, { temperature: 0 });
          const bugs = parseBugResponse(response.content, context.logger);

          return bugs.map(bug => {
            const callerInfos: BugCallerInfo[] = [
              {
                filepath: bug.callerFilepath,
                line: bug.callerLine,
                symbol: bug.callerSymbol,
                category: bug.category,
                description: bug.description,
                suggestion: bug.suggestion,
              },
            ];

            return {
              pluginId: 'bugs',
              filepath,
              line: 1,
              symbolName: name,
              severity: bug.severity,
              category: 'bug',
              message: formatCallerTable(callerInfos),
              metadata: {
                pluginType: 'bugs',
                changedFunction: `${filepath}::${name}`,
                callers: callerInfos,
              },
            } satisfies ReviewFinding;
          });
        }),
    )
  ).flat();

  if (findings.length > 0) {
    context.logger.info(`Bug finder: ${findings.length} constant value violation(s) found`);
  }

  return findings;
}
