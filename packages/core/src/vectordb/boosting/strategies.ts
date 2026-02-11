import type { BoostingStrategy } from './types.js';
import path from 'path';
import { QueryIntent } from '../intent-classifier.js';

/**
 * File type detection helpers
 */

function isDocumentationFile(filepath: string): boolean {
  const lower = filepath.toLowerCase();
  const filename = path.basename(filepath).toLowerCase();

  if (filename.startsWith('readme')) return true;
  if (filename.startsWith('changelog')) return true;
  if (filename.endsWith('.md') || filename.endsWith('.mdx') || filename.endsWith('.markdown')) {
    return true;
  }
  if (
    lower.includes('/docs/') ||
    lower.includes('/documentation/') ||
    lower.includes('/wiki/') ||
    lower.includes('/.github/')
  ) {
    return true;
  }
  if (lower.includes('architecture') || lower.includes('workflow') || lower.includes('/flow/')) {
    return true;
  }

  return false;
}

function isTestFile(filepath: string): boolean {
  const lower = filepath.toLowerCase();

  if (lower.includes('/test/') || lower.includes('/tests/') || lower.includes('/__tests__/')) {
    return true;
  }

  if (
    lower.includes('.test.') ||
    lower.includes('.spec.') ||
    lower.includes('_test.') ||
    lower.includes('_spec.')
  ) {
    return true;
  }

  return false;
}

function isUtilityFile(filepath: string): boolean {
  const lower = filepath.toLowerCase();

  if (
    lower.includes('/utils/') ||
    lower.includes('/utilities/') ||
    lower.includes('/helpers/') ||
    lower.includes('/lib/')
  ) {
    return true;
  }

  if (
    lower.includes('.util.') ||
    lower.includes('.helper.') ||
    lower.includes('-util.') ||
    lower.includes('-helper.')
  ) {
    return true;
  }

  return false;
}

/**
 * Boosting Strategies
 */

/**
 * Boosts relevance based on path segment matching.
 * Files with query tokens in their path are boosted.
 */
export class PathBoostingStrategy implements BoostingStrategy {
  name = 'path-matching';

  apply(query: string, filepath: string, baseScore: number): number {
    const queryTokens = query.toLowerCase().split(/\s+/);
    const pathSegments = filepath.toLowerCase().split('/');

    let boostFactor = 1.0;

    for (const token of queryTokens) {
      if (token.length <= 2) continue;
      if (pathSegments.some(seg => seg.includes(token))) {
        boostFactor *= 0.9; // Reduce distance = increase relevance
      }
    }

    return baseScore * boostFactor;
  }
}

/**
 * Boosts relevance based on filename matching.
 * Files with query tokens in their filename are strongly boosted.
 */
export class FilenameBoostingStrategy implements BoostingStrategy {
  name = 'filename-matching';

  apply(query: string, filepath: string, baseScore: number): number {
    const filename = path.basename(filepath, path.extname(filepath)).toLowerCase();
    const queryTokens = query.toLowerCase().split(/\s+/);

    let boostFactor = 1.0;

    for (const token of queryTokens) {
      if (token.length <= 2) continue;

      if (filename === token) {
        boostFactor *= 0.7; // Strong boost for exact match
      } else if (filename.includes(token)) {
        boostFactor *= 0.8; // Moderate boost for partial match
      }
    }

    return baseScore * boostFactor;
  }
}

/**
 * Boosts relevance based on file type and query intent.
 * Different file types are boosted for different query intents.
 *
 * Note: This strategy focuses on file-type-specific boosting (test files,
 * documentation files, utility files, etc.). Path and filename boosting
 * are handled separately by PathBoostingStrategy and FilenameBoostingStrategy
 * in the BoostingComposer to avoid double-boosting.
 */
export class FileTypeBoostingStrategy implements BoostingStrategy {
  name = 'file-type';

  constructor(private intent: QueryIntent) {}

  apply(query: string, filepath: string, baseScore: number): number {
    switch (this.intent) {
      case QueryIntent.LOCATION:
        return this.applyLocationBoosting(query, filepath, baseScore);

      case QueryIntent.CONCEPTUAL:
        return this.applyConceptualBoosting(query, filepath, baseScore);

      case QueryIntent.IMPLEMENTATION:
        return this.applyImplementationBoosting(query, filepath, baseScore);

      default:
        return baseScore;
    }
  }

  private applyLocationBoosting(_query: string, filepath: string, score: number): number {
    // Note: Path and filename boosting are handled by PathBoostingStrategy and
    // FilenameBoostingStrategy in the composer. This method only handles
    // file-type-specific boosting for location queries.

    // Slightly deprioritize test files (users want implementation location, not tests)
    if (isTestFile(filepath)) {
      score *= 1.1;
    }

    return score;
  }

  private applyConceptualBoosting(_query: string, filepath: string, score: number): number {
    // Note: Path and filename boosting are handled by PathBoostingStrategy and
    // FilenameBoostingStrategy in the composer. This method only handles
    // file-type-specific boosting for conceptual queries.

    // Strong boost for documentation files
    if (isDocumentationFile(filepath)) {
      score *= 0.65;

      const lower = filepath.toLowerCase();
      if (lower.includes('architecture') || lower.includes('workflow') || lower.includes('flow')) {
        score *= 0.9; // Extra boost for architectural docs
      }
    }

    // Slight boost for utility files (often contain reusable logic)
    if (isUtilityFile(filepath)) {
      score *= 0.95;
    }

    return score;
  }

  private applyImplementationBoosting(_query: string, filepath: string, score: number): number {
    // Note: Path and filename boosting are handled by PathBoostingStrategy and
    // FilenameBoostingStrategy in the composer. This method only handles
    // file-type-specific boosting for implementation queries.

    // Slightly deprioritize test files (user wants implementation, not tests)
    if (isTestFile(filepath)) {
      score *= 1.1;
    }

    return score;
  }
}
