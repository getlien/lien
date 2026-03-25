/**
 * Agent tool implementations backed by in-memory CodeChunk[] arrays.
 *
 * No VectorDB or embeddings required — all tools work from the repoChunks
 * that the engine already produces via performChunkOnlyIndex().
 */

import fs from 'fs/promises';
import path from 'path';

import { analyzeComplexityFromChunks } from '@liendev/parser';

import type { AgentToolContext } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILES_CONTEXT = 20;
const MAX_FUNCTIONS_LIMIT = 100;
const DEFAULT_FUNCTIONS_LIMIT = 30;
const DEFAULT_COMPLEXITY_TOP = 10;
const MAX_READ_LINES = 500;

// ---------------------------------------------------------------------------
// get_files_context
// ---------------------------------------------------------------------------

export function getFilesContext(input: Record<string, unknown>, ctx: AgentToolContext): string {
  try {
    const raw = input.filepaths;
    const filepaths = Array.isArray(raw) ? (raw as string[]) : [raw as string];

    if (filepaths.length === 0) return JSON.stringify({ error: 'filepaths is required' });
    if (filepaths.length > MAX_FILES_CONTEXT) {
      return JSON.stringify({ error: `Too many files (max ${MAX_FILES_CONTEXT})` });
    }

    const fileResults: Record<string, unknown[]> = {};

    for (const filepath of filepaths) {
      const chunks = ctx.repoChunks.filter(c => c.metadata.file === filepath);
      fileResults[filepath] = chunks.map(c => ({
        symbolName: c.metadata.symbolName ?? null,
        symbolType: c.metadata.symbolType ?? null,
        signature: c.metadata.signature ?? null,
        startLine: c.metadata.startLine,
        endLine: c.metadata.endLine,
        imports: c.metadata.imports ?? [],
        exports: c.metadata.exports ?? [],
        callSites: c.metadata.callSites ?? [],
        parameters: c.metadata.parameters ?? [],
        returnType: c.metadata.returnType ?? null,
        complexity: c.metadata.complexity ?? null,
        cognitiveComplexity: c.metadata.cognitiveComplexity ?? null,
      }));
    }

    return JSON.stringify({ files: fileResults });
  } catch (err) {
    return JSON.stringify({ error: `get_files_context failed: ${(err as Error).message}` });
  }
}

// ---------------------------------------------------------------------------
// get_dependents
// ---------------------------------------------------------------------------

export function getDependents(input: Record<string, unknown>, ctx: AgentToolContext): string {
  try {
    const filepath = input.filepath as string;
    if (!filepath) return JSON.stringify({ error: 'filepath is required' });

    const symbol = input.symbol as string | undefined;

    if (symbol) {
      const callers = ctx.graph.getCallers(filepath, symbol);
      const riskLevel = getRiskLevel(callers.length);

      return JSON.stringify({
        filepath,
        symbol,
        dependentCount: callers.length,
        riskLevel,
        callers: callers.map(c => ({
          filepath: c.caller.filepath,
          symbolName: c.caller.symbolName,
          callSiteLine: c.callSiteLine,
        })),
      });
    }

    // No specific symbol — find callers for all exports from this file
    const fileChunks = ctx.repoChunks.filter(c => c.metadata.file === filepath);
    const exportedSymbols = new Set<string>();
    for (const chunk of fileChunks) {
      if (chunk.metadata.exports) {
        for (const exp of chunk.metadata.exports) {
          exportedSymbols.add(exp);
        }
      }
    }

    const allCallers: Array<{
      symbol: string;
      filepath: string;
      symbolName: string;
      callSiteLine: number;
    }> = [];

    for (const sym of exportedSymbols) {
      const callers = ctx.graph.getCallers(filepath, sym);
      for (const c of callers) {
        allCallers.push({
          symbol: sym,
          filepath: c.caller.filepath,
          symbolName: c.caller.symbolName,
          callSiteLine: c.callSiteLine,
        });
      }
    }

    const riskLevel = getRiskLevel(allCallers.length);

    return JSON.stringify({
      filepath,
      dependentCount: allCallers.length,
      riskLevel,
      callers: allCallers,
    });
  } catch (err) {
    return JSON.stringify({ error: `get_dependents failed: ${(err as Error).message}` });
  }
}

