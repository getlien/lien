/**
 * Deleted function detection (deterministic -- no LLM needed).
 *
 * Parses diff patches to find functions that were deleted, then finds
 * remaining callers in the repo -- a deleted function with callers is always a bug.
 */

import type { CodeChunk } from '@liendev/parser';
import type { DependencyGraph } from '../../dependency-graph.js';
import type { ReviewFinding, BugFindingMetadata, BugCallerInfo } from '../../plugin-types.js';
import type { Logger } from '../../logger.js';
import { MAX_CALLERS_PER_FUNCTION } from './types.js';
import { formatCallerTable } from './formatting.js';
import { isSameLanguageFamily } from './filters.js';

/** Patterns that match function definitions across languages. */
const FUNCTION_DEF_PATTERNS = [
  // TypeScript/JavaScript: export function name(, export async function name(, function name(
  /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/,
  // Python: def name(, async def name(
  /(?:async\s+)?def\s+(\w+)\s*\(/,
  // Rust: pub fn name(, fn name(
  /(?:pub\s+)?fn\s+(\w+)\s*[(<]/,
  // PHP: public function name(, function name(
  /(?:public|protected|private|static|\s)+function\s+(\w+)\s*\(/,
];

/**
 * Parse diff patches to find function names that were deleted (removed but not re-added).
 */
export function detectDeletedFunctions(
  patches: Map<string, string>,
  headChunks: CodeChunk[],
): { filepath: string; symbolName: string }[] {
  const deleted: { filepath: string; symbolName: string }[] = [];

  // Build set of function names that exist in HEAD
  const headFunctions = new Set<string>();
  for (const chunk of headChunks) {
    if (chunk.metadata.symbolName) {
      headFunctions.add(`${chunk.metadata.file}::${chunk.metadata.symbolName}`);
    }
  }

  for (const [filepath, patch] of patches) {
    const removedFunctions = new Set<string>();
    const addedFunctions = new Set<string>();

    for (const line of patch.split('\n')) {
      if (!line.startsWith('-') && !line.startsWith('+')) continue;
      if (line.startsWith('---') || line.startsWith('+++')) continue;

      const content = line.slice(1); // Remove the +/- prefix
      for (const pattern of FUNCTION_DEF_PATTERNS) {
        const match = content.match(pattern);
        if (match?.[1]) {
          if (line.startsWith('-')) removedFunctions.add(match[1]);
          else addedFunctions.add(match[1]);
        }
      }
    }

    // Functions removed but not re-added (and not in HEAD chunks) = truly deleted
    for (const name of removedFunctions) {
      if (!addedFunctions.has(name) && !headFunctions.has(`${filepath}::${name}`)) {
        deleted.push({ filepath, symbolName: name });
      }
    }
  }

  return deleted;
}

/**
 * Find callers of deleted functions. Returns findings without LLM analysis --
 * a deleted function with remaining callers is always a bug.
 */
export function findDeletedFunctionCallers(
  patches: Map<string, string>,
  headChunks: CodeChunk[],
  graph: DependencyGraph,
  logger: Logger,
  repoChunks?: CodeChunk[],
): ReviewFinding[] {
  const deletedFunctions = detectDeletedFunctions(patches, headChunks);
  if (deletedFunctions.length === 0) return [];

  logger.info(`Bug finder: ${deletedFunctions.length} deleted function(s) detected`);

  const findings: ReviewFinding[] = [];
  for (const { filepath, symbolName } of deletedFunctions) {
    // Try dependency graph first (works when function file still has other exports)
    let callers = graph.getCallers(filepath, symbolName);

    // Fallback: scan repo chunks for call sites referencing the deleted symbol.
    // Needed because the dep graph can't resolve callers for functions that
    // no longer exist in HEAD (no export index entry).
    // Only match callers in the same language -- a deleted PHP function
    // cannot affect TypeScript callers that share the same name.
    if (callers.length === 0 && repoChunks) {
      const deletedFileExt = filepath.split('.').pop() ?? '';
      callers = repoChunks
        .filter(
          c =>
            c.metadata.file !== filepath &&
            isSameLanguageFamily(c.metadata.file, deletedFileExt) &&
            c.metadata.callSites?.some(cs => cs.symbol === symbolName),
        )
        .map(c => ({
          caller: {
            filepath: c.metadata.file,
            symbolName: c.metadata.symbolName ?? 'unknown',
            chunk: c,
          },
          callSiteLine: c.metadata.callSites!.find(cs => cs.symbol === symbolName)!.line,
        }));
    }

    if (callers.length === 0) continue;

    const callerInfos: BugCallerInfo[] = callers.slice(0, MAX_CALLERS_PER_FUNCTION).map(c => ({
      filepath: c.caller.filepath,
      line: c.callSiteLine,
      symbol: c.caller.symbolName,
      category: 'broken_assumption',
      description: `Calls deleted function \`${symbolName}\``,
      suggestion: `Remove or replace call to \`${symbolName}\``,
    }));

    const metadata: BugFindingMetadata = {
      pluginType: 'bugs',
      changedFunction: `${filepath}::${symbolName} (deleted)`,
      callers: callerInfos,
    };

    findings.push({
      pluginId: 'bugs',
      filepath,
      line: 1, // Function is deleted, so no specific line
      symbolName: `${symbolName} (deleted)`,
      severity: 'error',
      category: 'bug',
      message: formatCallerTable(callerInfos),
      metadata,
    });

    logger.info(`Bug finder: deleted \`${symbolName}\` has ${callers.length} remaining callers`);
  }

  return findings;
}
