/**
 * Architectural review plugin.
 *
 * Sends the actual changed code (sorted by dependent count) to the LLM
 * for cross-file architectural observations.
 * Fully standalone — produces its own findings, no enrichment of complexity.
 */

import { z } from 'zod';
import type { CodeChunk, ComplexityReport } from '@liendev/parser';
import type {
  ReviewPlugin,
  ReviewContext,
  ReviewFinding,
  ArchitecturalFindingMetadata,
  PresentContext,
} from '../plugin-types.js';
import { extractJSONFromCodeBlock } from '../json-utils.js';
import type { Logger } from '../logger.js';

export const architecturalConfigSchema = z.object({
  mode: z.enum(['auto', 'always', 'off']).default('auto'),
});

/** Compute max architectural notes based on change size. */
function maxNotes(changedFileCount: number): number {
  return Math.min(3 + Math.floor(changedFileCount / 10), 5);
}

/**
 * Architectural note parsed from LLM response.
 */
interface ArchitecturalNote {
  scope: string;
  observation: string;
  evidence: string;
  suggestion: string;
}

/**
 * Architectural review plugin: cross-file analysis via LLM.
 */
export class ArchitecturalPlugin implements ReviewPlugin {
  id = 'architectural';
  name = 'Architectural Review';
  description = 'Cross-file architectural observations powered by LLM';
  requiresLLM = true;
  configSchema = architecturalConfigSchema;
  defaultConfig = { mode: 'auto' };

  shouldActivate(context: ReviewContext): boolean {
    const mode = (context.config.mode as string) ?? 'auto';
    if (mode === 'off') return false;
    if (mode === 'always') return true;

    // "auto" mode: activate on broad or risky changes
    return (
      context.changedFiles.length >= 3 ||
      hasHighRiskFiles(context.complexityReport) ||
      hasExportChanges(context)
    );
  }

  async analyze(context: ReviewContext): Promise<ReviewFinding[]> {
    if (!context.llm) return [];

    const { complexityReport, chunks, changedFiles, logger } = context;

    logger.info('Computing architectural context...');
    const archContext = computeArchContext(chunks, complexityReport, changedFiles, logger);

    // Build prompt
    const limit = maxNotes(changedFiles.length);
    const prompt = buildArchitecturalPrompt(archContext, context, limit);
    const response = await context.llm.complete(prompt, { temperature: 0 });

    // Parse notes from response
    const { summary, notes } = parseArchitecturalNotes(response.content, logger, limit);
    logger.info(`Architectural plugin: ${notes.length} observations`);

    return notes.map((note, i) => {
      const metadata: ArchitecturalFindingMetadata = {
        pluginType: 'architectural',
        scope: note.scope,
        ...(i === 0 && summary ? { summary } : {}),
      };

      const { filepath, line } = resolveScope(note.scope, chunks);

      return {
        pluginId: 'architectural',
        filepath,
        line,
        severity: 'info' as const,
        category: 'architectural',
        message: note.observation,
        suggestion: note.suggestion,
        evidence: note.evidence,
        metadata,
      } satisfies ReviewFinding;
    });
  }

  async present(findings: ReviewFinding[], context: PresentContext): Promise<void> {
    if (findings.length === 0) return;

    const blobBase = context.pr
      ? `https://github.com/${context.pr.owner}/${context.pr.repo}/blob/${context.pr.headSha}`
      : null;

    // Try inline comments for findings with specific lines (symbol-scoped)
    const inlineFindings = findings.filter(f => f.line > 0);
    if (inlineFindings.length > 0 && context.postInlineComments) {
      await context.postInlineComments(inlineFindings, 'Architectural Review');
    }

    // Contribute to unified PR description (alongside summary + complexity)
    context.appendDescription(formatArchDescription(findings, blobBase), 'architectural');

    // Append to check run summary
    const lines = findings
      .map(f => `> **${f.message}**\n> ${f.evidence ?? ''}\n> *${f.suggestion ?? ''}*`)
      .join('\n\n');
    context.appendSummary(`### Architectural observations\n\n${lines}`);
  }
}

/**
 * Resolve a scope string ("filepath" or "filepath::symbolName") to a filepath + line.
 * If the scope includes a symbol, looks it up in chunks to get the start line.
 */
function resolveScope(scope: string, chunks: CodeChunk[]): { filepath: string; line: number } {
  const [rawFilepath, symbolName] = scope.includes('::') ? scope.split('::') : [scope, undefined];

  // Try exact match first, then partial match (LLM sometimes shortens paths)
  const filepath = resolveFilepath(rawFilepath, chunks);

  if (symbolName) {
    const chunk = chunks.find(
      c => c.metadata.file === filepath && c.metadata.symbolName === symbolName,
    );
    if (chunk) return { filepath, line: chunk.metadata.startLine };
  }

  return { filepath, line: 0 };
}

