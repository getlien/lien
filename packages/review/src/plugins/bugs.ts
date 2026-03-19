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
const BUG_REVIEW_MARKER = '<!-- lien-plugin:bugs-review -->';

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
    const { chunks, logger } = context;

    if (!context.llm) {
      logger.info('Bug finder: skipping — no LLM configured');
      return [];
    }
    if (!context.repoChunks) {
      logger.info('Bug finder: skipping — no repoChunks available');
      return [];
    }

    logger.info(
      `Bug finder: ${chunks.length} changed chunks, ${context.repoChunks.length} repo chunks`,
    );

    const changedFunctions = collectChangedFunctions(chunks);
    logger.info(
      `Bug finder: ${changedFunctions.length} changed functions: ${changedFunctions.map(f => `${f.filepath}::${f.symbolName}`).join(', ')}`,
    );
    if (changedFunctions.length === 0) return [];

    const graph = buildDependencyGraph(context.repoChunks);
    const batches = buildBatches(changedFunctions, graph, logger);
    if (batches.length === 0) return [];

    const allFindings: ReviewFinding[] = [];
    for (const batch of batches) {
      const prompt = buildBugFinderPrompt(batch, context);
      const response = await context.llm.complete(prompt, { temperature: 0 });
      const bugs = parseBugResponse(response.content, logger);
      allFindings.push(...bugs.map(bug => bugToFinding(bug, batch)));
    }

    logger.info(`Bug finder: ${allFindings.length} potential bugs found`);
    return allFindings;
  }

  async present(findings: ReviewFinding[], context: PresentContext): Promise<void> {
    if (findings.length === 0) return;

    // Try inline comments first (only works for lines within the diff)
    let inlinePosted = 0;
    const inlineFindings = findings.filter(f => f.line > 0);
    if (inlineFindings.length > 0 && context.postInlineComments) {
      const result = await context.postInlineComments(inlineFindings, 'Bug Finder');
      inlinePosted = result.posted;
    }

    // Post a top-level review comment for error-severity bugs that weren't posted inline
    const errors = findings.filter(f => f.severity === 'error');
    if (errors.length > 0 && context.postReviewComment && inlinePosted < errors.length) {
      // Minimize previous bug finder comments so re-runs don't clutter the conversation
      if (context.minimizeOutdatedComments) {
        await context.minimizeOutdatedComments(BUG_REVIEW_MARKER);
      }
      const body = formatBugReviewComment(errors);
      await context.postReviewComment(body);
    }

    // Append to check run summary
    const lines = findings.map(
      f =>
        `- **${f.severity}** \`${f.filepath}:${f.line}\` ${f.symbolName ? `in \`${f.symbolName}\`` : ''}: ${f.message}`,
    );
    context.appendSummary(`### Bug Finder\n\n${lines.join('\n')}`);
  }
}

function formatBugReviewComment(errors: ReviewFinding[]): string {
  const count = errors.length;
  const header = `${BUG_REVIEW_MARKER}\n**Bug Finder** · ${count} issue${count === 1 ? '' : 's'} in callers of changed functions\n`;
  const items = errors.map(f => {
    const symbol = f.symbolName ? `\`${f.symbolName}\`` : f.filepath;
    const suggestion = f.suggestion ? ` · ${f.suggestion}` : '';
    return `| \`${f.filepath}:${f.line}\` | ${symbol} | ${f.message}${suggestion} |`;
  });
  const table = `| Location | Caller | Issue |\n|---|---|---|\n${items.join('\n')}`;
  return `${header}\n${table}`;
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

function collectFunctionsWithCallers(
  changedFunctions: ChangedFunction[],
  graph: ReturnType<typeof buildDependencyGraph>,
): { fn: ChangedFunction; callers: CallerEdge[] }[] {
  const result: { fn: ChangedFunction; callers: CallerEdge[] }[] = [];
  for (const fn of changedFunctions) {
    const callers = graph.getCallers(fn.filepath, fn.symbolName);
    if (callers.length > 0) result.push({ fn, callers });
  }
  return result;
}

function selectTopCallers(callers: CallerEdge[]): CallerEdge[] {
  return callers
    .slice()
    .sort(
      (a, b) =>
        (b.caller.chunk.metadata.complexity ?? 0) - (a.caller.chunk.metadata.complexity ?? 0),
    )
    .slice(0, MAX_CALLERS_PER_FUNCTION);
}

function estimateChars(fn: ChangedFunction, topCallers: CallerEdge[]): number {
  const callerChars = topCallers.reduce(
    (sum, c) => sum + Math.min(c.caller.chunk.content.length, MAX_CALLER_SNIPPET_CHARS),
    0,
  );
  return fn.chunk.content.length + callerChars;
}

function batchByTokenBudget(
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

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function bugToFinding(bug: BugReport, batch: PromptBatch): ReviewFinding {
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
    changedFunction: changedFn ? `${changedFn.filepath}::${changedFn.symbolName}` : bug.filepath,
  };

  return {
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
  };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function truncateContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + '\n// ... truncated';
}

function buildFunctionSection(fn: ChangedFunction, callers: CallerEdge[]): string {
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

function buildBugFinderPrompt(batch: PromptBatch, context: ReviewContext): string {
  const prHeader =
    context.pr?.title || context.pr?.body
      ? `## PR: ${context.pr.title ?? ''}${context.pr.body ? `\n\n${context.pr.body.slice(0, 1000)}` : ''}\n\n`
      : '';

  const sections = batch.functions.map(fn => {
    const callers = batch.callerMap.get(`${fn.filepath}::${fn.symbolName}`) ?? [];
    return buildFunctionSection(fn, callers);
  });

  return `Find bugs in callers of changed functions. Be terse — write like a linter, not a human.

${prHeader}## Changed Functions

${sections.join('\n')}

## Categories

type_mismatch | null_check | parameter_change | broken_assumption | logic_error | unchecked_error

## Response Format

ONLY valid JSON:

\`\`\`json
{
  "bugs": [
    {
      "filepath": "path/to/file.ts",
      "line": 42,
      "symbol": "callerFunction",
      "severity": "error or warning",
      "category": "one of the categories above",
      "description": "Short, direct statement of the bug (max 15 words)",
      "suggestion": "Short fix (max 15 words)"
    }
  ]
}
\`\`\`

Rules:
- ONLY report bugs you are confident about
- Description must be a short statement, not an explanation. Bad: "The function uses X which does Y, but Z expects W". Good: "Passes null to JSON.parse — will throw TypeError"
- Suggestion must be a concrete action. Bad: "Add null check". Good: "Guard with \`if (!jsonStr) return [];\`"
- Focus on CALLERS, not the changed function itself
- If no bugs, return \`{ "bugs": [] }\``;
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
