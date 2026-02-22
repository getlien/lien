/**
 * Architectural review plugin.
 *
 * Computes codebase fingerprint, dependent context, and simplicity signals.
 * Uses LLM to generate cross-file architectural observations.
 * Fully standalone — produces its own findings, no enrichment of complexity.
 * Inlined from architectural-review.ts.
 */

import { z } from 'zod';
import type { CodeChunk, ComplexityReport } from '@liendev/parser';
import type {
  ReviewPlugin,
  ReviewContext,
  ReviewFinding,
  ArchitecturalFindingMetadata,
  AnalysisResult,
} from '../plugin-types.js';
import { computeFingerprint, serializeFingerprint } from '../fingerprint.js';
import { assembleDependentContext } from '../dependent-context.js';
import { computeSimplicitySignals, serializeSimplicitySignals } from '../simplicity-signals.js';
import { parseJSONResponse } from '../llm-client.js';

export const architecturalConfigSchema = z.object({
  mode: z.enum(['auto', 'always', 'off']).default('auto'),
});

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

    // Compute architectural context
    logger.info('Computing architectural context...');
    const archContext = computeArchContext(chunks, complexityReport, changedFiles, logger);

    // Build prompt
    const prompt = buildArchitecturalPrompt(archContext, context);
    const response = await context.llm.complete(prompt);

    // Parse notes from response
    const notes = parseArchitecturalNotes(response.content, logger);
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
}

// ---------------------------------------------------------------------------
// Context Assembly (from architectural-review.ts)
// ---------------------------------------------------------------------------

interface ArchContext {
  fingerprint: string;
  dependentSnippets: Map<string, string>;
  simplicitySignals: string;
}

function computeArchContext(
  chunks: CodeChunk[],
  report: ComplexityReport,
  changedFiles: string[],
  logger: Logger,
): ArchContext {
  const fingerprint = computeFingerprint(chunks);
  const fingerprintText = serializeFingerprint(fingerprint);
  logger.info(`Computed codebase fingerprint: ${fingerprint.paradigm.dominantStyle} paradigm`);

  const dependentSnippets = assembleDependentContext(report, chunks);
  logger.info(`Assembled dependent context for ${dependentSnippets.size} functions`);

  const signals = computeSimplicitySignals(chunks, changedFiles);
  const simplicitySignals = serializeSimplicitySignals(signals);
  if (signals.length > 0) {
    const flaggedCount = signals.filter(s => s.flagged).length;
    logger.info(
      `Computed simplicity signals for ${signals.length} files (${flaggedCount} flagged)`,
    );
  }

  return { fingerprint: fingerprintText, dependentSnippets, simplicitySignals };
}

// We need Logger type
import type { Logger } from '../logger.js';

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

function buildArchitecturalPrompt(archContext: ArchContext, context: ReviewContext): string {
  const filesList = context.changedFiles.map(f => `- ${f}`).join('\n');

  return `You are a senior engineer reviewing code for architectural coherence.

${archContext.fingerprint}
${archContext.simplicitySignals}

## Changed Files
${filesList}

## Instructions

Review the codebase fingerprint and changed files for architectural concerns:

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
- Maximum 3 notes per review — quality over quantity
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

function parseArchitecturalNotes(content: string, logger: Logger): ArchitecturalNote[] {
  // Try to parse as JSON with architectural_notes key
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*)```/);
  const jsonStr = (codeBlockMatch ? codeBlockMatch[1] : content).trim();

  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.architectural_notes)) {
      const notes = parsed.architectural_notes.filter(isValidArchNote).slice(0, 3);
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
        const notes = parsed.architectural_notes.filter(isValidArchNote).slice(0, 3);
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
