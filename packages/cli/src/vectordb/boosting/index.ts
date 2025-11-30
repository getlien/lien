/**
 * Composable boosting strategies for semantic search relevance.
 * 
 * This module provides a strategy pattern implementation for applying
 * relevance boosting to search results. Strategies can be composed
 * together to create complex boosting pipelines.
 * 
 * @example
 * ```typescript
 * import { BoostingComposer, PathBoostingStrategy, FilenameBoostingStrategy } from './boosting';
 * 
 * const composer = new BoostingComposer()
 *   .addStrategy(new PathBoostingStrategy())
 *   .addStrategy(new FilenameBoostingStrategy());
 * 
 * const boostedScore = composer.apply(query, filepath, baseScore);
 * ```
 */

export * from './types.js';
export * from './strategies.js';
export * from './composer.js';

