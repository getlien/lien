/**
 * Changed enum analysis.
 *
 * Detects enums with added/removed variants and checks if consuming code
 * handles the changes correctly (e.g., exhaustive switch/match statements).
 */

import type { ReviewContext, ReviewFinding, BugCallerInfo } from '../../plugin-types.js';
import { MAX_CALLER_SNIPPET_CHARS } from './types.js';
import { truncateContent, formatCallerTable } from './formatting.js';
import { parseBugResponse } from './parsing.js';
import { findImporters } from './type-analysis.js';

/** Patterns that match enum definitions across languages. */
const ENUM_DEF_PATTERNS = [
  // TypeScript/JavaScript: export enum Name {
  /(?:export\s+)?enum\s+(\w+)\s*\{/,
  // Python: class Name(Enum):, class Name(IntEnum):, class Name(StrEnum):
  /class\s+(\w+)\s*\(\s*(?:Str|Int)?Enum\s*\)/,
  // Rust: pub enum Name {
  /(?:pub\s+)?enum\s+(\w+)\s*\{/,
  // PHP: enum Name, enum Name: string
  /enum\s+(\w+)(?:\s*:\s*\w+)?\s*\{/,
];

const MAX_TYPE_IMPORTERS = 5;

interface ChangedEnum {
  filepath: string;
  name: string;
  removedVariants: string[];
  addedVariants: string[];
}

/**
 * Detect enums with added or removed variants from the diff.
 * Tracks which enum block is active by watching for enum definition lines.
 */
export function detectChangedEnums(patches: Map<string, string>): ChangedEnum[] {
  const results: ChangedEnum[] = [];

  for (const [filepath, patch] of patches) {
    let currentEnum: string | null = null;
    const removedByEnum = new Map<string, string[]>();
    const addedByEnum = new Map<string, string[]>();

    for (const line of patch.split('\n')) {
      const content =
        line.startsWith('-') || line.startsWith('+') ? line.slice(1).trim() : line.trim();

      // Check if we're entering an enum block
      for (const pattern of ENUM_DEF_PATTERNS) {
        const match = content.match(pattern);
        if (match?.[1]) {
          currentEnum = match[1];
          if (!removedByEnum.has(currentEnum)) removedByEnum.set(currentEnum, []);
          if (!addedByEnum.has(currentEnum)) addedByEnum.set(currentEnum, []);
          break;
        }
      }

      // Check if we're exiting an enum block
      if (currentEnum && content === '}') {
        currentEnum = null;
        continue;
      }

      // Track variant changes within an enum block
      if (currentEnum && (line.startsWith('-') || line.startsWith('+'))) {
        // Extract variant name (first identifier-like word in the line)
        const variantMatch = line
          .slice(1)
          .trim()
          .match(/^(\w+)/);
        if (variantMatch && variantMatch[1] !== '}' && variantMatch[1] !== '{') {
          const variants = line.startsWith('-') ? removedByEnum : addedByEnum;
          variants.get(currentEnum)?.push(variantMatch[1]);
        }
      }
    }

    // Find enums with actual variant changes (not just reformatting)
    for (const [name, removed] of removedByEnum) {
      const added = addedByEnum.get(name) ?? [];
      // Only flag if there are net additions or removals (not just renames within a reformat)
      const netRemoved = removed.filter(v => !added.includes(v));
      const netAdded = added.filter(v => !removed.includes(v));
      if (netRemoved.length > 0 || netAdded.length > 0) {
        results.push({ filepath, name, removedVariants: netRemoved, addedVariants: netAdded });
      }
    }
  }

  return results;
}

/**
 * Analyze changed enums by finding importers and checking if variant
 * additions/removals break switch/match statements.
 */
export async function analyzeChangedEnums(context: ReviewContext): Promise<ReviewFinding[]> {
  if (!context.llm || !context.repoChunks || !context.pr?.patches) return [];

  const changedEnums = detectChangedEnums(context.pr.patches);
  if (changedEnums.length === 0) return [];

  context.logger.info(`Bug finder: ${changedEnums.length} changed enum(s) to analyze`);

  const findings = (
    await Promise.all(
      changedEnums
        .map(e => ({ ...e, importers: findImporters(e.name, e.filepath, context.repoChunks!) }))
        .filter(e => e.importers.length > 0)
        .map(async ({ filepath, name, removedVariants, addedVariants, importers }) => {
          const topImporters = importers.slice(0, MAX_TYPE_IMPORTERS);
          const importerSections = topImporters
            .map(c => {
              const content = truncateContent(c.content, MAX_CALLER_SNIPPET_CHARS);
              return `**${c.metadata.file}::${c.metadata.symbolName}** (line ${c.metadata.startLine})\n\`\`\`${c.metadata.language ?? ''}\n${content}\n\`\`\``;
            })
            .join('\n\n');

          const changes: string[] = [];
          if (removedVariants.length > 0)
            changes.push(`Removed variants: ${removedVariants.join(', ')}`);
          if (addedVariants.length > 0) changes.push(`Added variants: ${addedVariants.join(', ')}`);

          const prompt = `Check if this enum change breaks consuming code. Be terse — write like a linter, not a human.

## Changed Enum: ${name}

File: ${filepath}
${changes.join('\n')}

## Code that uses ${name}

${importerSections}

## Response Format

ONLY valid JSON. Report the FILE that breaks, not the enum definition.

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
- For removed variants: check for references to the removed variant name
- For added variants: check for non-exhaustive switch/match statements that miss the new variant
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

  return findings;
}
