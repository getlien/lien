/**
 * Architectural review — trigger logic, context assembly, and enriched response parsing.
 *
 * Provides codebase fingerprint + dependent context to the LLM prompt,
 * enabling cross-file architectural observations alongside per-function complexity comments.
 */

import type { ComplexityReport, ComplexityViolation } from '@liendev/core';
import type { ReviewConfig } from './types.js';
import type { Logger } from './logger.js';
import type { ArchitecturalContext } from './prompt.js';
import { buildBatchedCommentsPrompt } from './prompt.js';
import { callBatchedCommentsAPI, trackUsage, mapCommentsToViolations } from './openrouter.js';
import { computeFingerprint, serializeFingerprint } from './fingerprint.js';
import { assembleDependentContext } from './dependent-context.js';

import type { AnalysisResult } from './review-engine.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single architectural observation from the LLM
 */
export interface ArchitecturalNote {
  scope: string;
  observation: string;
  evidence: string;
  suggestion: string;
}

/**
 * Result of an enriched architectural review generation
 */
export interface EnrichedCommentsResult {
  aiComments: Map<ComplexityViolation, string>;
  architecturalNotes: ArchitecturalNote[];
  prSummary: string | null;
}

// ---------------------------------------------------------------------------
// Trigger Logic
// ---------------------------------------------------------------------------

/**
 * Determine whether architectural review should activate for this PR.
 */
export function shouldActivateArchReview(result: AnalysisResult, config: ReviewConfig): boolean {
  if (config.enableArchitecturalReview === 'off') return false;
  if (config.enableArchitecturalReview === 'always') return true;

  // "auto" mode: activate on any of these conditions
  return result.filesToAnalyze.length >= 3 || hasExportChanges(result) || hasHighRiskFiles(result);
}

/**
 * Detect whether the PR modifies any exported symbols.
 * Compares baseline chunk exports against current chunk exports.
 */
function hasExportChanges(result: AnalysisResult): boolean {
  if (!result.baselineReport) return false;

  // Build current exports map: file -> Set<export>
  const currentExports = new Map<string, Set<string>>();
  for (const chunk of result.chunks) {
    if (chunk.metadata.exports && chunk.metadata.exports.length > 0) {
      const existing = currentExports.get(chunk.metadata.file) || new Set();
      for (const exp of chunk.metadata.exports) existing.add(exp);
      currentExports.set(chunk.metadata.file, existing);
    }
  }

  for (const [filepath, baseFileData] of Object.entries(result.baselineReport.files)) {
    const currentFileData = result.currentReport.files[filepath];
    if (!currentFileData) continue;

    const baseSymbols = new Set(baseFileData.violations.map(v => v.symbolName));
    const currentSymbols = new Set(currentFileData.violations.map(v => v.symbolName));
    const currentFileExports = currentExports.get(filepath) || new Set();

    // Check if any baseline symbol is gone from both violations and exports
    for (const sym of baseSymbols) {
      if (!currentSymbols.has(sym) && !currentFileExports.has(sym)) return true;
    }
  }

  // Check for new files with exports
  for (const chunk of result.chunks) {
    if (!chunk.metadata.exports || chunk.metadata.exports.length === 0) continue;
    const baseFile = result.baselineReport.files[chunk.metadata.file];
    if (!baseFile && chunk.metadata.exports.length > 0) return true;
  }

  return false;
}

/**
 * Check if any analyzed file has high or critical risk level.
 */
function hasHighRiskFiles(result: AnalysisResult): boolean {
  return Object.values(result.currentReport.files).some(
    f => f.riskLevel === 'high' || f.riskLevel === 'critical',
  );
}

// ---------------------------------------------------------------------------
// Context Assembly
// ---------------------------------------------------------------------------

/**
 * Compute the full architectural context for prompt enrichment.
 */
export function computeArchitecturalContext(
  result: AnalysisResult,
  logger: Logger,
): ArchitecturalContext {
  // 1. Compute fingerprint from chunks
  const fingerprint = computeFingerprint(result.chunks);
  const fingerprintText = serializeFingerprint(fingerprint);
  logger.info(`Computed codebase fingerprint: ${fingerprint.paradigm.dominantStyle} paradigm`);

  // 2. Assemble dependent snippets for high-risk functions
  const dependentSnippets = assembleDependentContext(result.currentReport, result.chunks);
  logger.info(`Assembled dependent context for ${dependentSnippets.size} functions`);

  return {
    fingerprint: fingerprintText,
    dependentSnippets,
  };
}

// ---------------------------------------------------------------------------
// Response Parsing
// ---------------------------------------------------------------------------

/**
 * Validate that a value is a structurally valid ArchitecturalNote
 */
function isValidArchNote(note: unknown): note is ArchitecturalNote {
  if (!note || typeof note !== 'object') return false;
  const n = note as Record<string, unknown>;
  return (
    typeof n.scope === 'string' &&
    typeof n.observation === 'string' &&
    typeof n.evidence === 'string' &&
    typeof n.suggestion === 'string'
  );
}

interface EnrichedReviewResponse {
  comments: Record<string, string>;
  architecturalNotes: ArchitecturalNote[];
  prSummary: string | null;
}

/**
 * Parse extended architectural review response from LLM.
 * Falls back gracefully: if LLM returns flat format, wraps it.
 * Returns null if parsing fails completely.
 */
