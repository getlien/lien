/**
 * @liendev/review — Pluggable review engine for Lien Review
 *
 * Used by the GitHub App (@liendev/app) and the CLI (`lien review`)
 * to analyze code and post reviews.
 */

// ─── Plugin Architecture (new) ──────────────────────────────────────────────

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
  LogicFindingMetadata,
  ArchitecturalFindingMetadata,
  BuiltinFindingMetadata,
} from './plugin-types.js';

// Engine
export { ReviewEngine, createDefaultEngine, type EngineOptions } from './engine.js';

// LLM Client
export { OpenRouterLLMClient, type OpenRouterLLMClientOptions } from './llm-client.js';

// Built-in plugins
export { ComplexityPlugin } from './plugins/complexity.js';
export { LogicPlugin } from './plugins/logic.js';
export { ArchitecturalPlugin } from './plugins/architectural.js';

// Output adapters
export { GitHubAdapter } from './adapters/github.js';
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

// Config
export {
  type ReviewYamlConfig,
  loadConfig,
  resolveLLMApiKey,
  getPluginConfig,
  loadPlugin,
  loadPlugins,
} from './config.js';

// ─── Shared types ───────────────────────────────────────────────────────────

export type {
  PRContext,
  ReviewConfig,
  LineComment,
  LogicFinding,
  ComplexityReport,
  ComplexityViolation,
} from './types.js';

// Logger
export { type Logger, consoleLogger } from './logger.js';

// ─── Legacy review engine (kept for backward compat) ────────────────────────

export {
  filterAnalyzableFiles,
  runComplexityAnalysis,
  orchestrateAnalysis,
  handleAnalysisOutputs,
  postReviewIfNeeded,
  prioritizeViolations,
  extractRelevantHunk,
  determineReviewEvent,
  isMarginalViolation,
  filterDuplicateComments,
  buildDedupNote,
  type DedupResult,
} from './review-engine.js';

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
  parsePatchLines,
  getPRDiffLines,
  getPRPatchData,
  getExistingCommentKeys,
  parseCommentMarker,
  parseLogicMarker,
  createCheckRun,
  updateCheckRun,
  COMMENT_MARKER_PREFIX,
  LOGIC_MARKER_PREFIX,
  LEGACY_COMMENT_MARKER_PREFIX,
  LEGACY_LOGIC_MARKER_PREFIX,
} from './github-api.js';

// ─── OpenRouter API (legacy — prefer LLMClient) ────────────────────────────

export {
  type OpenRouterResponse,
  type TokenUsage,
  resetTokenUsage,
  getTokenUsage,
  parseCommentsResponse,
  mapCommentsToViolations,
  generateLineComments,
  generateLogicComments,
} from './openrouter.js';

// ─── Logic review ───────────────────────────────────────────────────────────

export { detectLogicFindings } from './logic-review.js';
export { isFindingSuppressed, parseSuppressionComments } from './suppression.js';
export { buildLogicReviewPrompt } from './logic-prompt.js';
export { parseLogicReviewResponse, type LogicReviewEntry } from './logic-response.js';

// ─── Prompt building ────────────────────────────────────────────────────────

export {
  buildNoViolationsMessage,
  getViolationKey,
  buildDescriptionBadge,
  buildHeaderLine,
  getMetricLabel,
  formatComplexityValue,
  formatThresholdValue,
  type TokenUsageInfo,
  type ArchitecturalContext,
  buildLineCommentPrompt,
  buildLineSummaryComment,
  buildBatchedCommentsPrompt,
} from './prompt.js';

// ─── Architectural review (legacy — prefer ArchitecturalPlugin) ─────────────

export {
  type ArchitecturalNote,
  type EnrichedCommentsResult,
  shouldActivateArchReview,
  computeArchitecturalContext,
  generateEnrichedComments,
  parseEnrichedResponse,
} from './architectural-review.js';

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