/** Match a filepath against chunks — handles LLM returning shortened paths like "format.ts". */
function resolveFilepath(filepath: string, chunks: CodeChunk[]): string {
  // Exact match
  if (chunks.some(c => c.metadata.file === filepath)) return filepath;

  // Partial match: find a chunk whose path ends with the given filepath
  const match = chunks.find(c => c.metadata.file.endsWith(`/${filepath}`));
  return match ? match.metadata.file : filepath;
}

function scopeLink(filepath: string, line: number, blobBase: string | null): string {
  if (blobBase && line > 0) {
    return `[${filepath}:${line}](${blobBase}/${filepath}#L${line})`;
  }
  if (blobBase) {
    return `[${filepath}](${blobBase}/${filepath})`;
  }
  return `\`${filepath}\``;
}

function formatArchDescription(findings: ReviewFinding[], blobBase: string | null): string {
  const count = findings.length;
  const firstMeta = findings[0]?.metadata as ArchitecturalFindingMetadata | undefined;
  const summary = firstMeta?.summary;
  const summaryText = summary ? ` — ${summary}` : '';
  const rows = findings.map(f => {
    const scope = f.filepath ? scopeLink(f.filepath, f.line, blobBase) : 'General';
    return `| ${scope} | ${f.message} | ${f.suggestion ?? ''} |`;
  });
  const table = `| Scope | Observation | Suggestion |\n|---|---|---|\n${rows.join('\n')}`;
  return `<details>\n<summary>🏗️ <b>Architectural</b> · ${count} observation${count === 1 ? '' : 's'}${summaryText}</summary>\n\n${table}\n\n</details>`;
}

// ---------------------------------------------------------------------------
// Context Assembly
// ---------------------------------------------------------------------------

interface ArchContext {
  code: string;
}

const MAX_TOTAL_CHARS = 50_000;

function computeArchContext(
  chunks: CodeChunk[],
  report: ComplexityReport,
  changedFiles: string[],
  logger: Logger,
): ArchContext {
  // Group chunks by file (only changed files).
  // Exclude method chunks (already present inside their class chunk) and
  // block chunks (comments, separators — low signal for the LLM).
  const changedFilesSet = new Set(changedFiles);
  const chunksByFile = new Map<string, CodeChunk[]>();
  for (const chunk of chunks) {
    const file = chunk.metadata.file;
    if (!changedFilesSet.has(file)) continue;
    if (chunk.metadata.symbolType === 'method') continue;
    if (chunk.metadata.type === 'block' && !chunk.metadata.symbolName) continue;
    const existing = chunksByFile.get(file) ?? [];
    existing.push(chunk);
    chunksByFile.set(file, existing);
  }

  // Sort files by dependentCount descending — highest-impact files first
  const sortedFiles = [...chunksByFile.keys()].sort((a, b) => {
    const depA = report.files[a]?.dependentCount ?? 0;
    const depB = report.files[b]?.dependentCount ?? 0;
    return depB - depA;
  });

  const sections: string[] = [];
  let totalChars = 0;

  for (const file of sortedFiles) {
    const fileChunks = chunksByFile.get(file)!;
    const fileCode = fileChunks.map(c => c.content).join('\n\n');

    // Skip files that don't fit — never truncate
    if (totalChars + fileCode.length > MAX_TOTAL_CHARS) continue;

    const dependentCount = report.files[file]?.dependentCount ?? 0;
    const header =
      dependentCount > 0 ? `### ${file} (${dependentCount} dependents)` : `### ${file}`;
    sections.push(`${header}\n\`\`\`\n${fileCode}\n\`\`\``);
    totalChars += fileCode.length;
  }

  logger.info(`Built code context for ${sections.length} files (${totalChars} chars)`);
  return { code: sections.join('\n\n') };
}

// ---------------------------------------------------------------------------
// Trigger Helpers (from architectural-review.ts)
// ---------------------------------------------------------------------------

function hasHighRiskFiles(report: ComplexityReport): boolean {
  return Object.values(report.files).some(
    f => f.riskLevel === 'high' || f.riskLevel === 'critical',
  );
}

function hasExportChanges(context: ReviewContext): boolean {
  if (!context.baselineReport) return false;

  const currentExports = buildExportsMap(context.chunks);

  for (const [filepath, baseFileData] of Object.entries(context.baselineReport.files)) {
    if (!context.complexityReport.files[filepath]) continue;

    const currentSymbols = new Set(
      context.complexityReport.files[filepath].violations.map(v => v.symbolName),
    );
    const fileExports = currentExports.get(filepath) || new Set();

    for (const sym of baseFileData.violations.map(v => v.symbolName)) {
      if (!currentSymbols.has(sym) && !fileExports.has(sym)) return true;
    }
  }

  return context.chunks.some(
    chunk =>
      chunk.metadata.exports &&
      chunk.metadata.exports.length > 0 &&
      !context.baselineReport!.files[chunk.metadata.file],
  );
}

