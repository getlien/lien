import type Database from 'better-sqlite3';
import type { SearchResult } from '../types.js';
import type { RelevanceCategory } from '../relevance.js';
import { parseRow, buildSearchResultMetadata } from './row-mapping.js';
import { getDependentCounts, normalizeFileForCounts } from './dependent-counts.js';

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
 * Structural ranking boost tuning. Deliberately small: at a dependentCount of
 * ~200 (a well-connected hub file) the multiplier is `1 + 0.15 * ln(201) ≈
 * 1.8x` — enough to win a near-tie between two similarly-relevant bm25 hits.
 *
 * Caveat (found in review, worth being honest about rather than papering
 * over): because relevance bands are continuous ranges, NO nonzero
 * multiplicative boost can guarantee it never crosses a band boundary — a
 * `relevant` match (ratio as low as 0.5) with dependentCount≈200 boosts to
 * ~0.9, which can outrank an unconnected `highly_relevant` match sitting
 * near the bottom of its band (ratio just above 0.75). This is an accepted
 * tradeoff of "structural importance can matter more than a marginal lexical
 * edge for a genuinely central file," not a bug — see MAX_STRUCTURAL_BOOST
 * below for the (bounded, not "band-safe") ceiling this is capped at.
 */
export const STRUCTURAL_BOOST_ALPHA = 0.15;

/**
 * Hard ceiling on the multiplier from `applyStructuralBoost`, independent of
 * `STRUCTURAL_BOOST_ALPHA`. Bounds worst-case behavior for a pathologically
 * large dependentCount (e.g. a true god-object in a huge monorepo) — without
 * this, `log1p` still grows (slowly) without bound. At the realistic max
 * documented above (~200 dependents) the multiplier is ~1.8x, comfortably
 * under this 2x ceiling, so normal behavior is unaffected.
 */
export const MAX_STRUCTURAL_BOOST_MULTIPLIER = 2;

/**
 * Env escape hatch for the structural ranking boost below (`applyStructuralBoost`
 * / the re-sort in `keywordSearch`). Set `LIEN_STRUCTURAL_RANKING=off` to fall
 * back to pure bm25 ordering — e.g. to A/B the feature or rule it out while
 * debugging a search result. Does not affect the `dependentCount` field
 * search_code attaches to metadata; that's informational and unconditional.
 */
export function structuralRankingEnabled(): boolean {
  return process.env.LIEN_STRUCTURAL_RANKING !== 'off';
}

/**
 * Blend a bm25-derived relevance ratio (`ratio` from `keywordSearch`, in
 * (0, 1], higher = better lexical match) with a structural importance signal
 * (`dependentCount`: how many other files import this chunk's file — see
 * dependent-counts.ts).
 *
 * `final = ratio * min(MAX_STRUCTURAL_BOOST_MULTIPLIER, 1 + α · log(1 + dependentCount))`
 *
 * `Math.log1p` keeps the boost sublinear: going from 1 to 2 dependents moves
 * the multiplier far more than going from 100 to 200 — a file being imported
 * by *anyone* is the meaningful signal, not the exact count. The multiplier
 * is capped at `MAX_STRUCTURAL_BOOST_MULTIPLIER` so an extreme dependentCount
 * can't grow the boost unboundedly. The result is never less than `ratio`,
 * so this only ever promotes a result within its already-fetched candidate
 * window, never demotes one — but it is NOT guaranteed to stay within the
 * same relevance band as `ratio` (see the caveat on `STRUCTURAL_BOOST_ALPHA`):
 * a well-connected hub file can cross into a higher band than an unconnected
 * file with a marginally better lexical match.
 */
export function applyStructuralBoost(
  ratio: number,
  dependentCount: number,
  alpha: number = STRUCTURAL_BOOST_ALPHA,
): number {
  const multiplier = 1 + alpha * Math.log1p(Math.max(0, dependentCount));
  return ratio * Math.min(MAX_STRUCTURAL_BOOST_MULTIPLIER, multiplier);
}

/** A scored FTS row plus the internal ratio the boost re-sort needs — never returned as-is. */
type RankedResult = SearchResult & { ratio: number };

/**
 * Score one FTS row into a `RankedResult` (bm25 ratio/relevance/score + dependentCount metadata).
 *
 * `score` and `relevance` are deliberately computed from the PURE bm25 `ratio`,
 * never from the boosted value used for ordering — they answer "how good is
 * this lexical match", a meaning that would collapse if a highly-connected
 * but weakly-matching file could inflate its own `relevance` band. `dependentCount`
 * is in the metadata precisely so a caller who wants the actual sort key can
 * derive it themselves (the formula is documented on `applyStructuralBoost`
 * and in the search_code tool description): the list order can therefore
 * legitimately show a `relevant` result above a `highly_relevant` one when
 * structural ranking is enabled — that's not a bug, see the caveat on
 * `STRUCTURAL_BOOST_ALPHA`.
 */
function scoreRow(
  row: FtsRow,
  rankBest: number,
  terms: Set<string>,
  dependentCounts: Map<string, number>,
): RankedResult {
  // rankBest is the most-negative (best) rank. Clamp to [0, 1] so degenerate
  // bm25 outputs (zero or positive ranks) can never invert the mapping.
  const ratio = rankBest < 0 ? Math.min(1, Math.max(0, row.rank / rankBest)) : 1;
  const record = parseRow(row);
  const exactSymbolMatch = record.symbolName !== '' && terms.has(record.symbolName.toLowerCase());
  const relevance = exactSymbolMatch ? 'highly_relevant' : toRelevance(ratio);
  const dependentCount = dependentCounts.get(normalizeFileForCounts(record.file)) ?? 0;

  return {
    content: record.content,
    metadata: { ...buildSearchResultMetadata(record), dependentCount },
    score: round4((1 - ratio) * 2),
    relevance,
    ratio,
  };
}

/**
 * FTS5 keyword search. Ignores vectors entirely — the meaningful input is the
 * query text. Returns SearchResult[] ordered best-first, trimmed to `limit`.
 *
 * Ordering: bm25 (via the SQL `ORDER BY rank`) picks the overfetched
 * candidate window; within that window, `applyStructuralBoost` re-sorts by
 * bm25-blended-with-dependentCount (see its doc comment) unless
 * `structuralRankingEnabled()` is false, in which case the SQL's pure bm25
 * order is preserved untouched. `Array.prototype.sort` is stable (ES2019+),
 * so equal-boost rows keep their original bm25 order either way.
 *
 * Each result's own `score`/`relevance` fields are NOT recomputed from the
 * boost (see `scoreRow`'s doc comment) — they stay pure bm25, so the list
 * order and each item's own relevance label can legitimately disagree when
 * structural ranking promotes a well-connected file.
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
  const dependentCounts = getDependentCounts(db);

  const scored = rows.map(row => scoreRow(row, rankBest, terms, dependentCounts));

  const ranked = structuralRankingEnabled()
    ? [...scored].sort(
        (a, b) =>
          applyStructuralBoost(b.ratio, b.metadata.dependentCount ?? 0) -
          applyStructuralBoost(a.ratio, a.metadata.dependentCount ?? 0),
      )
    : scored;

  return ranked.slice(0, limit).map(({ ratio: _ratio, ...result }) => result);
}
