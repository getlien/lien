import type Database from 'better-sqlite3';
import type { SearchResult } from '../types.js';
import type { RelevanceCategory } from '../relevance.js';
import { parseRow, buildSearchResultMetadata } from './row-mapping.js';

/**
 * Over-fetch beyond the requested limit before trimming. Gives the caller's
 * dedup pass headroom without changing the top-ranked results.
 */
const FTS_OVERFETCH = 20;

/** bm25 column weights: symbolName strongest, split tokens next, content least. */
const BM25_WEIGHTS = { symbolName: 4.0, symbolTokens: 2.0, content: 1.0 };

/**
 * Build an FTS5 MATCH expression from free text: whitespace-split, quote each
 * term (doubling embedded quotes), OR-join. FTS5 barewords are implicit-AND —
 * too strict for short code chunks — so OR lets partial matches surface while
 * bm25 still ranks multi-term hits highest.
 */
export function orQuery(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(w => `"${w.replace(/"/g, '""')}"`)
    .join(' OR ');
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Map a bm25 rank into the score/relevance contract.
 *
 * bm25() is NEGATIVE (more negative = better), so ORDER BY rank ASC is correct.
 * ratio = rank / rankBest lands in (0, 1] with the best hit = 1.0. Bands:
 * >=0.75 highly_relevant, >=0.5 relevant, >=0.3 loosely_related, else
 * not_relevant. An exact symbolName match against a query term is forced to
 * highly_relevant. score = (1 - ratio) * 2 keeps lower-is-better ordering and
 * lands in the familiar ~0..2 distance-like range consumers expect. The top
 * hit is therefore always highly_relevant, so results always flow through the
 * handlers' not_relevant pruning. Deliberately simple and tunable.
 */
function toRelevance(ratio: number): RelevanceCategory {
  if (ratio >= 0.75) return 'highly_relevant';
  if (ratio >= 0.5) return 'relevant';
  if (ratio >= 0.3) return 'loosely_related';
  return 'not_relevant';
}

interface FtsRow extends Record<string, unknown> {
  rank: number;
}

/**
 * FTS5 keyword search. Ignores vectors entirely — the meaningful input is the
 * query text. Returns SearchResult[] ordered best-first, trimmed to `limit`.
 */
export function keywordSearch(
  db: Database.Database,
  queryText: string,
  limit: number,
): SearchResult[] {
  const match = orQuery(queryText);
  if (!match) return [];

  const rows = db
    .prepare(
      `SELECT c.*, bm25(chunks_fts, ?, ?, ?) AS rank
       FROM chunks_fts
       JOIN chunks c ON c.id = chunks_fts.rowid
       WHERE chunks_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(
      BM25_WEIGHTS.symbolName,
      BM25_WEIGHTS.symbolTokens,
      BM25_WEIGHTS.content,
      match,
      limit + FTS_OVERFETCH,
    ) as FtsRow[];

  if (rows.length === 0) return [];

  const rankBest = rows[0].rank;
  const terms = new Set(
    queryText
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(t => t.toLowerCase()),
  );

  const results = rows.map(row => {
    // rankBest is the most-negative (best) rank. Clamp to [0, 1] so degenerate
    // bm25 outputs (zero or positive ranks) can never invert the mapping.
    const ratio = rankBest < 0 ? Math.min(1, Math.max(0, row.rank / rankBest)) : 1;
    const record = parseRow(row);
    const exactSymbolMatch = record.symbolName !== '' && terms.has(record.symbolName.toLowerCase());
    const relevance = exactSymbolMatch ? 'highly_relevant' : toRelevance(ratio);
    return {
      content: record.content,
      metadata: buildSearchResultMetadata(record),
      score: round4((1 - ratio) * 2),
      relevance,
    };
  });

  return results.slice(0, limit);
}