function buildExportsMap(
  chunks: { metadata: { file: string; exports?: string[] } }[],
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const chunk of chunks) {
    if (!chunk.metadata.exports || chunk.metadata.exports.length === 0) continue;
    const existing = map.get(chunk.metadata.file) || new Set();
    for (const exp of chunk.metadata.exports) existing.add(exp);
    map.set(chunk.metadata.file, existing);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Prompt Building
// ---------------------------------------------------------------------------

function buildArchitecturalPrompt(
  archContext: ArchContext,
  context: ReviewContext,
  limit: number,
): string {
  const body = context.pr?.body ? context.pr.body.slice(0, 2000) : undefined;
  const prHeader = context.pr ? `## PR: ${context.pr.title}${body ? `\n\n${body}` : ''}\n\n` : '';

  return `You are a senior engineer reviewing a pull request for architectural concerns.

${prHeader}## Changed Code

${archContext.code}

## Instructions

Review the changed code for **structural and design** concerns only.

## Good observations (examples)

\`\`\`json
{"scope": "src/handlers/auth.ts::handleLogin", "observation": "Login and registration handlers duplicate the same token generation + cookie setting logic", "evidence": "Lines 45-52 in handleLogin and lines 78-85 in handleRegister are identical", "suggestion": "Extract to a shared createSession() helper"}
\`\`\`

\`\`\`json
{"scope": "src/services/payment.ts", "observation": "PaymentService directly constructs HTTP requests to Stripe instead of using the existing ApiClient", "evidence": "Lines 30-45 use raw fetch() while ApiClient is available and used everywhere else", "suggestion": "Use ApiClient.post() for consistency and centralized error handling"}
\`\`\`

\`\`\`json
{"scope": "src/utils/format.ts::formatDate", "observation": "Three files each implement their own date formatting with slightly different logic", "evidence": "format.ts:12, dashboard.ts:45, report.ts:78 all format dates differently", "suggestion": "Consolidate into formatDate() and import it"}
\`\`\`

## What to look for

- **DRY violations**: duplicated logic across functions/files
- **Single Responsibility**: functions doing too many unrelated things
- **Coupling issues**: tight coupling between modules
- **Missing abstractions**: repeated patterns that should be shared
- **KISS violations**: over-engineered solutions

## Out of scope (handled by other plugins)

- Breaking changes, caller compatibility, null safety, type mismatches
- Complexity metrics and thresholds
- Style, naming, formatting

## Response Format

ONLY valid JSON:

\`\`\`json
{
  "summary": "One sentence summarizing all architectural concerns (max 20 words)",
  "architectural_notes": [
    {
      "scope": "filepath or filepath::symbolName",
      "observation": "1 sentence — what the structural issue is",
      "evidence": "specific lines/files proving it exists",
      "suggestion": "concrete action to fix it"
    }
  ]
}
\`\`\`

Rules:
- **summary**: a single sentence covering all observations. Good: "Truncation logic duplicated across 3 files — consolidate into format.ts". Bad: "There are some issues"
- Every observation must cite specific lines or files as evidence
- Maximum ${limit} notes — only flag issues worth fixing
- If no structural issues found, return \`{ "summary": "", "architectural_notes": [] }\``;
}

// ---------------------------------------------------------------------------
// Response Parsing
// ---------------------------------------------------------------------------

function isValidArchNote(note: unknown): note is ArchitecturalNote {
  if (!note || typeof note !== 'object') return false;
  const n = note as Record<string, unknown>;
  return (
    typeof n.scope === 'string' &&
    typeof n.observation === 'string' &&
    typeof n.evidence === 'string' &&
    typeof n.suggestion === 'string'
  );
}

interface ArchParseResult {
  summary: string;
  notes: ArchitecturalNote[];
}

function parseArchitecturalNotes(content: string, logger: Logger, limit: number): ArchParseResult {
  const jsonStr = extractJSONFromCodeBlock(content);

  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.architectural_notes)) {
      const notes = parsed.architectural_notes.filter(isValidArchNote).slice(0, limit);
      logger.info(`Parsed ${notes.length} architectural notes`);
      return { summary: typeof parsed.summary === 'string' ? parsed.summary : '', notes };
    }
  } catch {
    // Fall through to retry
  }

  // Aggressive retry
  const objectMatch = content.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      if (parsed && Array.isArray(parsed.architectural_notes)) {
        const notes = parsed.architectural_notes.filter(isValidArchNote).slice(0, limit);
        logger.info(`Recovered ${notes.length} architectural notes with retry`);
        return { summary: typeof parsed.summary === 'string' ? parsed.summary : '', notes };
      }
    } catch {
      // Total failure
    }
  }

  logger.warning('Failed to parse architectural review response');
  return { summary: '', notes: [] };
}
