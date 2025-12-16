/**
 * Boosting strategy interface.
 * 
 * Each strategy applies a specific relevance boosting technique
 * to search results based on file characteristics.
 */
export interface BoostingStrategy {
  /** Name of the strategy (for debugging/logging) */
  name: string;
  
  /**
   * Apply the boosting strategy to a score.
   * 
   * @param query - The search query string
   * @param filepath - The file path being scored
   * @param baseScore - The base relevance score from vector similarity
   * @returns The boosted score (lower is better, following LanceDB distance metric)
   */
  apply(query: string, filepath: string, baseScore: number): number;
}

