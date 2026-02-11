/**
 * Relevance category based on semantic similarity score
 */
export type RelevanceCategory = 'highly_relevant' | 'relevant' | 'loosely_related' | 'not_relevant';

/**
 * Calculate relevance category from cosine distance score.
 *
 * Lower scores indicate higher similarity (closer in vector space).
 * Thresholds based on observed score distributions from dogfooding.
 *
 * @param score - Cosine distance score from vector search
 * @returns Human-readable relevance category
 */
export function calculateRelevance(score: number): RelevanceCategory {
  if (score < 1.0) return 'highly_relevant';
  if (score < 1.3) return 'relevant';
  if (score < 1.5) return 'loosely_related';
  return 'not_relevant';
}
