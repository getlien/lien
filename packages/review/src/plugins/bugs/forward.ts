/**
 * Forward analysis: changed functions -> callers.
 *
 * Collects changed functions, builds batches with their callers, and
 * constructs the LLM prompt for bug detection.
 */

import type { CodeChunk } from '@liendev/parser';
import type { CallerEdge, DependencyGraph } from '../../dependency-graph.js';
import type { ReviewContext } from '../../plugin-types.js';
import type { Logger } from '../../logger.js';
import type { ChangedFunction, PromptBatch } from './types.js';
import {
  MAX_PROMPT_CHARS,
  MAX_CALLERS_PER_FUNCTION,
  MAX_CHANGED_FUNCTIONS_PER_BATCH,
  MAX_CALLER_SNIPPET_CHARS,
} from './types.js';
import { truncateContent } from './formatting.js';
import { resolveTypeContext } from './resolve-types.js';

// ---------------------------------------------------------------------------
// Changed function collection
// ---------------------------------------------------------------------------

export function collectChangedFunctions(
  chunks: CodeChunk[],
  diffLines?: Map<string, Set<number>>,
): ChangedFunction[] {
  return chunks
    .filter(c => c.metadata.symbolType === 'function' || c.metadata.symbolType === 'method')
    .filter(c => c.metadata.symbolName)
    .filter(c => {
      // When diffLines are available, only include functions whose line range
      // overlaps with actual diff changes. This prevents reporting pre-existing
      // bugs in functions that happen to be in a changed file but weren't modified.
      if (!diffLines) return true;
      const lines = diffLines.get(c.metadata.file);
      if (!lines) return true;
      const start = c.metadata.startLine;
      const end = c.metadata.endLine;
      for (let line = start; line <= end; line++) {
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

// ---------------------------------------------------------------------------
// Batching
// ---------------------------------------------------------------------------

export function collectFunctionsWithCallers(
  changedFunctions: ChangedFunction[],
  graph: DependencyGraph,
): { fn: ChangedFunction; callers: CallerEdge[] }[] {
  const result: { fn: ChangedFunction; callers: CallerEdge[] }[] = [];
  for (const fn of changedFunctions) {
    const callers = graph.getCallers(fn.filepath, fn.symbolName);
    if (callers.length > 0) result.push({ fn, callers });
  }
  return result;
}

export function selectTopCallers(callers: CallerEdge[]): CallerEdge[] {
  return callers
    .slice()
    .sort(
      (a, b) =>
        (b.caller.chunk.metadata.complexity ?? 0) - (a.caller.chunk.metadata.complexity ?? 0),
    )
    .slice(0, MAX_CALLERS_PER_FUNCTION);
}

export function estimateChars(fn: ChangedFunction, topCallers: CallerEdge[]): number {
  const callerChars = topCallers.reduce(
    (sum, c) => sum + Math.min(c.caller.chunk.content.length, MAX_CALLER_SNIPPET_CHARS),
    0,
  );
  return fn.chunk.content.length + callerChars;
}

export function batchByTokenBudget(
  withCallers: { fn: ChangedFunction; callers: CallerEdge[] }[],
): PromptBatch[] {
  const batches: PromptBatch[] = [];
  let currentBatch: PromptBatch = { functions: [], callerMap: new Map() };
  let currentChars = 0;

  for (const { fn, callers } of withCallers) {
    const topCallers = selectTopCallers(callers);
    const totalChars = estimateChars(fn, topCallers);

    if (
      currentBatch.functions.length > 0 &&
      (currentChars + totalChars > MAX_PROMPT_CHARS ||
        currentBatch.functions.length >= MAX_CHANGED_FUNCTIONS_PER_BATCH)
    ) {
      batches.push(currentBatch);
      currentBatch = { functions: [], callerMap: new Map() };
      currentChars = 0;
    }

    currentBatch.functions.push(fn);
    currentBatch.callerMap.set(`${fn.filepath}::${fn.symbolName}`, topCallers);
    currentChars += totalChars;
  }

  if (currentBatch.functions.length > 0) batches.push(currentBatch);
  return batches;
}

export function buildBatches(
  changedFunctions: ChangedFunction[],
  graph: DependencyGraph,
  logger: Logger,
): PromptBatch[] {
  const withCallers = collectFunctionsWithCallers(changedFunctions, graph);

  if (withCallers.length === 0) {
    logger.info('Bug finder: no changed functions have callers in the repo');
    return [];
  }

  // Sort by number of callers (highest impact first)
  withCallers.sort((a, b) => b.callers.length - a.callers.length);

  const batches = batchByTokenBudget(withCallers);
  logger.info(
    `Bug finder: ${withCallers.length} changed functions with callers, ${batches.length} batch(es)`,
  );
  return batches;
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

export function buildFunctionSection(fn: ChangedFunction, callers: CallerEdge[]): string {
  const sig = fn.chunk.metadata.signature ?? fn.symbolName;
  const params = fn.chunk.metadata.parameters?.join(', ') ?? '';
  const returnType = fn.chunk.metadata.returnType ?? 'unknown';

  let section = `### ${fn.filepath}::${fn.symbolName}\n`;
  section += `Signature: \`${sig}\`\n`;
  if (params) section += `Parameters: \`${params}\`\n`;
  section += `Return type: \`${returnType}\`\n\n`;
  section += `\`\`\`${fn.chunk.metadata.language ?? ''}\n${fn.chunk.content}\n\`\`\`\n`;

  if (callers.length > 0) {
    section += `\n#### Callers of ${fn.symbolName}\n\n`;
    for (const caller of callers) {
      const callerContent = truncateContent(caller.caller.chunk.content, MAX_CALLER_SNIPPET_CHARS);
      section += `**${caller.caller.filepath}::${caller.caller.symbolName}** (line ${caller.callSiteLine})\n`;
      section += `\`\`\`${caller.caller.chunk.metadata.language ?? ''}\n${callerContent}\n\`\`\`\n\n`;
    }
  }

  return section;
}

export function buildBugFinderPrompt(batch: PromptBatch, context: ReviewContext): string {
  const prHeader =
    context.pr?.title || context.pr?.body
      ? `## PR: ${context.pr.title ?? ''}${context.pr.body ? `\n\n${context.pr.body.slice(0, 1000)}` : ''}\n\n`
      : '';

  const sections = batch.functions.map(fn => {
    const callers = batch.callerMap.get(`${fn.filepath}::${fn.symbolName}`) ?? [];
    return buildFunctionSection(fn, callers);
  });

  // Collect all chunks involved (changed functions + callers) for type resolution
  const allChunks = [
    ...batch.functions.map(fn => fn.chunk),
    ...batch.functions.flatMap(fn =>
      (batch.callerMap.get(`${fn.filepath}::${fn.symbolName}`) ?? []).map(c => c.caller.chunk),
    ),
  ];
  const typeContext = resolveTypeContext(allChunks, context.repoChunks);

  return `Find bugs in callers of changed functions. Be terse — write like a linter, not a human.

${prHeader}## Changed Functions

${sections.join('\n')}
${typeContext}
## Categories

type_mismatch | null_check | parameter_change | broken_assumption | logic_error | unchecked_error

## Response Format

ONLY valid JSON. Report the CALLER that breaks, not the changed function.

\`\`\`json
{
  "bugs": [
    {
      "changedFunction": "nameOfChangedFunction",
      "callerFilepath": "path/to/caller.ts",
      "callerLine": 42,
      "callerSymbol": "functionThatBreaks",
      "severity": "error or warning",
      "category": "one of the categories above",
      "description": "Short statement of the bug (max 15 words)",
      "suggestion": "Short fix (max 15 words)"
    }
  ]
}
\`\`\`

Rules:
- ONLY report bugs you are confident about
- changedFunction must be the name of the changed function (from the "## Changed Functions" sections above) that caused the bug
- callerFilepath/callerLine/callerSymbol must reference a CALLER shown above, not the changed function
- Description: short statement. Good: "Passes null to JSON.parse — TypeError". Bad: "The function uses X which..."
- Suggestion: concrete action. Good: "Guard with \`if (!x) return []\`". Bad: "Add null check"
- ONLY flag bugs INTRODUCED by the change — do NOT flag pre-existing patterns in unchanged code
- Read function signatures from the code shown — do NOT guess or hallucinate type signatures
- Optional parameters (marked with ?) do NOT need to be passed — omitting them is valid
- Do NOT confuse different types/interfaces in the same file — check the ACTUAL type name
- Do NOT flag null checks in test files where data was just created above
- If no bugs, return \`{ "bugs": [] }\``;
}
