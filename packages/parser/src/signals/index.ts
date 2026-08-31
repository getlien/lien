/**
 * Deterministic review signals — pure functions over a diff plus parser output.
 *
 * Each module answers one question about a change ("does this literal still
 * appear unconditionally elsewhere?", "did this PR add a variant to some but
 * not all of a family's switch statements?") without an LLM, a network call, or
 * a persisted index. They were built as precomputed inputs to the PR review
 * agent — the alternative being to ask a model to grep and reason, which is
 * both slower and unverifiable — and they live here because the questions are
 * about source structure, which is this package's subject.
 *
 * See `signal-context.ts` for the single input type they share.
 *
 * `export *` rather than a curated list: the modules' own tests currently live
 * in `packages/review/test/` and reach in for internals, so every export has
 * to stay reachable. Once those tests move here and sit beside the code they
 * cover, this barrel can narrow to the surface consumers actually need.
 */

export * from './analyzable-files.js';
export * from './catch-discrimination-signals.js';
export * from './comparison-change-signals.js';
export * from './doc-claims-signals.js';
export * from './docs-drift-signals.js';
export * from './guidance-surface-signals.js';
export * from './removed-export-signals.js';
export * from './rename-sweep-signals.js';
export * from './sibling-surface-signals.js';
export * from './signal-context.js';
export * from './simplicity-signals.js';
export * from './stale-literal-signals.js';
export * from './test-coverage-signals.js';
export * from './unread-field-signals.js';
export * from './untrusted-input-signals.js';
export * from './variant-sweep-signals.js';
