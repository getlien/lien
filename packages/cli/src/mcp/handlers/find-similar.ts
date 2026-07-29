import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { FindSimilarSchema } from '../schemas/index.js';
import { shapeResults, deduplicateResults } from '../utils/metadata-shaper.js';
import type { ToolContext, MCPToolResult } from '../types.js';
import type { SearchResult, VectorDBInterface } from '@liendev/core';

interface FiltersApplied {
  language?: string;
  pathHint?: string;
  prunedLowRelevance: number;
}

/**
 * Fetch similarity candidates, over-fetching by one row beyond the existing
 * `extraLimit` headroom so we can tell — for free — whether the underlying
 * FTS match set extends beyond what was fetched.
 *
 * We deliberately do NOT run a separate COUNT query for an exact total: the
 * dedup/self-match/language/pathHint/relevance-pruning filters run in JS
 * *after* this fetch, so even a precise FTS match count wouldn't equal "the
 * number of results this tool would actually return" — getting that would
 * mean dropping the SQL-side LIMIT entirely (a real added cost on a large
 * repo for a common term), for a number that's still not the true total.
 * The extra row is trimmed back off immediately so normal result selection
 * downstream is unaffected — this only adds the `fetchWindowExhausted` signal.
 */
async function fetchCandidates(
  vectorDB: VectorDBInterface,
  code: string,
  extraLimit: number,
): Promise<{ results: SearchResult[]; fetchWindowExhausted: boolean }> {
  const rawResults = await vectorDB.search(code, extraLimit + 1);
  return {
    results: rawResults.slice(0, extraLimit),
    fetchWindowExhausted: rawResults.length <= extraLimit,
  };
}

/**
 * Build the diagnostic note, if any. Never states a specific total — only
 * what's actually known (empty, or capped with more possibly available).
 */
function buildNote(finalCount: number, hasMore: boolean): string | undefined {
  if (finalCount === 0) {
    return '0 results. Ensure the code snippet is at least 24 characters and representative of the pattern. Try grep for exact string matches.';
  }
  if (hasMore) {
    return "More similar matches may exist beyond this page — find_similar doesn't paginate. Raise limit (max 20) or narrow with language/pathHint.";
  }
  return undefined;
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

/** Drop the input snippet's own chunk from results (exact-content self-match). */
function excludeSelfMatch(results: SearchResult[], code: string): SearchResult[] {
  const inputCode = code.trim();
  return results.filter(r => r.score >= 0.1 || r.content.trim() !== inputCode);
}

/**
 * Apply language/pathHint filters and prune low-relevance results,
 * tracking which filters actually ran for the filtersApplied diagnostic.
 */
function applyFilters(
  results: SearchResult[],
  language: string | undefined,
  pathHint: string | undefined,
): { filtered: SearchResult[]; filtersApplied: FiltersApplied } {
  let filtered = results;
  const filtersApplied: FiltersApplied = { prunedLowRelevance: 0 };

  if (language) {
    filtersApplied.language = language;
    filtered = applyLanguageFilter(filtered, language);
  }
  if (pathHint) {
    filtersApplied.pathHint = pathHint;
    filtered = applyPathHintFilter(filtered, pathHint);
  }

  const pruned = pruneIrrelevantResults(filtered);
  filtersApplied.prunedLowRelevance = pruned.prunedCount;

  return { filtered: pruned.filtered, filtersApplied };
}

/**
 * Handle find_similar tool calls.
 *
 * Finds code similar to a given snippet via lexical full-text (FTS5/BM25)
 * matching on the snippet's tokens.
 */
export async function handleFindSimilar(args: unknown, ctx: ToolContext): Promise<MCPToolResult> {
  const { vectorDB, log, checkAndReconnect, getIndexMetadata } = ctx;

  return await wrapToolHandler(FindSimilarSchema, async validatedArgs => {
    log(`Finding similar code...`);
    await checkAndReconnect();

    const limit = validatedArgs.limit ?? 5;
    const extraLimit = limit + 10;

    const { results: fetched, fetchWindowExhausted } = await fetchCandidates(
      vectorDB,
      validatedArgs.code,
      extraLimit,
    );

    const deduped = excludeSelfMatch(deduplicateResults(fetched), validatedArgs.code);
    const { filtered, filtersApplied } = applyFilters(
      deduped,
      validatedArgs.language,
      validatedArgs.pathHint,
    );

    const finalResults = filtered.slice(0, limit);
    log(`Found ${finalResults.length} similar chunks`);

    const hasFilters = Boolean(
      filtersApplied.language || filtersApplied.pathHint || filtersApplied.prunedLowRelevance > 0,
    );
    // hasMore is a lower bound, never a fabricated total: true if we already
    // have more filtered candidates than `limit` shows, OR the underlying
    // fetch window wasn't proven exhausted (see fetchCandidates).
    const hasMore = filtered.length > limit || !fetchWindowExhausted;
    const note = buildNote(finalResults.length, hasMore);

    return {
      indexInfo: getIndexMetadata(),
      results: shapeResults(finalResults, 'find_similar'),
      hasMore,
      ...(hasFilters && { filtersApplied }),
      ...(note && { note }),
    };
  })(args);
}
