import type { BoostingStrategy } from './types.js';

/**
 * Composes multiple boosting strategies into a single pipeline.
 *
 * Strategies are applied sequentially, with each strategy
 * receiving the output of the previous strategy as input.
 *
 * @example
 * ```typescript
 * const composer = new BoostingComposer()
 *   .addStrategy(new PathBoostingStrategy())
 *   .addStrategy(new FilenameBoostingStrategy())
 *   .addStrategy(new FileTypeBoostingStrategy(intent));
 *
 * const boostedScore = composer.apply(query, filepath, baseScore);
 * ```
 */
export class BoostingComposer {
  private strategies: BoostingStrategy[] = [];

  /**
   * Add a boosting strategy to the pipeline.
   * Strategies are applied in the order they are added.
   *
   * @param strategy - The strategy to add
   * @returns This composer for chaining
   */
  addStrategy(strategy: BoostingStrategy): this {
    this.strategies.push(strategy);
    return this;
  }

  /**
   * Apply all strategies to a base score.
   *
   * @param query - The search query
   * @param filepath - The file path being scored
   * @param baseScore - The initial score from vector similarity
   * @returns The final boosted score after all strategies
   */
  apply(query: string, filepath: string, baseScore: number): number {
    let score = baseScore;

    for (const strategy of this.strategies) {
      score = strategy.apply(query, filepath, score);
    }

    return score;
  }

  /**
   * Get the names of all strategies in this composer.
   * Useful for debugging and logging.
   */
  getStrategyNames(): string[] {
    return this.strategies.map(s => s.name);
  }

  /**
   * Get the number of strategies in this composer.
   */
  getStrategyCount(): number {
    return this.strategies.length;
  }

  /**
   * Clear all strategies from this composer.
   */
  clear(): void {
    this.strategies = [];
  }
}
