/**
 * @liendev/review — Pluggable review engine for Lien Review
 *
 * Used by the GitHub App (@liendev/app) and the CLI (`lien review`)
 * to analyze code and post reviews.
 */

// ─── Plugin Architecture ────────────────────────────────────────────────────

// Core types
export type {
  ReviewPlugin,
  ReviewContext,
  ReviewFinding,
  LLMClient,
  LLMOptions,
  LLMResponse,
  OutputAdapter,
  AdapterResult,
  AdapterContext,
  PresentContext,
  CheckAnnotation,
  AnalysisResult,
  ReviewSetup,
  ComplexityFindingMetadata,
  BuiltinFindingMetadata,
} from './plugin-types.js';

// Engine
export {
  ReviewEngine,
  createDefaultEngine,
  type EngineOptions,
  type PresentDelivery,
  EMPTY_DELIVERY,
} from './engine.js';

// Delivery attestation
export {
  assembleAttestation,
  emptyAttestation,
  computeVerdict,
  deriveMainPassAttestation,
  formatAttestationBadgeLine,
  ATTESTATION_VERSION,
  type Attestation,
  type AttestationVerdict,
  type AttestationInput,
  type ProviderPassAttestation,
  type ProviderStopReason,
  type SkippedPass,
  type BudgetAttestation,
  type PassBudgetAttestation,
  type ExtraPassAttestationInput,
  type InlineCommentsAttestation,
  type DeliveryAttestation,
  type ScopeAttestation,
  type EligibilityPath,
} from './attestation.js';

// Built-in plugins
export { ComplexityPlugin } from './plugins/complexity.js';
export { AgentReviewPlugin, hasProviderFailure } from './plugins/agent/index.js';

// Dependency graph
export {
  buildDependencyGraph,
  type DependencyGraph,
  type SymbolNode,
  type CallerEdge,
} from './dependency-graph.js';

// Output adapters
export { TerminalAdapter } from './adapters/terminal.js';
export { SARIFAdapter } from './adapters/sarif.js';

// Test harness
export {
  createTestContext,
  createMockLLMClient,
  createTestChunk,
  createTestReport,
  silentLogger,
} from './test-helpers.js';

// ─── Shared types ───────────────────────────────────────────────────────────

export type {
  PRContext,
  ReviewConfig,
  LineComment,
  ComplexityReport,
  ComplexityViolation,
} from './types.js';

// Logger
export { type Logger, consoleLogger } from './logger.js';

// ─── Analysis utilities ─────────────────────────────────────────────────────

export {
  filterAnalyzableFiles,
  runComplexityAnalysis,
  enrichWithTestAssociations,
} from './analysis.js';

// ─── GitHub API ─────────────────────────────────────────────────────────────

export {
  type Octokit,
  type PRPatchData,
  type CheckRunOutput,
  createOctokit,
  getPRChangedFiles,
  postPRComment,
  getFileContent,
  postPRReview,
  updatePRDescription,
  removePRDescriptionSection,
  parsePatchLines,
  getPRDiffLines,
  getPRPatchData,
  getExistingCommentKeys,
  parseCommentMarker,
  createCheckRun,
  updateCheckRun,
  COMMENT_MARKER_PREFIX,
  LEGACY_COMMENT_MARKER_PREFIX,
} from './github-api.js';

// ─── Prompt building ────────────────────────────────────────────────────────

export {
  buildNoViolationsMessage,
  getViolationKey,
  buildDescriptionBadge,
  buildComplexityStatus,
  buildHeaderLine,
  getMetricLabel,
  formatComplexityValue,
  formatThresholdValue,
  type TokenUsageInfo,
  buildLineSummaryComment,
} from './prompt.js';

// ─── Fingerprint ────────────────────────────────────────────────────────────

export {
  type CodebaseFingerprint,
  computeFingerprint,
  serializeFingerprint,
} from './fingerprint.js';

// ─── Simplicity signals ─────────────────────────────────────────────────────

export {
  type FileSimplicitySignal,
  computeSimplicitySignals,
  serializeSimplicitySignals,
} from './simplicity-signals.js';

// ─── Dependent context ──────────────────────────────────────────────────────

export {
  type DependentSnippet,
  type DependentContext,
  assembleDependentContext,
} from './dependent-context.js';

// ─── Delta calculation ──────────────────────────────────────────────────────

export {
  type ComplexityDelta,
  type DeltaSummary,
  calculateDeltas,
  calculateDeltaSummary,
  formatDelta,
  formatSeverityEmoji,
  logDeltaSummary,
} from './delta.js';

// ─── Formatting utilities ───────────────────────────────────────────────────

export { formatTime, formatDeltaValue } from './format.js';

// ─── Git utilities ──────────────────────────────────────────────────────────

export { assertValidSha } from './git-utils.js';

// ─── Clone ──────────────────────────────────────────────────────────────────

export {
  type CloneResult,
  assertValidRepoName,
  cloneBySha,
  cloneByBranch,
  resolveHeadSha,
  resolveCommitTimestamp,
} from './clone.js';

// ─── Review core ────────────────────────────────────────────────────────────

export {
  type ReviewCoreContext,
  type ReviewCoreResult,
  type ReviewLLMConfig,
  reviewPullRequest,
} from './review-pr.js';

// ─── Defaults ───────────────────────────────────────────────────────────────

export {
  DEFAULT_REVIEW_MODEL,
  DEFAULT_OPENROUTER_BASE_URL,
  DEFAULT_OPENROUTER_INPUT_COST_PER_MTOK,
  DEFAULT_OPENROUTER_OUTPUT_COST_PER_MTOK,
} from './defaults.js';
