/**
 * Bug Finder plugin.
 *
 * Analyzes changed functions in the context of their callers (from the full repo)
 * to find bugs introduced by the changes. Findings are anchored on the changed
 * function (in the diff), with affected callers listed in the message.
 */

import type { CodeChunk } from '@liendev/parser';
import type {
  ReviewPlugin,
  ReviewContext,
  ReviewFinding,
  BugFindingMetadata,
  BugCallerInfo,
  PresentContext,
} from '../plugin-types.js';
import {
  buildDependencyGraph,
  type CallerEdge,
  type DependencyGraph,
} from '../dependency-graph.js';
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

/** What the LLM returns — caller-focused. */
interface BugReport {
  changedFunction: string;
  callerFilepath: string;
  callerLine: number;
  callerSymbol: string;
  severity: 'error' | 'warning';
  category: string;
  description: string;
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
    const hasFunctions = context.chunks.some(
      c => c.metadata.symbolType === 'function' || c.metadata.symbolType === 'method',
    );
    const hasTypes = context.chunks.some(
      c => c.metadata.symbolType === 'class' || c.metadata.symbolType === 'interface',
    );
    const hasDeletedFunctions =
      context.pr?.patches && detectDeletedFunctions(context.pr.patches, context.chunks).length > 0;
    return hasFunctions || hasTypes || !!hasDeletedFunctions;
  }

  async analyze(context: ReviewContext): Promise<ReviewFinding[]> {
    const { chunks, logger } = context;

    if (!context.repoChunks) {
      logger.info('Bug finder: skipping — no repoChunks available');
      return [];
    }

    const graph = buildDependencyGraph(context.repoChunks);
    const allFindings: ReviewFinding[] = [];

    // 1. Detect deleted functions and find remaining callers (deterministic, no LLM)
    if (context.pr?.patches) {
      const deletedFindings = findDeletedFunctionCallers(
        context.pr.patches,
        chunks,
        graph,
        logger,
        context.repoChunks,
      );
      allFindings.push(...deletedFindings);
    }

    // 2. Analyze changed functions via LLM
    if (context.llm) {
      const changedFunctions = collectChangedFunctions(chunks, context.pr?.diffLines);
      if (changedFunctions.length > 0) {
        const batches = buildBatches(changedFunctions, graph, logger);
        for (const batch of batches) {
          const prompt = buildBugFinderPrompt(batch, context);
          const response = await context.llm.complete(prompt, { temperature: 0 });
          const bugs = parseBugResponse(response.content, logger);
          allFindings.push(...bugsToGroupedFindings(bugs, batch));
        }
      }

      // 3. Analyze changed types/interfaces — find importers that may not satisfy new contracts
      const typeFindings = await analyzeChangedTypes(chunks, context);
      allFindings.push(...typeFindings);

      // 4. Analyze changed constants/variables — check if value changes break assumptions
      if (context.pr?.patches && context.repoChunks) {
        const constFindings = await analyzeChangedConstants(context);
        allFindings.push(...constFindings);
      }

      // 5. Analyze changed callers — check if new/modified code uses existing functions correctly
      const callerFindings = await analyzeChangedCallers(chunks, context, graph);
      allFindings.push(...callerFindings);
    }

    logger.info(`Bug finder: ${allFindings.length} findings (grouped by changed function)`);
    return allFindings;
  }

  async present(findings: ReviewFinding[], context: PresentContext): Promise<void> {
    if (findings.length === 0) return;

    const blobBase = buildBlobBase(context.pr);

    // Minimize previous bug finder review comments
    if (context.minimizeOutdatedComments) {
      await context.minimizeOutdatedComments(BUG_REVIEW_MARKER);
    }

    // Rebuild finding messages with GitHub links for inline comments
    const linkedFindings = findings.map(f => ({
      ...f,
      message: rebuildMessageWithLinks(f, blobBase),
    }));

    // Post inline comments on the diff (deduped automatically)
    if (context.postInlineComments) {
      await context.postInlineComments(linkedFindings, 'Bug Finder');
    }

    // Always post a review comment as the primary notification
    // (inline comments may be deduped from previous runs or filtered out of diff)
    if (context.postReviewComment) {
      const body = formatBugReviewComment(linkedFindings);
      await context.postReviewComment(body);
    }

    // Append to check run summary (also linked)
    context.appendSummary(formatBugSummary(linkedFindings, blobBase));
  }
}