function getRiskLevel(count: number): 'low' | 'medium' | 'high' | 'critical' {
  if (count >= 20) return 'critical';
  if (count >= 10) return 'high';
  if (count >= 5) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// list_functions
// ---------------------------------------------------------------------------

export function listFunctions(input: Record<string, unknown>, ctx: AgentToolContext): string {
  try {
    const pattern = input.pattern as string | undefined;
    const symbolType = input.symbolType as
      | 'function'
      | 'method'
      | 'class'
      | 'interface'
      | undefined;
    const language = input.language as string | undefined;
    const limit = Math.min(
      Math.max((input.limit as number) || DEFAULT_FUNCTIONS_LIMIT, 1),
      MAX_FUNCTIONS_LIMIT,
    );

    let results = ctx.repoChunks.filter(c => !!c.metadata.symbolName);

    if (symbolType) {
      results = results.filter(c => c.metadata.symbolType === symbolType);
    }
    if (language) {
      results = results.filter(c => c.metadata.language === language);
    }
    if (pattern) {
      const regex = new RegExp(pattern, 'i');
      results = results.filter(c => regex.test(c.metadata.symbolName!));
    }

    const shaped = results.slice(0, limit).map(c => ({
      symbolName: c.metadata.symbolName,
      symbolType: c.metadata.symbolType ?? null,
      filepath: c.metadata.file,
      startLine: c.metadata.startLine,
      signature: c.metadata.signature ?? null,
      language: c.metadata.language,
    }));

    return JSON.stringify({ results: shaped, count: shaped.length });
  } catch (err) {
    return JSON.stringify({ error: `list_functions failed: ${(err as Error).message}` });
  }
}

// ---------------------------------------------------------------------------
// get_complexity
// ---------------------------------------------------------------------------

export function getComplexity(input: Record<string, unknown>, ctx: AgentToolContext): string {
  try {
    const files = input.files as string[] | undefined;
    const top = Math.max((input.top as number) || DEFAULT_COMPLEXITY_TOP, 1);

    const report = analyzeComplexityFromChunks(ctx.repoChunks, files);

    const allViolations = Object.values(report.files)
      .flatMap(f => f.violations)
      .sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
        return b.complexity - a.complexity;
      })
      .slice(0, top);

    const shaped = allViolations.map(v => ({
      filepath: v.filepath,
      symbolName: v.symbolName,
      symbolType: v.symbolType,
      startLine: v.startLine,
      endLine: v.endLine,
      metricType: v.metricType,
      complexity: v.complexity,
      threshold: v.threshold,
      severity: v.severity,
      message: v.message,
    }));

    return JSON.stringify({
      summary: report.summary,
      violations: shaped,
      count: shaped.length,
    });
  } catch (err) {
    return JSON.stringify({ error: `get_complexity failed: ${(err as Error).message}` });
  }
}

// ---------------------------------------------------------------------------
// grep_codebase
// ---------------------------------------------------------------------------

const MAX_GREP_RESULTS = 30;

export function grepCodebase(input: Record<string, unknown>, ctx: AgentToolContext): string {
  try {
    const pattern = input.pattern as string;
    if (!pattern) return JSON.stringify({ error: 'pattern is required' });

    const regex = new RegExp(pattern, 'i');
    const matches: Array<{ filepath: string; line: number; match: string }> = [];

    for (const chunk of ctx.repoChunks) {
      const lines = chunk.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          matches.push({
            filepath: chunk.metadata.file,
            line: chunk.metadata.startLine + i,
            match: lines[i].trim().slice(0, 200),
          });
          if (matches.length >= MAX_GREP_RESULTS) break;
        }
      }
      if (matches.length >= MAX_GREP_RESULTS) break;
    }

    return JSON.stringify({
      results: matches,
      count: matches.length,
      truncated: matches.length >= MAX_GREP_RESULTS,
    });
  } catch (err) {
    return JSON.stringify({ error: `grep_codebase failed: ${(err as Error).message}` });
  }
}

// ---------------------------------------------------------------------------
// read_file
// ---------------------------------------------------------------------------

export async function readFile(
  input: Record<string, unknown>,
  ctx: AgentToolContext,
): Promise<string> {
  try {
    const filepath = input.filepath as string;
    if (!filepath) return JSON.stringify({ error: 'filepath is required' });

    if (filepath.includes('..')) {
      return JSON.stringify({ error: 'Path traversal not allowed' });
    }
    if (path.isAbsolute(filepath)) {
      return JSON.stringify({
        error: 'Absolute paths not allowed — use relative paths from repo root',
      });
    }

    const resolved = path.resolve(ctx.repoRootDir, filepath);
    if (!resolved.startsWith(ctx.repoRootDir)) {
      return JSON.stringify({ error: 'Path traversal not allowed' });
    }

    const raw = await fs.readFile(resolved, 'utf-8');
    const lines = raw.split('\n');

    const startLine = Math.max((input.startLine as number) || 1, 1);
    const endLine = Math.min(
      (input.endLine as number) || startLine + MAX_READ_LINES - 1,
      lines.length,
    );

    const effectiveEnd = Math.min(endLine, startLine + MAX_READ_LINES - 1);
    const slice = lines.slice(startLine - 1, effectiveEnd);
    const numbered = slice.map((line, i) => `${startLine + i}: ${line}`).join('\n');

    return JSON.stringify({
      filepath,
      startLine,
      endLine: effectiveEnd,
      totalLines: lines.length,
      content: numbered,
    });
  } catch (err) {
    const message =
      (err as NodeJS.ErrnoException).code === 'ENOENT'
        ? `File not found: ${input.filepath}`
        : `read_file failed: ${(err as Error).message}`;
    return JSON.stringify({ error: message });
  }
}
