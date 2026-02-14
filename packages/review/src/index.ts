/**
 * @liendev/review — Shared review logic for Veille
 *
 * Used by both the GitHub Action (@liendev/action) and
 * the GitHub App (@liendev/app) to analyze PR complexity
 * and post review comments.
 */

// Types
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

// Review engine (main orchestration)
export {
  type AnalysisResult,
  type ReviewSetup,
  filterAnalyzableFiles,
  runComplexityAnalysis,
  orchestrateAnalysis,
  handleAnalysisOutputs,
  postReviewIfNeeded,
  extractRelevantHunk,
  determineReviewEvent,
  isMarginalViolation,
  filterDuplicateComments,
} from './review-engine.js';

// GitHub API (portable, uses @octokit/rest)
export {
  type Octokit,
  type PRPatchData,
  createOctokit,
  getPRChangedFiles,
  postPRComment,
  getFileContent,
  postPRReview,
  updatePRDescription,
  parsePatchLines,
  getPRDiffLines,
  getPRPatchData,
  getExistingVeilleCommentKeys,
  parseVeilleMarker,
  parseVeilleLogicMarker,
  VEILLE_COMMENT_MARKER_PREFIX,
  VEILLE_LOGIC_MARKER_PREFIX,
} from './github-api.js';

// OpenRouter API
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

// Logic review
export { detectLogicFindings } from './logic-review.js';
export { isFindingSuppressed, parseSuppressionComments } from './suppression.js';
export { buildLogicReviewPrompt } from './logic-prompt.js';
export { parseLogicReviewResponse, type LogicReviewEntry } from './logic-response.js';

// Prompt building
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

// Architectural review
export {
  type ArchitecturalNote,
  type EnrichedCommentsResult,
  shouldActivateArchReview,
  computeArchitecturalContext,
  generateEnrichedComments,
  parseEnrichedResponse,
} from './architectural-review.js';

// Fingerprint
export {
  type CodebaseFingerprint,
  computeFingerprint,
  serializeFingerprint,
} from './fingerprint.js';

// Dependent context
export {
  type DependentSnippet,
  type DependentContext,
  assembleDependentContext,
} from './dependent-context.js';

// Delta calculation
export {
  type ComplexityDelta,
  type DeltaSummary,
  calculateDeltas,
  calculateDeltaSummary,
  formatDelta,
  formatSeverityEmoji,
  logDeltaSummary,
} from './delta.js';

// Formatting utilities
export { formatTime, formatDeltaValue } from './format.js';
