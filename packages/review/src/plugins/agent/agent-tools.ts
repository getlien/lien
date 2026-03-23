/**
 * Agent tool implementations.
 *
 * Each function takes parsed input and an AgentToolContext, queries the
 * codebase using VectorDB, EmbeddingService, or the filesystem, and
 * returns a JSON string for the agent.
 */

import fs from 'fs/promises';
import path from 'path';

import { analyzeComplexityFromChunks } from '@liendev/parser';

import type { AgentToolContext } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_SEARCH_LIMIT = 20;
const DEFAULT_SEARCH_LIMIT = 5;
const MAX_FILES_CONTEXT = 20;
const MAX_FUNCTIONS_LIMIT = 100;
const DEFAULT_FUNCTIONS_LIMIT = 30;
const DEFAULT_COMPLEXITY_TOP = 10;
const MAX_READ_LINES = 500;
const CONTENT_TRUNCATE_LENGTH = 1500;

// ---------------------------------------------------------------------------
// semantic_search
// ---------------------------------------------------------------------------

export async function semanticSearch(
  input: Record<string, unknown>,
  ctx: AgentToolContext,
): Promise<string> {
  try {
    const query = input.query as string;
    if (!query) return JSON.stringify({ error: 'query is required' });

    const limit = Math.min(
      Math.max((input.limit as number) || DEFAULT_SEARCH_LIMIT, 1),
      MAX_SEARCH_LIMIT,
    );

    const embedding = await ctx.embeddings.embed(query);
    const results = await ctx.vectorDB.search(embedding, limit, query);

    const shaped = results.map(r => ({
      file: r.metadata.file,
      symbolName: r.metadata.symbolName ?? null,
      symbolType: r.metadata.symbolType ?? null,
      content:
        r.content.length > CONTENT_TRUNCATE_LENGTH
          ? r.content.slice(0, CONTENT_TRUNCATE_LENGTH) + '...'
          : r.content,
      score: Math.round(r.score * 1000) / 1000,
      startLine: r.metadata.startLine,
      endLine: r.metadata.endLine,
    }));

    return JSON.stringify({ results: shaped, count: shaped.length });
  } catch (err) {
    return JSON.stringify({ error: `semantic_search failed: ${(err as Error).message}` });
  }
}

// ---------------------------------------------------------------------------
// get_files_context
// ---------------------------------------------------------------------------

export async function getFilesContext(
  input: Record<string, unknown>,
  ctx: AgentToolContext,
): Promise<string> {
  try {
    const raw = input.filepaths;
    const filepaths = Array.isArray(raw) ? (raw as string[]) : [raw as string];

    if (filepaths.length === 0) return JSON.stringify({ error: 'filepaths is required' });
    if (filepaths.length > MAX_FILES_CONTEXT) {
      return JSON.stringify({ error: `Too many files (max ${MAX_FILES_CONTEXT})` });
    }

    const fileResults: Record<string, unknown[]> = {};

    for (const filepath of filepaths) {
      const chunks = await ctx.vectorDB.scanWithFilter({ file: filepath });
      fileResults[filepath] = chunks.map(r => ({
        symbolName: r.metadata.symbolName ?? null,
        symbolType: r.metadata.symbolType ?? null,
        signature: r.metadata.signature ?? null,
        startLine: r.metadata.startLine,
        endLine: r.metadata.endLine,
        imports: r.metadata.imports ?? [],
        exports: r.metadata.exports ?? [],
        callSites: r.metadata.callSites ?? [],
        parameters: r.metadata.parameters ?? [],
        returnType: r.metadata.returnType ?? null,
        complexity: r.metadata.complexity ?? null,
        cognitiveComplexity: r.metadata.cognitiveComplexity ?? null,
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

export async function getDependents(
  input: Record<string, unknown>,
  ctx: AgentToolContext,
): Promise<string> {
  try {
    const filepath = input.filepath as string;
    if (!filepath) return JSON.stringify({ error: 'filepath is required' });

    const symbol = input.symbol as string | undefined;

    if (symbol) {
      // Find callers for a specific symbol
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

export async function listFunctions(
  input: Record<string, unknown>,
  ctx: AgentToolContext,
): Promise<string> {
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

    const results = await ctx.vectorDB.querySymbols({ pattern, symbolType, language, limit });

    const shaped = results.map(r => ({
      symbolName: r.metadata.symbolName ?? null,
      symbolType: r.metadata.symbolType ?? null,
      filepath: r.metadata.file,
      startLine: r.metadata.startLine,
      signature: r.metadata.signature ?? null,
      language: r.metadata.language,
    }));

    return JSON.stringify({ results: shaped, count: shaped.length });
  } catch (err) {
    return JSON.stringify({ error: `list_functions failed: ${(err as Error).message}` });
  }
}

// ---------------------------------------------------------------------------
// get_complexity
// ---------------------------------------------------------------------------

export async function getComplexity(
  input: Record<string, unknown>,
  ctx: AgentToolContext,
): Promise<string> {
  try {
    const files = input.files as string[] | undefined;
    const top = Math.max((input.top as number) || DEFAULT_COMPLEXITY_TOP, 1);

    const report = analyzeComplexityFromChunks(ctx.repoChunks, files);

    // Collect all violations across files, sorted by severity then complexity
    const allViolations = Object.values(report.files)
      .flatMap(f => f.violations)
      .sort((a, b) => {
        // Errors first, then by complexity descending
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
// read_file
// ---------------------------------------------------------------------------

export async function readFile(
  input: Record<string, unknown>,
  ctx: AgentToolContext,
): Promise<string> {
  try {
    const filepath = input.filepath as string;
    if (!filepath) return JSON.stringify({ error: 'filepath is required' });

    // Path traversal prevention
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

    // Cap at MAX_READ_LINES
    const effectiveEnd = Math.min(endLine, startLine + MAX_READ_LINES - 1);

    // Lines are 1-based in the API, 0-based in the array
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
