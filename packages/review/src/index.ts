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
} from './openrouter.js';

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
  buildLineCommentPrompt,
  buildLineSummaryComment,
  buildBatchedCommentsPrompt,
} from './prompt.js';

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
