/**
 * Bug Finder plugin.
 *
 * Analyzes changed functions in the context of their callers (from the full repo)
 * to find bugs introduced by the changes. Uses the dependency graph to locate
 * callers and an LLM for bug detection.
 */

import type { CodeChunk } from '@liendev/parser';
import type {
  ReviewPlugin,
  ReviewContext,
  ReviewFinding,
  BugFindingMetadata,
  PresentContext,
} from '../plugin-types.js';
import { buildDependencyGraph, type CallerEdge } from '../dependency-graph.js';
import { extractJSONFromCodeBlock } from '../json-utils.js';
import type { Logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PROMPT_CHARS = 60_000;
const MAX_CALLERS_PER_FUNCTION = 5;
const MAX_CHANGED_FUNCTIONS_PER_BATCH = 8;
const MAX_CALLER_SNIPPET_CHARS = 2_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChangedFunction {
  filepath: string;
  symbolName: string;
  chunk: CodeChunk;
}

interface BugReport {
  filepath: string;
  line: number;
  symbol: string;
  severity: 'error' | 'warning';
  category: string;
  description: string;
  evidence: string;
  suggestion: string;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export class BugFinderPlugin implements ReviewPlugin {
  id = 'bugs';
  name = 'Bug Finder';
  description = 'Finds bugs by analyzing changed functions in the context of their callers';
  requiresLLM = true;
  requiresRepoChunks = true;

  shouldActivate(context: ReviewContext): boolean {
    return context.chunks.some(
      c => c.metadata.symbolType === 'function' || c.metadata.symbolType === 'method',
    );
  }

  async analyze(context: ReviewContext): Promise<ReviewFinding[]> {
    if (!context.llm || !context.repoChunks) return [];

    const { chunks, logger } = context;

    // 1. Identify changed functions
    const changedFunctions = collectChangedFunctions(chunks);
    if (changedFunctions.length === 0) return [];

    // 2. Build dependency graph from full repo
    const graph = buildDependencyGraph(context.repoChunks);

    // 3. Assemble and send batched prompts
    const batches = buildBatches(changedFunctions, graph, logger);
    if (batches.length === 0) return [];

    const allFindings: ReviewFinding[] = [];

    for (const batch of batches) {
      const prompt = buildBugFinderPrompt(batch, context);
      const response = await context.llm.complete(prompt);
      const bugs = parseBugResponse(response.content, logger);

      for (const bug of bugs) {
        const changedFn = batch.functions.find(
          f =>
            f.filepath === bug.filepath ||
            batch.callerMap
              .get(`${f.filepath}::${f.symbolName}`)
              ?.some(e => e.caller.filepath === bug.filepath),
        );

        const metadata: BugFindingMetadata = {
          pluginType: 'bugs',
          bugCategory: bug.category,
          changedFunction: changedFn
            ? `${changedFn.filepath}::${changedFn.symbolName}`
            : bug.filepath,
        };

        allFindings.push({
          pluginId: 'bugs',
          filepath: bug.filepath,
          line: bug.line,
          symbolName: bug.symbol,
          severity: bug.severity === 'error' ? 'error' : 'warning',
          category: bug.category,
          message: bug.description,
          suggestion: bug.suggestion,
          evidence: bug.evidence,
          metadata,
        });
      }
    }

    logger.info(`Bug finder: ${allFindings.length} potential bugs found`);
    return allFindings;
  }

  async present(findings: ReviewFinding[], context: PresentContext): Promise<void> {
    if (findings.length === 0) return;

    // Post inline comments for findings with specific lines
    const inlineFindings = findings.filter(f => f.line > 0);
    if (inlineFindings.length > 0 && context.postInlineComments) {
      const errorCount = findings.filter(f => f.severity === 'error').length;
      const warningCount = findings.filter(f => f.severity === 'warning').length;
      const parts: string[] = [];
      if (errorCount > 0) parts.push(`${errorCount} error${errorCount === 1 ? '' : 's'}`);
      if (warningCount > 0) parts.push(`${warningCount} warning${warningCount === 1 ? '' : 's'}`);
      const summaryBody = `Bug Finder: ${parts.join(', ')}`;
      await context.postInlineComments(inlineFindings, summaryBody);
    }

    // Append summary
    const lines = findings.map(
      f =>
        `- **${f.severity}** \`${f.filepath}:${f.line}\` ${f.symbolName ? `in \`${f.symbolName}\`` : ''}: ${f.message}`,
    );
    context.appendSummary(`### Bug Finder\n\n${lines.join('\n')}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectChangedFunctions(chunks: CodeChunk[]): ChangedFunction[] {
  return chunks
    .filter(c => c.metadata.symbolType === 'function' || c.metadata.symbolType === 'method')
    .filter(c => c.metadata.symbolName)
    .map(c => ({
      filepath: c.metadata.file,
      symbolName: c.metadata.symbolName!,
      chunk: c,
    }));
}

interface PromptBatch {
  functions: ChangedFunction[];
  callerMap: Map<string, CallerEdge[]>;
}

function buildBatches(
  changedFunctions: ChangedFunction[],
  graph: ReturnType<typeof buildDependencyGraph>,
  logger: Logger,
): PromptBatch[] {
  // Filter to functions that actually have callers — no point analyzing isolated functions
  const withCallers: { fn: ChangedFunction; callers: CallerEdge[] }[] = [];

  for (const fn of changedFunctions) {
    const callers = graph.getCallers(fn.filepath, fn.symbolName);
    if (callers.length > 0) {
      withCallers.push({ fn, callers });
    }
  }

  if (withCallers.length === 0) {
    logger.info('Bug finder: no changed functions have callers in the repo');
    return [];
  }

  // Sort by number of callers (highest impact first)
  withCallers.sort((a, b) => b.callers.length - a.callers.length);

  // Batch by token budget
  const batches: PromptBatch[] = [];
  let currentBatch: PromptBatch = { functions: [], callerMap: new Map() };
  let currentChars = 0;

  for (const { fn, callers } of withCallers) {
    const topCallers = callers
      .sort(
        (a, b) =>
          (b.caller.chunk.metadata.complexity ?? 0) - (a.caller.chunk.metadata.complexity ?? 0),
      )
      .slice(0, MAX_CALLERS_PER_FUNCTION);

    const fnChars = fn.chunk.content.length;
    const callerChars = topCallers.reduce(
      (sum, c) => sum + Math.min(c.caller.chunk.content.length, MAX_CALLER_SNIPPET_CHARS),
      0,
    );
    const totalChars = fnChars + callerChars;

    // Start new batch if this function doesn't fit
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

  if (currentBatch.functions.length > 0) {
    batches.push(currentBatch);
  }

  logger.info(
    `Bug finder: ${withCallers.length} changed functions with callers, ${batches.length} batch(es)`,
  );
  return batches;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function truncateContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + '\n// ... truncated';
}

function buildBugFinderPrompt(batch: PromptBatch, context: ReviewContext): string {
  const prHeader =
    context.pr?.title || context.pr?.body
      ? `## PR: ${context.pr.title ?? ''}${context.pr.body ? `\n\n${context.pr.body.slice(0, 1000)}` : ''}\n\n`
      : '';

  const sections: string[] = [];

  for (const fn of batch.functions) {
    const callers = batch.callerMap.get(`${fn.filepath}::${fn.symbolName}`) ?? [];
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
        const callerContent = truncateContent(
          caller.caller.chunk.content,
          MAX_CALLER_SNIPPET_CHARS,
        );
        section += `**${caller.caller.filepath}::${caller.caller.symbolName}** (line ${caller.callSiteLine})\n`;
        section += `\`\`\`${caller.caller.chunk.metadata.language ?? ''}\n${callerContent}\n\`\`\`\n\n`;
      }
    }

    sections.push(section);
  }

  return `You are a senior engineer reviewing code changes for bugs. You are given changed functions and the code that calls them. Your job is to find bugs introduced by the changes.

${prHeader}## Changed Functions

${sections.join('\n')}

## Bug Categories to Check

- **type_mismatch**: Return type changed but callers expect the old type
- **null_check**: Function now returns null/undefined but callers don't handle it
- **parameter_change**: Parameters added/removed/reordered but callers use old calling convention
- **broken_assumption**: Callers assume behavior that the new code no longer guarantees
- **logic_error**: Off-by-one, wrong comparison operator, missing edge case
- **unchecked_error**: New throw/reject paths that callers don't catch

## Response Format

Respond with ONLY valid JSON:

\`\`\`json
{
  "bugs": [
    {
      "filepath": "path/to/file.ts",
      "line": 42,
      "symbol": "callerFunction",
      "severity": "error or warning",
      "category": "one of the categories above",
      "description": "Concrete description of the bug",
      "evidence": "Specific code that proves the bug exists",
      "suggestion": "How to fix it"
    }
  ]
}
\`\`\`

Rules:
- ONLY report bugs you are confident about — no speculation
- Each bug must reference a specific line and file
- Bugs in the CALLERS are more valuable than bugs in the changed function itself
- If no bugs found, return \`{ "bugs": [] }\``;
}

// ---------------------------------------------------------------------------
// Response Parsing
// ---------------------------------------------------------------------------

function isValidBug(bug: unknown): bug is BugReport {
  if (!bug || typeof bug !== 'object') return false;
  const b = bug as Record<string, unknown>;
  return (
    typeof b.filepath === 'string' &&
    typeof b.line === 'number' &&
    typeof b.severity === 'string' &&
    typeof b.category === 'string' &&
    typeof b.description === 'string'
  );
}

function parseBugResponse(content: string, logger: Logger): BugReport[] {
  const jsonStr = extractJSONFromCodeBlock(content);

  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.bugs)) {
      const bugs = parsed.bugs.filter(isValidBug);
      logger.info(`Parsed ${bugs.length} bug report(s)`);
      return bugs.map(normalizeBug);
    }
  } catch {
    // Fall through to retry
  }

  // Aggressive retry
  const objectMatch = content.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      if (parsed && Array.isArray(parsed.bugs)) {
        const bugs = parsed.bugs.filter(isValidBug);
        logger.info(`Recovered ${bugs.length} bug report(s) with retry`);
        return bugs.map(normalizeBug);
      }
    } catch {
      // Total failure
    }
  }

  logger.warning('Failed to parse bug finder response');
  return [];
}

function normalizeBug(bug: BugReport): BugReport {
  return {
    ...bug,
    severity: bug.severity === 'error' ? 'error' : 'warning',
    symbol: bug.symbol ?? 'unknown',
    evidence: bug.evidence ?? '',
    suggestion: bug.suggestion ?? '',
  };
}
