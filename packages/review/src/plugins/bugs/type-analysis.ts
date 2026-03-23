/**
 * Changed type/interface/class analysis.
 *
 * Finds importers of changed types and checks if they satisfy the new contract.
 */

import type { CodeChunk } from '@liendev/parser';
import type { ReviewContext, ReviewFinding, BugCallerInfo } from '../../plugin-types.js';
import type { ChangedFunction } from './types.js';
import { MAX_CALLER_SNIPPET_CHARS } from './types.js';
import { truncateContent, formatCallerTable } from './formatting.js';
import { parseBugResponse } from './parsing.js';

const TYPE_SYMBOL_TYPES = new Set(['class', 'interface']);
const MAX_TYPE_IMPORTERS = 5;
const MAX_IMPORTER_SNIPPET_CHARS = MAX_CALLER_SNIPPET_CHARS;

/**
 * Collect changed type/interface/class definitions from chunks.
 */
export function collectChangedTypes(
  chunks: CodeChunk[],
  diffLines?: Map<string, Set<number>>,
): ChangedFunction[] {
  return chunks
    .filter(c => c.metadata.symbolType && TYPE_SYMBOL_TYPES.has(c.metadata.symbolType))
    .filter(c => c.metadata.symbolName)
    .filter(c => {
      if (!diffLines) return true;
      const lines = diffLines.get(c.metadata.file);
      if (!lines) return true;
      for (let line = c.metadata.startLine; line <= c.metadata.endLine; line++) {
        if (lines.has(line)) return true;
      }
      return false;
    })
    .map(c => ({
      filepath: c.metadata.file,
      symbolName: c.metadata.symbolName!,
      chunk: c,
    }));
}

/**
 * Find repo chunks that import a given symbol name from the source file.
 * Checks that the import path plausibly resolves to the source file
 * (contains the source filename without extension, or is a relative path
 * from the same directory tree).
 */
export function findImporters(
  symbolName: string,
  sourceFile: string,
  repoChunks: CodeChunk[],
): CodeChunk[] {
  const seen = new Set<string>();
  // Extract the basename without extension for path matching
  const sourceBasename = sourceFile
    .split('/')
    .pop()!
    .replace(/\.[^.]+$/, '');

  return repoChunks.filter(c => {
    if (!c.metadata.importedSymbols || !c.metadata.symbolName) return false;
    if (c.metadata.file === sourceFile) return false;
    const key = `${c.metadata.file}::${c.metadata.symbolName}`;
    if (seen.has(key)) return false;
    for (const [importPath, symbols] of Object.entries(c.metadata.importedSymbols)) {
      if (!symbols.includes(symbolName)) continue;
      // Check import path plausibly resolves to source file:
      // - relative path containing the source filename (e.g., './types' for 'types.ts')
      // - or same directory structure
      if (importPath.includes(sourceBasename) || importPath.startsWith('.')) {
        seen.add(key);
        return true;
      }
    }
    return false;
  });
}

/**
 * Analyze changed types/interfaces by finding importers and checking if they
 * satisfy the new contract.
 */
export async function analyzeChangedTypes(
  chunks: CodeChunk[],
  context: ReviewContext,
): Promise<ReviewFinding[]> {
  const changedTypes = collectChangedTypes(chunks, context.pr?.diffLines);
  if (changedTypes.length === 0 || !context.llm || !context.repoChunks) return [];

  context.logger.info(`Bug finder: ${changedTypes.length} changed type(s) to analyze`);
  const findings: ReviewFinding[] = [];

  for (const type of changedTypes) {
    const importers = findImporters(type.symbolName, type.filepath, context.repoChunks);
    if (importers.length === 0) continue;

    const topImporters = importers.slice(0, MAX_TYPE_IMPORTERS);
    const importerSections = topImporters
      .map(c => {
        const content = truncateContent(c.content, MAX_IMPORTER_SNIPPET_CHARS);
        return `**${c.metadata.file}::${c.metadata.symbolName}** (line ${c.metadata.startLine})\n\`\`\`${c.metadata.language ?? ''}\n${content}\n\`\`\``;
      })
      .join('\n\n');

    const prompt = `Find bugs in code that uses a changed type/interface. Be terse — write like a linter, not a human.

## Changed Type

### ${type.filepath}::${type.symbolName}

\`\`\`${type.chunk.metadata.language ?? ''}
${type.chunk.content}
\`\`\`

## Files that import ${type.symbolName}

${importerSections}

## Instructions

Check if the importing code correctly uses **${type.symbolName}** specifically. Look for:
- Object literals or constructors missing required fields of ${type.symbolName}
- Spread operations that don't include new required properties of ${type.symbolName}
- Type assertions that bypass the ${type.symbolName} contract
- Factory functions that return incomplete ${type.symbolName} objects

IMPORTANT: ONLY check usage of ${type.symbolName}. The file may import other types — ignore them entirely.

## Response Format

ONLY valid JSON. Report the FILE that breaks, not the type definition.

\`\`\`json
{
  "bugs": [
    {
      "changedFunction": "${type.symbolName}",
      "callerFilepath": "path/to/importer.ts",
      "callerLine": 42,
      "callerSymbol": "functionThatBreaks",
      "severity": "error or warning",
      "category": "type_mismatch",
      "description": "Short statement (max 15 words)",
      "suggestion": "Short fix (max 15 words)"
    }
  ]
}
\`\`\`

Rules:
- ONLY report bugs related to ${type.symbolName} — not other types from the same file
- ONLY report bugs you are confident about
- If no bugs, return \`{ "bugs": [] }\``;

    const response = await context.llm.complete(prompt, { temperature: 0 });
    const bugs = parseBugResponse(response.content, context.logger);

    // Filter out bugs that reference a different type than the one being analyzed.
    // The LLM sometimes confuses types when the importer code uses multiple types
    // from the same file (e.g., ReviewCommentResult vs ReviewRunResult).
    const relevantBugs = bugs.filter(
      b => !b.changedFunction || b.changedFunction === type.symbolName,
    );

    for (const bug of relevantBugs) {
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

      findings.push({
        pluginId: 'bugs',
        filepath: type.filepath,
        line: type.chunk.metadata.startLine,
        symbolName: type.symbolName,
        severity: bug.severity,
        category: 'bug',
        message: formatCallerTable(callerInfos),
        metadata: {
          pluginType: 'bugs',
          changedFunction: `${type.filepath}::${type.symbolName}`,
          callers: callerInfos,
        },
      });
    }
  }

  if (findings.length > 0) {
    context.logger.info(`Bug finder: ${findings.length} type contract violation(s) found`);
  }

  return findings;
}
