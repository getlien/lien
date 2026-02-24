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
import { extractJSONFromCodeBlock } from '../llm-client.js';
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

    // Prefer the raw PR diff; fall back to chunk-based code (CLI mode)
    logger.info('Computing architectural context...');
    const archContext = context.diff
      ? buildDiffContext(context.diff, logger)
      : computeArchContext(chunks, complexityReport, changedFiles, logger);

    // Build prompt
    const limit = maxNotes(changedFiles.length);
    const prompt = buildArchitecturalPrompt(archContext, context, limit);
    const response = await context.llm.complete(prompt);

    // Parse notes from response
    const notes = parseArchitecturalNotes(response.content, logger, limit);
    logger.info(`Architectural plugin: ${notes.length} observations`);

    return notes.map(note => {
      const metadata: ArchitecturalFindingMetadata = {
        pluginType: 'architectural',
        scope: note.scope,
      };

      return {
        pluginId: 'architectural',
        filepath: note.scope.includes('::') ? note.scope.split('::')[0] : note.scope,
        line: 0,
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
    const archFindings = findings.filter(f => f.pluginId === 'architectural');
    if (archFindings.length === 0) return;

    const lines = archFindings
      .map(f => `> **${f.message}**\n> ${f.evidence ?? ''}\n> *Suggestion: ${f.suggestion ?? ''}*`)
      .join('\n\n');
    context.appendSummary(`### Architectural observations\n\n${lines}`);
  }
}

// ---------------------------------------------------------------------------
// Context Assembly
// ---------------------------------------------------------------------------

interface ArchContext {
  code: string;
  /** 'diff' when built from the raw PR diff, 'chunks' when built from AST chunks (CLI fallback) */
  source: 'diff' | 'chunks';
}

const MAX_TOTAL_CHARS = 50_000;

/**
 * Build context from the raw unified diff (GitHub App mode).
 * Truncates at MAX_TOTAL_CHARS — the diff is already focused on what changed.
 */
function buildDiffContext(diff: string, logger: Logger): ArchContext {
  const code = diff.length > MAX_TOTAL_CHARS ? diff.slice(0, MAX_TOTAL_CHARS) : diff;
  logger.info(`Using PR diff as architectural context (${code.length} chars)`);
  return { code, source: 'diff' };
}

function computeArchContext(
  chunks: CodeChunk[],
  report: ComplexityReport,
  changedFiles: string[],
  logger: Logger,
): ArchContext {
  // Group chunks by file (only changed files)
  const chunksByFile = new Map<string, CodeChunk[]>();
  for (const chunk of chunks) {
    const file = chunk.metadata.file;
    if (!changedFiles.includes(file)) continue;
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
  return { code: sections.join('\n\n'), source: 'chunks' as const };
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
  const sectionTitle = archContext.source === 'diff' ? 'PR Diff' : 'Changed Code';

  return `You are a senior engineer reviewing a pull request for architectural concerns.

## ${sectionTitle}

${archContext.code}

## Instructions

Review the ${archContext.source === 'diff' ? 'diff' : 'changed code'} for architectural concerns:

- **DRY violations**: duplicated logic across functions/files
- **Single Responsibility**: functions doing too many unrelated things
- **Coupling issues**: tight coupling between modules
- **Missing abstractions**: repeated patterns that should be shared
- **KISS violations**: over-engineered solutions
- **Cross-file coherence**: pattern conflicts, naming convention violations

Do NOT flag:
- Minor style variations
- Metric values (those are covered by complexity review)
- Intentional deviations (test utilities, generated code)

## Response Format

Respond with ONLY valid JSON:

\`\`\`json
{
  "architectural_notes": [
    {
      "scope": "filepath or filepath::symbolName",
      "observation": "1 sentence describing the issue",
      "evidence": "specific file/line/metric backing it",
      "suggestion": "what to do about it"
    }
  ]
}
\`\`\`

Rules:
- ONLY include notes backed by specific evidence
- Maximum ${limit} notes per review — quality over quantity
- If no architectural issues found, return an empty array`;
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

function parseArchitecturalNotes(
  content: string,
  logger: Logger,
  limit: number,
): ArchitecturalNote[] {
  // Try to parse as JSON with architectural_notes key
  const jsonStr = extractJSONFromCodeBlock(content);

  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.architectural_notes)) {
      const notes = parsed.architectural_notes.filter(isValidArchNote).slice(0, limit);
      logger.info(`Parsed ${notes.length} architectural notes`);
      return notes;
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
        return notes;
      }
    } catch {
      // Total failure
    }
  }

  logger.warning('Failed to parse architectural review response');
  return [];
}
