import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { FindSimilarSchema } from '../schemas/index.js';
import { shapeResults, deduplicateResults } from '../utils/metadata-shaper.js';
import type { ToolContext, MCPToolResult } from '../types.js';
import type { SearchResult } from '@liendev/core';
import { SYMBOL_SEARCH_COLUMNS } from './columns.js';

interface FiltersApplied {
  language?: string;
  pathHint?: string;
  prunedLowRelevance: number;
}

/**
 * Filter results by programming language (case-insensitive).
 */
function applyLanguageFilter(results: SearchResult[], language: string): SearchResult[] {
  const lang = language.toLowerCase();
  return results.filter(r => r.metadata.language?.toLowerCase() === lang);
}

/**
 * Filter results by file path substring (case-insensitive).
 */
function applyPathHintFilter(results: SearchResult[], pathHint: string): SearchResult[] {
  const hint = pathHint.toLowerCase();
  return results.filter(r => (r.metadata.file?.toLowerCase() ?? '').includes(hint));
}

/**
 * Remove low-relevance results (relevance === 'not_relevant').
 */
function pruneIrrelevantResults(results: SearchResult[]): {
  filtered: SearchResult[];
  prunedCount: number;
} {
  const beforePrune = results.length;
  const filtered = results.filter(r => r.relevance !== 'not_relevant');
  return { filtered, prunedCount: beforePrune - filtered.length };
}

/**
 * Handle find_similar tool calls.
 *
 * Finds code similar to a given snippet via lexical full-text (FTS5/BM25)
 * matching on the snippet's tokens. The `queryVector` argument to
 * `vectorDB.search` is vestigial (SqliteBackend matches the code text and
 * ignores the vector), so an empty Float32Array is passed.
 */
export async function handleFindSimilar(args: unknown, ctx: ToolContext): Promise<MCPToolResult> {
  const { vectorDB, log, checkAndReconnect, getIndexMetadata } = ctx;

  return await wrapToolHandler(FindSimilarSchema, async validatedArgs => {
    log(`Finding similar code...`);
    await checkAndReconnect();

    const limit = validatedArgs.limit ?? 5;
    const extraLimit = limit + 10;
    let results = await vectorDB.search(new Float32Array(0), extraLimit, validatedArgs.code, {
      columns: SYMBOL_SEARCH_COLUMNS,
    });

    // Deduplicate and filter out self-matches
    results = deduplicateResults(results);
    const inputCode = validatedArgs.code.trim();
    results = results.filter(r => {
      if (r.score >= 0.1) return true;
      return r.content.trim() !== inputCode;
    });

    const filtersApplied: FiltersApplied = { prunedLowRelevance: 0 };

    // Apply filters sequentially
    if (validatedArgs.language) {
      filtersApplied.language = validatedArgs.language;
      results = applyLanguageFilter(results, validatedArgs.language);
    }

    if (validatedArgs.pathHint) {
      filtersApplied.pathHint = validatedArgs.pathHint;
      results = applyPathHintFilter(results, validatedArgs.pathHint);
    }

    const { filtered, prunedCount } = pruneIrrelevantResults(results);
    filtersApplied.prunedLowRelevance = prunedCount;

    const finalResults = filtered.slice(0, limit);
    log(`Found ${finalResults.length} similar chunks`);

    const hasFilters =
      filtersApplied.language || filtersApplied.pathHint || filtersApplied.prunedLowRelevance > 0;

    return {
      indexInfo: getIndexMetadata(),
      results: shapeResults(finalResults, 'find_similar'),
      ...(hasFilters && { filtersApplied }),
      ...(finalResults.length === 0 && {
        note: '0 results. Ensure the code snippet is at least 24 characters and representative of the pattern. Try grep for exact string matches.',
      }),
    };
  })(args);
}