export function parseEnrichedResponse(
  content: string,
  logger: Logger,
): EnrichedReviewResponse | null {
  // Greedy match: LLM responses may contain inner ``` blocks (code suggestions)
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*)```/);
  let jsonStr = (codeBlockMatch ? codeBlockMatch[1] : content).trim();

  logger.info(`Parsing architectural review response (${jsonStr.length} chars)`);

  // Try extended schema first
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed === 'object' && 'comments' in parsed) {
      return extractEnrichedResponse(parsed, logger);
    }
  } catch {
    // Fall through to recovery
  }

  // Aggressive retry: extract any JSON object
  const objectMatch = content.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    jsonStr = objectMatch[0];

    try {
      const parsed = JSON.parse(jsonStr);

      // Try extended schema on recovered JSON
      if (parsed && typeof parsed === 'object' && 'comments' in parsed) {
        logger.info('Recovered extended response with retry');
        return extractEnrichedResponse(parsed, logger);
      }

      // Fallback: treat as flat comments-only format
      if (isPlainStringRecord(parsed)) {
        logger.info(`Falling back to flat format: ${Object.keys(parsed).length} comments`);
        return {
          comments: parsed,
          architecturalNotes: [],
          prSummary: null,
        };
      }
    } catch {
      // Total failure
    }
  }

  logger.warning('Failed to parse architectural review response');
  return null;
}

/**
 * Extract enriched response from a parsed object with a 'comments' key
 */
function extractEnrichedResponse(
  parsed: Record<string, unknown>,
  logger: Logger,
): EnrichedReviewResponse {
  const comments =
    parsed.comments && typeof parsed.comments === 'object'
      ? (parsed.comments as Record<string, string>)
      : {};

  const rawNotes = Array.isArray(parsed.architectural_notes)
    ? parsed.architectural_notes.filter(isValidArchNote)
    : [];

  const prSummary = typeof parsed.pr_summary === 'string' ? parsed.pr_summary : null;

  logger.info(
    `Parsed extended response: ${Object.keys(comments).length} comments, ${rawNotes.length} architectural notes`,
  );

  return {
    comments,
    architecturalNotes: rawNotes.slice(0, 3), // cap at 3
    prSummary,
  };
}

/**
 * Check if a value is a plain Record<string, string>
 */
function isPlainStringRecord(val: unknown): val is Record<string, string> {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
  return Object.values(val as Record<string, unknown>).every(v => typeof v === 'string');
}

// ---------------------------------------------------------------------------
// Enriched Comment Generation
// ---------------------------------------------------------------------------

/**
 * Generate line comments with architectural context in a single API call.
 * Returns both per-function comments and architectural observations.
 */
export async function generateEnrichedComments(
  violations: ComplexityViolation[],
  codeSnippets: Map<string, string>,
  apiKey: string,
  model: string,
  report: ComplexityReport,
  logger: Logger,
  diffHunks?: Map<string, string>,
  archContext?: ArchitecturalContext,
): Promise<EnrichedCommentsResult> {
  if (violations.length === 0) {
    return { aiComments: new Map(), architecturalNotes: [], prSummary: null };
  }

  logger.info(`Generating architectural review comments for ${violations.length} violations`);

  const prompt = buildBatchedCommentsPrompt(
    violations,
    codeSnippets,
    report,
    diffHunks,
    archContext,
  );
  const data = await callBatchedCommentsAPI(prompt, apiKey, model);

  if (data.usage) {
    trackUsage(data.usage);
    const costStr = data.usage.cost ? ` ($${data.usage.cost.toFixed(6)})` : '';
    logger.info(
      `Arch review tokens: ${data.usage.prompt_tokens} in, ${data.usage.completion_tokens} out${costStr}`,
    );
  }

  let content = data.choices[0].message.content;

  // Parse with extended schema when archContext is provided
  if (archContext) {
    let archResponse = parseEnrichedResponse(content, logger);

    // Retry once if parsing fails (reasoning models sometimes produce truncated output)
    if (!archResponse) {
      logger.warning(`LLM response (${content.length} chars) could not be parsed, retrying...`);
      logger.info(`Response preview: ${content.slice(0, 200)}`);

      const retryData = await callBatchedCommentsAPI(prompt, apiKey, model);
      if (retryData.usage) {
        trackUsage(retryData.usage);
        const costStr = retryData.usage.cost ? ` ($${retryData.usage.cost.toFixed(6)})` : '';
        logger.info(
          `Retry tokens: ${retryData.usage.prompt_tokens} in, ${retryData.usage.completion_tokens} out${costStr}`,
        );
      }
      content = retryData.choices[0].message.content;
      archResponse = parseEnrichedResponse(content, logger);
    }

    if (archResponse) {
      const aiComments = mapCommentsToViolations(archResponse.comments, violations, logger);
      return {
        aiComments,
        architecturalNotes: archResponse.architecturalNotes,
        prSummary: archResponse.prSummary,
      };
    }

    // Both attempts failed — log for debugging
    logger.warning(`Response after retry (${content.length} chars): ${content.slice(0, 300)}`);
  }

  // Fallback: parse as flat comments (existing behavior)
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*)```/);
  const jsonStr = (codeBlockMatch ? codeBlockMatch[1] : content).trim();
  let commentsMap: Record<string, string> | null = null;
  try {
    commentsMap = JSON.parse(jsonStr);
  } catch {
    const objectMatch = content.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        commentsMap = JSON.parse(objectMatch[0]);
      } catch {
        logger.warning('Failed to parse review response');
      }
    }
  }

  return {
    aiComments: mapCommentsToViolations(commentsMap, violations, logger),
    architecturalNotes: [],
    prSummary: null,
  };
}
