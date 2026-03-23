/**
 * Reverse-direction analysis: changed callers -> callees.
 *
 * Checks if changed functions use existing (unchanged) functions correctly.
 * Catches bugs where new/modified code calls existing APIs incorrectly
 * (wrong args, missing error handling, etc.).
 */

import type { CodeChunk } from '@liendev/parser';
import type { DependencyGraph } from '../../dependency-graph.js';
import type { ReviewContext, ReviewFinding, BugCallerInfo } from '../../plugin-types.js';
import type { ChangedFunction } from './types.js';
import { MAX_CALLER_SNIPPET_CHARS } from './types.js';
import { collectChangedFunctions } from './forward.js';
import { truncateContent, formatCallerTable } from './formatting.js';
import { parseBugResponse } from './parsing.js';
import { resolveTypeContext } from './resolve-types.js';

const MAX_CALLEES_PER_CALLER = 3;

/**
 * Analyze changed functions as callers -- check if they use existing
 * (unchanged) functions correctly. This catches bugs where new/modified
 * code calls existing APIs incorrectly (wrong args, missing error handling, etc.).
 *
 * Only analyzes calls to functions NOT already covered by the forward analysis
 * (i.e., callees that are NOT themselves changed functions).
 */
export async function analyzeChangedCallers(
  chunks: CodeChunk[],
  context: ReviewContext,
  _graph: DependencyGraph,
): Promise<ReviewFinding[]> {
  if (!context.llm || !context.repoChunks) return [];

  const changedFunctions = collectChangedFunctions(chunks, context.pr?.diffLines);
  if (changedFunctions.length === 0) return [];

  // Build set of changed function keys to avoid duplicate analysis
  const changedFunctionKeys = new Set(
    changedFunctions.map(fn => `${fn.filepath}::${fn.symbolName}`),
  );

  // For each changed function, find callees that are NOT changed themselves
  const callerCalleesPairs: { caller: ChangedFunction; callees: CodeChunk[] }[] = [];

  for (const caller of changedFunctions) {
    const callSites = caller.chunk.metadata.callSites;
    if (!callSites || callSites.length === 0) continue;

    const calleeChunks: CodeChunk[] = [];
    const seenCallees = new Set<string>();

    for (const cs of callSites) {
      // Skip if this callee is already analyzed as a changed function
      // (forward analysis already covers it)
      const calleeKey = context.repoChunks.find(
        c =>
          c.metadata.symbolName === cs.symbol &&
          c.metadata.file !== caller.filepath &&
          (c.metadata.symbolType === 'function' || c.metadata.symbolType === 'method'),
      );
      if (!calleeKey) continue;

      const key = `${calleeKey.metadata.file}::${cs.symbol}`;
      if (changedFunctionKeys.has(key) || seenCallees.has(key)) continue;
      seenCallees.add(key);
      calleeChunks.push(calleeKey);
    }

    if (calleeChunks.length > 0) {
      callerCalleesPairs.push({ caller, callees: calleeChunks.slice(0, MAX_CALLEES_PER_CALLER) });
    }
  }

  if (callerCalleesPairs.length === 0) return [];
  context.logger.info(
    `Bug finder: analyzing ${callerCalleesPairs.length} changed caller(s) for correct API usage`,
  );

  const findings = (
    await Promise.all(
      callerCalleesPairs.map(async ({ caller, callees }) => {
        const calleeSections = callees
          .map(c => {
            const sig = c.metadata.signature ?? c.metadata.symbolName ?? 'unknown';
            const content = truncateContent(c.content, MAX_CALLER_SNIPPET_CHARS);
            return `### ${c.metadata.file}::${c.metadata.symbolName}\nSignature: \`${sig}\`\nReturn type: \`${c.metadata.returnType ?? 'unknown'}\`\n\n\`\`\`${c.metadata.language ?? ''}\n${content}\n\`\`\``;
          })
          .join('\n\n');

        // Include the diff patch so the LLM can focus on changed lines only
        const callerPatch = context.pr?.patches?.get(caller.filepath);
        const diffSection = callerPatch
          ? `\n## Diff for ${caller.filepath}\n\n\`\`\`diff\n${truncateContent(callerPatch, 3000)}\n\`\`\`\n`
          : '';

        // Resolve imported type definitions for the caller and its callees
        const typeContext = resolveTypeContext([caller.chunk, ...callees], context.repoChunks);

        const prompt = `Check if this changed function uses existing APIs correctly. Be terse — write like a linter, not a human.

## Changed Caller

### ${caller.filepath}::${caller.symbolName}
\`\`\`${caller.chunk.metadata.language ?? ''}
${caller.chunk.content}
\`\`\`
${diffSection}
## APIs Called by ${caller.symbolName}

${calleeSections}
${typeContext}
## Response Format

ONLY valid JSON. Report bugs in the CHANGED CALLER, not the APIs it calls.

\`\`\`json
{
  "bugs": [
    {
      "changedFunction": "${caller.symbolName}",
      "callerFilepath": "${caller.filepath}",
      "callerLine": 42,
      "callerSymbol": "${caller.symbolName}",
      "severity": "error or warning",
      "category": "type_mismatch | null_check | parameter_change | broken_assumption | logic_error | unchecked_error",
      "description": "Short statement (max 15 words)",
      "suggestion": "Short fix (max 15 words)"
    }
  ]
}
\`\`\`

Rules:
- ONLY report bugs on CHANGED lines (visible in the diff above) — do NOT flag unchanged/pre-existing code
- Read function signatures from the code shown — do NOT guess or hallucinate type signatures
- Optional parameters (marked with ?) do NOT need to be passed — omitting them is valid
- Do NOT flag null checks on values guaranteed by context (e.g., test factories, just-created data)
- Do NOT confuse different types/interfaces in the same file — check the ACTUAL type name
- If no bugs, return \`{ "bugs": [] }\``;

        const response = await context.llm!.complete(prompt, { temperature: 0 });
        const bugs = parseBugResponse(response.content, context.logger);

        // Filter out bugs that reference a different function than the changed caller
        return bugs
          .filter(b => !b.changedFunction || b.changedFunction === caller.symbolName)
          .map(bug => {
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
              filepath: caller.filepath,
              line: caller.chunk.metadata.startLine,
              symbolName: caller.symbolName,
              severity: bug.severity,
              category: 'bug',
              message: formatCallerTable(callerInfos),
              metadata: {
                pluginType: 'bugs',
                changedFunction: `${caller.filepath}::${caller.symbolName}`,
                callers: callerInfos,
              },
            } satisfies ReviewFinding;
          });
      }),
    )
  ).flat();

  return findings;
}
