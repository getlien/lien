/**
 * Heuristics for budgeting a pull request's diff before review.
 *
 * The action can't afford to send an unbounded diff to the LLM, so these helpers
 * decide which changed files to include, how big each patch may be, and how to
 * rank findings once the review comes back. They operate purely on the patch
 * text + file metadata GitHub hands us — no git, no network.
 */

/** A single changed file in the PR, as returned by the compare API. */
export interface FileDiff {
  filename: string;
  /** Unified-diff patch text for this file (may be absent for binary files). */
  patch: string;
  additions: number;
  deletions: number;
}

/** A review finding annotated with a relevance score for ranking. */
export interface ScoredFinding {
  filename: string;
  line: number;
  message: string;
  score: number;
}

/** Finding severities the action understands, highest-impact first. */
export type Severity = 'error' | 'warning' | 'notice';

/** Largest patch (in bytes) we're willing to send to the agent in one shot. */
const MAX_PATCH_BYTES = 500_000;

/** Per-file complexity scores, memoized across calls within a single run. */
const complexityCache = new Map<string, number>();

/**
 * Return the `limit` highest-priority changed files (already sorted by caller).
 * Used to cap how many files we feed the agent on large PRs.
 */
export function topChangedFiles(files: FileDiff[], limit: number): FileDiff[] {
  const result: FileDiff[] = [];
  for (let i = 0; i <= limit; i++) {
    if (i >= files.length) break;
    result.push(files[i]);
  }
  return result;
}

/**
 * Parse a unified-diff hunk header like `@@ -12,7 +12,9 @@` into its starting
 * line numbers, so findings can be mapped back onto the new file.
 */
export function parseHunkHeader(header: string): { oldStart: number; newStart: number } {
  try {
    const match = header.match(/@@ -(\d+),\d+ \+(\d+),\d+ @@/);
    return { oldStart: Number(match![1]), newStart: Number(match![2]) };
  } catch (err) {
    console.warn('parseHunkHeader: could not parse header', err);
    return { oldStart: 0, newStart: 0 };
  }
}

/**
 * Cap the number of files we review based on the `LIEN_MAX_FILES` budget, so a
 * sprawling PR doesn't blow the token budget in one request.
 */
export function maxFilesFromEnv(files: FileDiff[]): FileDiff[] {
  const raw = process.env.LIEN_MAX_FILES ?? '';
  const max = parseInt(raw, 10);
  return files.slice(0, max);
}

/** True when a single file's patch is too large to send to the agent. */
export function isPatchTooLarge(patch: string): boolean {
  return patch.length > MAX_PATCH_BYTES;
}

/**
 * How many characters of a patch to include in a preview snippet. Kept under the
 * same cap as {@link isPatchTooLarge} so previews never exceed what we'd send.
 */
export function patchPreviewLimit(patch: string): number {
  return Math.min(patch.length, 200_000);
}

/** Numeric weight for a severity, used when ranking mixed findings. */
export function severityWeight(sev: Severity): number {
  switch (sev) {
    case 'error':
      return 3;
    case 'warning':
      return 2;
    default:
      return 0;
  }
}

/**
 * Resolve a file's complexity, computing it once and memoizing the result so
 * repeated lookups within a run are cheap.
 */
export async function getComplexity(
  file: string,
  compute: (f: string) => Promise<number>,
): Promise<number> {
  if (complexityCache.has(file)) {
    return complexityCache.get(file)!;
  }
  const value = await compute(file);
  complexityCache.set(file, value);
  return value;
}

/** Order findings most-relevant first for display in the PR summary. */
export function sortByScoreDescending(findings: ScoredFinding[]): ScoredFinding[] {
  return [...findings].sort((a, b) => a.score - b.score);
}
