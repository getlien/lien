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
 * See `signal-context.ts` for the single input type they all take.
 *
 * ---
 *
 * This barrel is the PUBLIC surface, and it is deliberately curated rather
 * than a wildcard over the directory. The 16 modules export 106 symbols
 * between them; exactly 37 have a consumer outside their own module. The
 * other 69 are exported only so the modules' tests can reach them, and
 * `@liendev/parser` is a published package — wildcarding them would semver-
 * lock 69 internals and make the eventual narrowing a BREAKING change.
 *
 * The tests that need those internals import them by relative path
 * (`packages/review/test/*-signals.test.ts` → `../../parser/src/signals/…`)
 * precisely so they never appear here. That cross-package import is a
 * deliberate, visible stopgap: those tests belong beside the code they cover,
 * and the follow-up that moves them into this directory removes it. Until
 * then, the rule for this file is: a symbol earns a line here when production
 * code outside its module imports it, not when a test does.
 */

export { filterAnalyzableFiles } from './analyzable-files.js';

export type { SignalContext, SignalDiff, SignalLogger } from './signal-context.js';

export { renderUndiscriminatedCatchSection } from './catch-discrimination-signals.js';

export { renderComparisonChangeSection } from './comparison-change-signals.js';

export { extractDocClaims, attachEvidence, renderDocClaimsSection } from './doc-claims-signals.js';
export type { DocClaim } from './doc-claims-signals.js';

export { computeDocsDriftCandidates, isFullFileDeletion } from './docs-drift-signals.js';
export type { DocsDriftCandidate } from './docs-drift-signals.js';

export { renderGuidanceSurfaceSection } from './guidance-surface-signals.js';

export {
  computeRemovedExportContexts,
  renderRemovedExportsSection,
} from './removed-export-signals.js';
export type { RemovedExportContext } from './removed-export-signals.js';

export { computeRenameSweepSignals, renderRenameSweepSection } from './rename-sweep-signals.js';
export type { RenameSweepSignal } from './rename-sweep-signals.js';

export { extractSiblingSurfaces, renderSiblingSurfacesSection } from './sibling-surface-signals.js';
export type { SiblingSurfaceEntry } from './sibling-surface-signals.js';

export { computeSimplicitySignals, serializeSimplicitySignals } from './simplicity-signals.js';
export type { FileSimplicitySignal } from './simplicity-signals.js';

export {
  computeStaleLiteralCandidates,
  renderStaleLiteralSection,
} from './stale-literal-signals.js';
export type { StaleLiteralCandidate } from './stale-literal-signals.js';

export { renderTestCoverageSection } from './test-coverage-signals.js';

export { computeUnreadFieldCandidates, renderUnreadFieldSection } from './unread-field-signals.js';
export type { UnreadFieldCandidate } from './unread-field-signals.js';

export { renderUntrustedInputSection } from './untrusted-input-signals.js';

export { computeVariantSweepContexts, renderVariantSweepSection } from './variant-sweep-signals.js';
export type { VariantSweepContext } from './variant-sweep-signals.js';
