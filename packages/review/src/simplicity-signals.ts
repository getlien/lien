/**
 * Per-file simplicity signals for KISS violation detection.
 *
 * Computes structural metrics (class count, avg method complexity/lines) per file
 * so the LLM can detect over-abstraction even when no single function exceeds
 * a complexity threshold.
 */

import type { CodeChunk } from '@liendev/core';

export interface FileSimplicitySignal {
  file: string;
  classCount: number;
  functionCount: number;
  methodCount: number;
  avgMethodComplexity: number;
  maxMethodComplexity: number;
  avgMethodLines: number;
  flagged: boolean;
  reason: string;
}

/**
 * Group chunks by file path (same pattern as fingerprint.ts).
 */
function groupChunksByFile(chunks: CodeChunk[]): Map<string, CodeChunk[]> {
  const map = new Map<string, CodeChunk[]>();
  for (const chunk of chunks) {
    const existing = map.get(chunk.metadata.file);
    if (existing) existing.push(chunk);
    else map.set(chunk.metadata.file, [chunk]);
  }
  return map;
}

/**
 * Compute per-file simplicity signals from indexed chunks.
 * Only returns signals for files with classCount >= 2 or flagged === true.
 * Only processes files present in filesToAnalyze.
 */
export function computeSimplicitySignals(
  chunks: CodeChunk[],
  filesToAnalyze: string[],
): FileSimplicitySignal[] {
  if (chunks.length === 0) return [];

  const analyzeSet = new Set(filesToAnalyze);
  const byFile = groupChunksByFile(chunks);
  const signals: FileSimplicitySignal[] = [];

  for (const [file, fileChunks] of byFile) {
    if (!analyzeSet.has(file)) continue;

    let classCount = 0;
    let functionCount = 0;
    const methodComplexities: number[] = [];
    const methodLineCounts: number[] = [];

    for (const chunk of fileChunks) {
      const st = chunk.metadata.symbolType;
      if (st === 'class' || st === 'interface') {
        classCount++;
      } else if (st === 'function') {
        functionCount++;
      } else if (st === 'method') {
        const complexity = chunk.metadata.complexity ?? 1;
        const lines = chunk.metadata.endLine - chunk.metadata.startLine + 1;
        methodComplexities.push(complexity);
        methodLineCounts.push(lines);
      }
    }

    const methodCount = methodComplexities.length;
    const avgMethodComplexity =
      methodCount > 0 ? methodComplexities.reduce((a, b) => a + b, 0) / methodCount : 0;
    const maxMethodComplexity = methodCount > 0 ? Math.max(...methodComplexities) : 0;
    const avgMethodLines =
      methodCount > 0 ? methodLineCounts.reduce((a, b) => a + b, 0) / methodCount : 0;

    const flagged = classCount >= 3 && avgMethodComplexity <= 2 && avgMethodLines <= 5;
    const reason = flagged
      ? `${classCount} classes with avg method complexity ${avgMethodComplexity.toFixed(1)} and avg ${Math.round(avgMethodLines)} lines — possible over-abstraction`
      : '';

    if (classCount >= 2 || flagged) {
      signals.push({
        file,
        classCount,
        functionCount,
        methodCount,
        avgMethodComplexity,
        maxMethodComplexity,
        avgMethodLines,
        flagged,
        reason,
      });
    }
  }

  return signals;
}

/**
 * Serialize simplicity signals to markdown for prompt injection.
 * Returns empty string when there are no signals.
 */
export function serializeSimplicitySignals(signals: FileSimplicitySignal[]): string {
  if (signals.length === 0) return '';

  const lines: string[] = ['## File Structure Signals'];

  for (const s of signals) {
    const basename = s.file.split('/').pop() || s.file;
    const stats = `${s.classCount} classes, ${s.functionCount} functions, ${s.methodCount} methods | avg method complexity: ${s.avgMethodComplexity.toFixed(1)}, avg lines: ${Math.round(s.avgMethodLines)}`;
    lines.push(`\n**${basename}**: ${stats}`);
    if (s.flagged) {
      lines.push(`  ⚠️ ${s.reason}`);
    }
  }

  return lines.join('\n');
}
