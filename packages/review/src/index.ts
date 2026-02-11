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
  ReviewStyle,
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
} from './review-engine.js';

// GitHub API (portable, uses @octokit/rest)
export {
  type Octokit,
  createOctokit,
  getPRChangedFiles,
  postPRComment,
  getFileContent,
  postPRReview,
  updatePRDescription,
  parsePatchLines,
  getPRDiffLines,
} from './github-api.js';

// OpenRouter API
export {
  type OpenRouterResponse,
  type TokenUsage,
  resetTokenUsage,
  getTokenUsage,
  parseCommentsResponse,
  generateReview,
  mapCommentsToViolations,
  generateLineComments,
} from './openrouter.js';

// Prompt building
export {
  buildReviewPrompt,
  buildNoViolationsMessage,
  formatReviewComment,
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
