/**
 * False positive suppression filters.
 */

import type { ReviewFinding, BugFindingMetadata } from '../../plugin-types.js';
import type { Logger } from '../../logger.js';

export const TEST_PATH_PATTERN = /(?:test[s]?|spec|__tests__)[/\\]|\.(?:test|spec)\./i;

/** Language family groups -- extensions that can call each other. */
export const LANGUAGE_FAMILIES: Record<string, string> = {
  ts: 'js',
  tsx: 'js',
  js: 'js',
  jsx: 'js',
  mjs: 'js',
  mts: 'js',
  cjs: 'js',
  py: 'py',
  php: 'php',
  rs: 'rs',
  go: 'go',
  java: 'jvm',
  kt: 'jvm',
  scala: 'jvm',
  rb: 'rb',
  cs: 'cs',
  c: 'c',
  cpp: 'c',
  cc: 'c',
  cxx: 'c',
  h: 'c',
  hpp: 'c',
  swift: 'swift',
};

/** Check if a file belongs to the same language family as the given extension. */
export function isSameLanguageFamily(filepath: string, sourceExt: string): boolean {
  const fileExt = filepath.split('.').pop() ?? '';
  const sourceFamily = LANGUAGE_FAMILIES[sourceExt] ?? sourceExt;
  const fileFamily = LANGUAGE_FAMILIES[fileExt] ?? fileExt;
  return sourceFamily === fileFamily;
}

/**
 * Post-LLM filter: suppress common false positive patterns.
 * Applied after all analysis paths before returning findings.
 */
export function suppressFalsePositives(findings: ReviewFinding[], logger: Logger): ReviewFinding[] {
  const before = findings.length;
  const filtered = findings.filter(f => {
    const meta = f.metadata as BugFindingMetadata;

    // Suppress null-check findings in test files -- test assertions handle failures,
    // and factory-created data is always present within the test scope.
    if (meta.callers?.length > 0) {
      const allCallersInTests = meta.callers.every(c => TEST_PATH_PATTERN.test(c.filepath));
      if (allCallersInTests && meta.callers.every(c => c.category === 'null_check')) {
        return false;
      }
    }

    return true;
  });

  if (filtered.length < before) {
    logger.info(
      `Bug finder: suppressed ${before - filtered.length} false positive(s) in test files`,
    );
  }
  return filtered;
}