// ---------------------------------------------------------------------------
// Finding construction — group bugs per changed function
// ---------------------------------------------------------------------------

function associateBugToFunction(bug: BugReport, batch: PromptBatch): ChangedFunction | null {
  // Primary: match by changedFunction name from LLM response
  if (bug.changedFunction) {
    const match = batch.functions.find(fn => fn.symbolName === bug.changedFunction);
    if (match) return match;
  }

  // Fallback: match by caller filepath + symbol (more precise than filepath alone)
  for (const fn of batch.functions) {
    const callers = batch.callerMap.get(`${fn.filepath}::${fn.symbolName}`) ?? [];
    if (
      callers.some(
        c => c.caller.filepath === bug.callerFilepath && c.caller.symbolName === bug.callerSymbol,
      )
    )
      return fn;
  }

  // Last resort: match by caller filepath only
  for (const fn of batch.functions) {
    const callers = batch.callerMap.get(`${fn.filepath}::${fn.symbolName}`) ?? [];
    if (callers.some(c => c.caller.filepath === bug.callerFilepath)) return fn;
  }

  return null;
}

function bugsToGroupedFindings(bugs: BugReport[], batch: PromptBatch): ReviewFinding[] {
  // Group bugs by changed function
  const grouped = new Map<ChangedFunction, BugReport[]>();
  for (const bug of bugs) {
    const fn = associateBugToFunction(bug, batch);
    if (!fn) continue;
    const existing = grouped.get(fn) ?? [];
    existing.push(bug);
    grouped.set(fn, existing);
  }

  // One finding per changed function
  const findings: ReviewFinding[] = [];
  for (const [fn, fnBugs] of grouped) {
    const callers: BugCallerInfo[] = fnBugs.map(b => ({
      filepath: b.callerFilepath,
      line: b.callerLine,
      symbol: b.callerSymbol,
      category: b.category,
      description: b.description,
      suggestion: b.suggestion,
    }));

    const worstSeverity = fnBugs.some(b => b.severity === 'error') ? 'error' : 'warning';

    const metadata: BugFindingMetadata = {
      pluginType: 'bugs',
      changedFunction: `${fn.filepath}::${fn.symbolName}`,
      callers,
    };

    findings.push({
      pluginId: 'bugs',
      filepath: fn.filepath,
      line: fn.chunk.metadata.startLine,
      symbolName: fn.symbolName,
      severity: worstSeverity,
      category: 'bug',
      message: formatCallerTable(callers),
      metadata,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function buildBlobBase(pr?: { owner: string; repo: string; headSha: string }): string | null {
  if (!pr) return null;
  return `https://github.com/${pr.owner}/${pr.repo}/blob/${pr.headSha}`;
}

function callerLink(c: BugCallerInfo, blobBase: string | null): string {
  if (blobBase) {
    return `[${c.filepath}:${c.line}](${blobBase}/${c.filepath}#L${c.line})`;
  }
  return `\`${c.filepath}:${c.line}\``;
}

/** Plain table (no links) — stored in finding.message during analyze(). */
function formatCallerTable(callers: BugCallerInfo[]): string {
  const count = callers.length;
  const header = `${count} caller${count === 1 ? '' : 's'} affected by this change\n\n`;
  const rows = callers.map(
    c => `| \`${c.filepath}:${c.line}\` | \`${c.symbol}\` | ${c.description} | ${c.suggestion} |`,
  );
  return `${header}| Caller | Function | Issue | Fix |\n|---|---|---|---|\n${rows.join('\n')}`;
}

/** Rebuild the message with GitHub links for present(). */
function rebuildMessageWithLinks(f: ReviewFinding, blobBase: string | null): string {
  const meta = f.metadata as BugFindingMetadata | undefined;
  if (!meta?.callers || !blobBase) return f.message;
  return formatLinkedCallerTable(meta.callers, blobBase);
}

function formatLinkedCallerTable(callers: BugCallerInfo[], blobBase: string | null): string {
  const count = callers.length;
  const header = `${count} caller${count === 1 ? '' : 's'} affected by this change\n\n`;
  const rows = callers.map(
    c => `| ${callerLink(c, blobBase)} | \`${c.symbol}\` | ${c.description} | ${c.suggestion} |`,
  );
  return `${header}| Caller | Function | Issue | Fix |\n|---|---|---|---|\n${rows.join('\n')}`;
}

function formatBugReviewComment(findings: ReviewFinding[]): string {
  const sections = findings.map(f => {
    const sym = f.symbolName ? `\`${f.symbolName}\`` : f.filepath;
    return `**${sym}** (\`${f.filepath}:${f.line}\`)\n\n${f.message}`;
  });
  return `${BUG_REVIEW_MARKER}\n**Bug Finder**\n\n${sections.join('\n\n---\n\n')}`;
}

function formatBugSummary(findings: ReviewFinding[], blobBase: string | null): string {
  const sections = findings.map(f => {
    const meta = f.metadata as BugFindingMetadata;
    const callerCount = meta.callers.length;
    const rows = meta.callers.map(c => `| ${callerLink(c, blobBase)} | ${c.description} |`);
    return `**\`${f.symbolName}\`** (\`${f.filepath}:${f.line}\`) — ${callerCount} caller${callerCount === 1 ? '' : 's'} affected\n\n| Caller | Issue |\n|---|---|\n${rows.join('\n')}`;
  });
  return `### Bug Finder\n\n${sections.join('\n\n')}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectChangedFunctions(
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
- If no bugs, return \`{ "bugs": [] }\``;
}

// ---------------------------------------------------------------------------
// Response Parsing
// ---------------------------------------------------------------------------

function isValidBug(bug: unknown): bug is BugReport {
  if (!bug || typeof bug !== 'object') return false;
  const b = bug as Record<string, unknown>;
  return (
    typeof b.callerFilepath === 'string' &&
    typeof b.callerLine === 'number' &&
    typeof b.callerSymbol === 'string' &&
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
    changedFunction: bug.changedFunction ?? '',
    severity: bug.severity === 'error' ? 'error' : 'warning',
    callerSymbol: bug.callerSymbol ?? 'unknown',
    suggestion: bug.suggestion ?? '',
  };
}

// ---------------------------------------------------------------------------
// Changed type/interface analysis
// ---------------------------------------------------------------------------

const TYPE_SYMBOL_TYPES = new Set(['class', 'interface']);
const MAX_TYPE_IMPORTERS = 5;
const MAX_IMPORTER_SNIPPET_CHARS = 2_000;

/**
 * Collect changed type/interface/class definitions from chunks.
 */
function collectChangedTypes(
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
function findImporters(
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
async function analyzeChangedTypes(
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

Check if the importing code satisfies the current type contract. Look for:
- Object literals or constructors missing required fields
- Spread operations that don't include new required properties
- Type assertions that bypass the new contract
- Factory functions that return incomplete objects

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
- ONLY report bugs you are confident about
- If no bugs, return \`{ "bugs": [] }\``;

    const response = await context.llm.complete(prompt, { temperature: 0 });
    const bugs = parseBugResponse(response.content, context.logger);

    for (const bug of bugs) {
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

// ---------------------------------------------------------------------------
// Changed constant/variable analysis
// ---------------------------------------------------------------------------

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
function detectChangedConstants(patches: Map<string, string>): ChangedConstant[] {
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
async function analyzeChangedConstants(context: ReviewContext): Promise<ReviewFinding[]> {
  if (!context.llm || !context.repoChunks || !context.pr?.patches) return [];

  const changedConstants = detectChangedConstants(context.pr.patches);
  if (changedConstants.length === 0) return [];

  context.logger.info(`Bug finder: ${changedConstants.length} changed constant(s) to analyze`);
  const findings: ReviewFinding[] = [];

  for (const { filepath, name, oldValue, newValue } of changedConstants) {
    const importers = findImporters(name, filepath, context.repoChunks);
    if (importers.length === 0) continue;

    const topImporters = importers.slice(0, MAX_TYPE_IMPORTERS);
    const importerSections = topImporters
      .map(c => {
        const content = truncateContent(c.content, MAX_IMPORTER_SNIPPET_CHARS);
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

    const response = await context.llm.complete(prompt, { temperature: 0 });
    const bugs = parseBugResponse(response.content, context.logger);

    for (const bug of bugs) {
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
      });
    }
  }

  if (findings.length > 0) {
    context.logger.info(`Bug finder: ${findings.length} constant value violation(s) found`);
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Reverse-direction analysis: check if changed callers use callees correctly
// ---------------------------------------------------------------------------

const MAX_CALLEES_PER_CALLER = 3;

/**
 * Analyze changed functions as callers — check if they use existing
 * (unchanged) functions correctly. This catches bugs where new/modified
 * code calls existing APIs incorrectly (wrong args, missing error handling, etc.).
 *
 * Only analyzes calls to functions NOT already covered by the forward analysis
 * (i.e., callees that are NOT themselves changed functions).
 */
async function analyzeChangedCallers(
  chunks: CodeChunk[],
  context: ReviewContext,
  graph: DependencyGraph,
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

  const findings: ReviewFinding[] = [];

  for (const { caller, callees } of callerCalleesPairs) {
    const calleeSections = callees
      .map(c => {
        const sig = c.metadata.signature ?? c.metadata.symbolName ?? 'unknown';
        const content = truncateContent(c.content, MAX_CALLER_SNIPPET_CHARS);
        return `### ${c.metadata.file}::${c.metadata.symbolName}\nSignature: \`${sig}\`\nReturn type: \`${c.metadata.returnType ?? 'unknown'}\`\n\n\`\`\`${c.metadata.language ?? ''}\n${content}\n\`\`\``;
      })
      .join('\n\n');

    const prompt = `Check if this changed function uses existing APIs correctly. Be terse — write like a linter, not a human.

## Changed Caller

### ${caller.filepath}::${caller.symbolName}
\`\`\`${caller.chunk.metadata.language ?? ''}
${caller.chunk.content}
\`\`\`

## APIs Called by ${caller.symbolName}

${calleeSections}

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
- ONLY report bugs you are confident about in the changed caller
- Check: wrong parameter count/types, missing null/error checks, incorrect assumptions about return values
- If no bugs, return \`{ "bugs": [] }\``;

    const response = await context.llm.complete(prompt, { temperature: 0 });
    const bugs = parseBugResponse(response.content, context.logger);

    for (const bug of bugs) {
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
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Deleted function detection (deterministic — no LLM needed)
// ---------------------------------------------------------------------------

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
function detectDeletedFunctions(
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
 * Find callers of deleted functions. Returns findings without LLM analysis —
 * a deleted function with remaining callers is always a bug.
 */
function findDeletedFunctionCallers(
  patches: Map<string, string>,
  headChunks: CodeChunk[],
  graph: ReturnType<typeof buildDependencyGraph>,
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
    if (callers.length === 0 && repoChunks) {
      callers = repoChunks
        .filter(
          c =>
            c.metadata.file !== filepath &&
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
