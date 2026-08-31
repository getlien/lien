/**
 * The input a deterministic signal module needs, and nothing more.
 *
 * Every module in this directory is a pure function over "a diff plus what the
 * parser already extracted". None of them post a comment, call an LLM, or talk
 * to GitHub — which is why they can live in `@liendev/parser` and be driven
 * equally well by `lien review` (a local `git diff`) or by the PR review
 * engine (an Octokit-fetched patch set).
 *
 * `SignalContext` is deliberately the NARROWEST interface that satisfies all
 * 14 modules: it was derived by auditing every `context.<field>` access across
 * them, not by copying the review engine's own context and trimming. The audit
 * found seven fields. Notably absent is anything identifying the pull request
 * — no `owner`, `repo`, `pullNumber`, or `title` — because no signal reads
 * them. A signal that starts wanting them is a signal that has stopped being
 * deterministic, and the type will say so.
 *
 * Review's own `ReviewContext` is a structural superset, so it continues to
 * satisfy this interface with no adapter at the call sites.
 */

import type { CodeChunk } from '../types.js';
import type { ComplexityReport } from '../insights/types.js';

/**
 * The diff half of the input.
 *
 * Named `pr` for source compatibility with `ReviewContext.pr`, though nothing
 * here is GitHub-specific: `lien review` populates it from `git diff` against
 * a base ref. Both fields are optional because a signal must degrade to
 * "no candidates" rather than throw when the diff is unavailable.
 */
export interface SignalDiff {
  /** Raw unified diff text keyed by filename. */
  patches?: Map<string, string>;
  /** Changed line numbers per filename, derived from the unified diff. */
  diffLines?: Map<string, Set<number>>;
}

/**
 * The one logging method any signal actually calls. Kept this thin so a
 * consumer isn't forced to implement an unused `info`/`error`/`debug` trio;
 * a richer logger (review's `Logger`) satisfies it structurally.
 */
export interface SignalLogger {
  warning(message: string): void;
}

export interface SignalContext {
  /** AST chunks for the changed files. */
  chunks: CodeChunk[];
  /** Changed files, filtered to those the parser can analyze. */
  changedFiles: string[];
  /** Every changed file, including non-code ones (docs, config). */
  allChangedFiles?: string[];
  /** Complexity metrics for the changed files. */
  complexityReport: ComplexityReport;
  /**
   * Full-repo AST chunks. Optional: the modules that need repo-wide reach
   * (rename sweeps, sibling surfaces, stale literals) check for it and return
   * no candidates when it is absent, rather than reporting a false clean off
   * a partial corpus.
   */
  repoChunks?: CodeChunk[];
  /** The diff under review. */
  pr?: SignalDiff;
  logger?: SignalLogger;
}
