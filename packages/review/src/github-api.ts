/**
 * GitHub API helpers using @octokit/rest
 * Portable across GitHub Actions and GitHub App contexts.
 */

import { Octokit } from '@octokit/rest';
import type { PRContext, LineComment } from './types.js';
import type { Logger } from './logger.js';

export type { Octokit };

/**
 * Create an Octokit instance from a token
 */
export function createOctokit(token: string): Octokit {
  return new Octokit({ auth: token });
}

// ---------------------------------------------------------------------------
// Check Run API
// ---------------------------------------------------------------------------

export interface CheckRunOutput {
  title: string;
  summary: string;
  text?: string;
  annotations?: Array<{
    path: string;
    start_line: number;
    end_line: number;
    annotation_level: 'notice' | 'warning' | 'failure';
    message: string;
    title?: string;
  }>;
}

/**
 * Create a GitHub Check Run. Returns the check_run_id.
 */
export async function createCheckRun(
  octokit: Octokit,
  params: {
    owner: string;
    repo: string;
    name: string;
    headSha: string;
    status: 'queued' | 'in_progress' | 'completed';
    conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'action_required';
    output?: CheckRunOutput;
  },
  logger: Logger,
): Promise<number> {
  const { data } = await octokit.checks.create({
    owner: params.owner,
    repo: params.repo,
    name: params.name,
    head_sha: params.headSha,
    status: params.status,
    ...(params.conclusion ? { conclusion: params.conclusion } : {}),
    ...(params.output ? { output: params.output } : {}),
  });

  logger.info(`Created check run "${params.name}" (id: ${data.id})`);
  return data.id;
}

/**
 * Update an existing GitHub Check Run.
 */
export async function updateCheckRun(
  octokit: Octokit,
  params: {
    owner: string;
    repo: string;
    checkRunId: number;
    status?: 'queued' | 'in_progress' | 'completed';
    conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'action_required';
    output?: CheckRunOutput;
  },
  logger: Logger,
): Promise<void> {
  await octokit.checks.update({
    owner: params.owner,
    repo: params.repo,
    check_run_id: params.checkRunId,
    ...(params.status ? { status: params.status } : {}),
    ...(params.conclusion ? { conclusion: params.conclusion } : {}),
    ...(params.output ? { output: params.output } : {}),
  });

  logger.debug(`Updated check run ${params.checkRunId}`);
}

/**
 * Get list of files changed in the PR
 */
export async function getPRChangedFiles(octokit: Octokit, prContext: PRContext): Promise<string[]> {
  const files: string[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const response = await octokit.pulls.listFiles({
      owner: prContext.owner,
      repo: prContext.repo,
      pull_number: prContext.pullNumber,
      per_page: perPage,
      page,
    });

    for (const file of response.data) {
      // Only include added or modified files (not deleted)
      if (file.status !== 'removed') {
        files.push(file.filename);
      }
    }

    if (response.data.length < perPage) {
      break;
    }
    page++;
  }

  return files;
}

/**
 * Post a comment on the PR (creates or updates existing Lien comment)
 */
export async function postPRComment(
  octokit: Octokit,
  prContext: PRContext,
  body: string,
  logger: Logger,
): Promise<void> {
  // Check for existing Lien comment to update instead of creating new
  const existingComment = await findExistingComment(octokit, prContext);

  if (existingComment) {
    logger.info(`Updating existing comment ${existingComment.id}`);
    await octokit.issues.updateComment({
      owner: prContext.owner,
      repo: prContext.repo,
      comment_id: existingComment.id,
      body,
    });
  } else {
    logger.info('Creating new comment');
    await octokit.issues.createComment({
      owner: prContext.owner,
      repo: prContext.repo,
      issue_number: prContext.pullNumber,
      body,
    });
  }
}

/**
 * Find existing Lien review comment to update
 */
async function findExistingComment(
  octokit: Octokit,
  prContext: PRContext,
): Promise<{ id: number } | null> {
  const COMMENT_MARKER = '<!-- lien-ai-review -->';

  const comments = await octokit.issues.listComments({
    owner: prContext.owner,
    repo: prContext.repo,
    issue_number: prContext.pullNumber,
  });

  for (const comment of comments.data) {
    if (comment.body?.includes(COMMENT_MARKER)) {
      return { id: comment.id };
    }
  }

  return null;
}

/**
 * Get code snippet from a file at a specific commit
 */
export async function getFileContent(
  octokit: Octokit,
  prContext: PRContext,
  filepath: string,
  startLine: number,
  endLine: number,
  logger: Logger,
): Promise<string | null> {
  try {
    const response = await octokit.repos.getContent({
      owner: prContext.owner,
      repo: prContext.repo,
      path: filepath,
      ref: prContext.headSha,
    });

    if ('content' in response.data) {
      const content = Buffer.from(response.data.content as string, 'base64').toString('utf-8');
      const lines = content.split('\n');
      // Line numbers are 1-based, array is 0-based
      const snippet = lines.slice(startLine - 1, endLine).join('\n');
      return snippet;
    }
  } catch (error) {
    logger.warning(`Failed to get content for ${filepath}: ${error}`);
  }

  return null;
}

/**
 * Result of {@link postPRReview}: how many line comments actually landed,
 * which ones were dropped (with why), and whether the summary body itself
 * made it through — so callers can surface the degradation instead of
 * losing it silently.
 */
export interface PostReviewResult {
  posted: number;
  dropped: Array<{ path: string; line: number; error: string }>;
  /**
   * Whether the summary body was posted — either as part of the successful
   * batch, or via the body-only fallback after a batch validation failure.
   * `false` means the body-only post itself failed (best-effort; salvaging
   * the inline comments still proceeds regardless).
   */
  bodyPosted: boolean;
}

/** Shape a LineComment into the params octokit expects for a review comment. */
function toReviewCommentParams(c: LineComment, logger: Logger) {
  const hasValidStartLine = typeof c.start_line === 'number' && c.start_line > 0;
  if (c.start_line !== undefined && !hasValidStartLine) {
    logger.warning(
      `Stripping invalid start_line (${c.start_line}) for comment at ${c.path}:${c.line}; ` +
        'posting as a single-line comment instead',
    );
  }
  return {
    path: c.path,
    line: c.line,
    ...(hasValidStartLine ? { start_line: c.start_line, start_side: 'RIGHT' as const } : {}),
    side: 'RIGHT' as const,
    body: c.body,
  };
}

/** Does this error look like a GitHub API rejection we can retry per-comment (a 422 on the batch)? */
function isBatchValidationError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status: unknown }).status === 422
  );
}

/**
 * Post a review with line-specific comments.
 *
 * `octokit.pulls.createReview` is all-or-nothing: if ANY comment anchors to a
 * line outside the diff, GitHub rejects the whole batch with a 422 —
 * including every valid comment in it. Only that validation failure triggers
 * the per-comment salvage path below: we attempt the summary body on its own
 * (best-effort — see `bodyPosted` on the result), then retry each comment
 * individually via `createReviewComment` so one bad anchor can't take the
 * rest down with it. Comments that still fail are logged and returned in
 * `dropped`, never silently discarded. Any other failure (auth, rate-limit,
 * 5xx, network) is rethrown as-is — those aren't anchor problems and
 * salvaging would just mask the real error.
 */
export async function postPRReview(
  octokit: Octokit,
  prContext: PRContext,
  comments: LineComment[],
  summaryBody: string,
  logger: Logger,
  event: 'COMMENT' | 'REQUEST_CHANGES' = 'COMMENT',
): Promise<PostReviewResult> {
  logger.info(`Creating review with ${comments.length} line comments (event: ${event})`);

  const reviewParams = {
    owner: prContext.owner,
    repo: prContext.repo,
    pull_number: prContext.pullNumber,
    commit_id: prContext.headSha,
    event,
    body: summaryBody,
    ...(comments.length > 0
      ? { comments: comments.map(c => toReviewCommentParams(c, logger)) }
      : {}),
  };

  try {
    await octokit.pulls.createReview(reviewParams);
    logger.info('Review posted successfully');
    return { posted: comments.length, dropped: [], bodyPosted: true };
  } catch (error) {
    if (comments.length === 0 || !isBatchValidationError(error)) {
      // Nothing to salvage individually, or this isn't a bad-anchor
      // rejection we know how to retry around — surface it as before.
      throw error;
    }

    logger.warning(`Failed to post line comments as a batch: ${error}`);
    return postBodyThenRetryCommentsIndividually(
      octokit,
      prContext,
      comments,
      summaryBody,
      logger,
      event,
    );
  }
}

/**
 * Batch-validation fallback: attempt the summary body alone first, then
 * retry each comment individually via `createReviewComment` so one bad
 * anchor can't take the rest of the batch down with it.
 *
 * The body-only post is best-effort — if it fails (e.g. a transient network
 * error right after the batch failure), that's caught, logged, and reported
 * back via `bodyPosted: false` rather than thrown, so the per-comment
 * salvage loop below still runs regardless.
 */
async function postBodyThenRetryCommentsIndividually(
  octokit: Octokit,
  prContext: PRContext,
  comments: LineComment[],
  summaryBody: string,
  logger: Logger,
  event: 'COMMENT' | 'REQUEST_CHANGES',
): Promise<PostReviewResult> {
  logger.info('Posting body-only review, then retrying comments individually');

  let bodyPosted = true;
  try {
    await octokit.pulls.createReview({
      owner: prContext.owner,
      repo: prContext.repo,
      pull_number: prContext.pullNumber,
      commit_id: prContext.headSha,
      event,
      body: summaryBody,
    });
  } catch (error) {
    logger.warning(`Failed to post body-only review after batch failure: ${error}`);
    bodyPosted = false;
  }

  const dropped: PostReviewResult['dropped'] = [];
  let posted = 0;

  for (const comment of comments) {
    try {
      await octokit.pulls.createReviewComment({
        owner: prContext.owner,
        repo: prContext.repo,
        pull_number: prContext.pullNumber,
        commit_id: prContext.headSha,
        ...toReviewCommentParams(comment, logger),
      });
      posted++;
    } catch (commentError) {
      const message = commentError instanceof Error ? commentError.message : String(commentError);
      logger.warning(`Dropped inline comment at ${comment.path}:${comment.line}: ${message}`);
      dropped.push({ path: comment.path, line: comment.line, error: message });
    }
  }

  logger.info(
    `Posted ${posted} of ${comments.length} line comments individually after batch failure; ` +
      `${dropped.length} dropped`,
  );

  return { posted, dropped, bodyPosted };
}

/**
 * Marker prefix for Lien Review inline review comments.
 * Format: <!-- lien-review:filepath::symbolName -->
 */
export const COMMENT_MARKER_PREFIX = '<!-- lien-review:';

/** @deprecated Legacy prefix — kept for 6 months to recognize old PR comments */
export const LEGACY_COMMENT_MARKER_PREFIX = '<!-- veille:';

/**
 * Parse a comment marker from a comment body, returning the dedup key or null.
 * Checks for the new `lien-review:` prefix first, then falls back to legacy `veille:`.
 */
export function parseCommentMarker(body: string): string | null {
  // Try new prefix first
  let start = body.indexOf(COMMENT_MARKER_PREFIX);
  let prefix = COMMENT_MARKER_PREFIX;
  if (start === -1) {
    // Fall back to legacy prefix
    start = body.indexOf(LEGACY_COMMENT_MARKER_PREFIX);
    prefix = LEGACY_COMMENT_MARKER_PREFIX;
  }
  if (start === -1) return null;
  const keyStart = start + prefix.length;
  const end = body.indexOf(' -->', keyStart);
  if (end === -1) return null;
  return body.slice(keyStart, end);
}

/** Paginate all review comments on a PR. */
async function* listAllReviewComments(octokit: Octokit, prContext: PRContext) {
  const iterator = octokit.paginate.iterator(octokit.pulls.listReviewComments, {
    owner: prContext.owner,
    repo: prContext.repo,
    pull_number: prContext.pullNumber,
    per_page: 100,
  });
  for await (const response of iterator) {
    yield* response.data;
  }
}

/**
 * Fetch existing Lien Review inline comment keys from the PR.
 * Returns a Map of dedup keys → comment URLs for complexity comments.
 */
export async function getExistingCommentKeys(
  octokit: Octokit,
  prContext: PRContext,
  logger: Logger,
): Promise<{ complexity: Map<string, string> }> {
  const complexity = new Map<string, string>();

  for await (const comment of listAllReviewComments(octokit, prContext)) {
    if (!comment.body) continue;

    const complexityKey = parseCommentMarker(comment.body);
    if (complexityKey) {
      complexity.set(complexityKey, comment.html_url);
    }
  }

  logger.info(`Found ${complexity.size} existing complexity comments`);
  return { complexity };
}

/**
 * Marker prefix for plugin inline review comments posted via postInlineComments.
 * Format: <!-- lien-plugin:{pluginId}:{key} -->
 */
export const PLUGIN_MARKER_PREFIX = '<!-- lien-plugin:';

/**
 * Fetch existing inline comment keys for a specific plugin (for deduplication).
 */
export async function getExistingPluginCommentKeys(
  octokit: Octokit,
  prContext: PRContext,
  pluginId: string,
  logger: Logger,
): Promise<Set<string>> {
  const prefix = `${PLUGIN_MARKER_PREFIX}${pluginId}:`;
  const keys = new Set<string>();

  try {
    for await (const comment of listAllReviewComments(octokit, prContext)) {
      if (!comment.body) continue;
      // Only dedup against comments on the current HEAD commit.
      // Old commit comments get minimized as "outdated" by GitHub,
      // so we should re-post findings on the new commit.
      if (comment.commit_id !== prContext.headSha) continue;
      const start = comment.body.indexOf(prefix);
      if (start === -1) continue;
      const keyStart = start + prefix.length;
      const end = comment.body.indexOf(' -->', keyStart);
      if (end !== -1) keys.add(comment.body.slice(keyStart, end));
    }
  } catch (error) {
    logger.warning(`Failed to fetch existing ${pluginId} plugin comments: ${error}`);
  }

  return keys;
}

/**
 * Default marker comments for the PR description stats badge.
 * Used when no sectionId is specified (backward compatible).
 */
const DESCRIPTION_START_MARKER = '<!-- lien-stats -->';
const DESCRIPTION_END_MARKER = '<!-- /lien-stats -->';

/**
 * Build start/end marker pair for a given section.
 * When sectionId is provided, uses `<!-- lien:{sectionId} -->` format.
 * When omitted, uses the legacy `<!-- lien-stats -->` markers.
 */
function sectionMarkers(sectionId?: string): { start: string; end: string } {
  if (sectionId) {
    return {
      start: `<!-- lien:${sectionId} -->`,
      end: `<!-- /lien:${sectionId} -->`,
    };
  }
  return { start: DESCRIPTION_START_MARKER, end: DESCRIPTION_END_MARKER };
}

/** Remove all occurrences of a marker-delimited section from text. */
function stripSection(text: string, startMarker: string, endMarker: string): string {
  let result = text;
  let changed = false;

  for (;;) {
    const startIdx = result.indexOf(startMarker);
    if (startIdx === -1) break;

    const endIdx = result.indexOf(endMarker, startIdx + startMarker.length);
    if (endIdx === -1) break;

    result = result.slice(0, startIdx) + result.slice(endIdx + endMarker.length);
    changed = true;
  }

  return changed ? result.replace(/\n{3,}/g, '\n\n') : text;
}

/**
 * Update the PR description with a stats badge or plugin section.
 * Appends or replaces the section at the bottom of the description.
 *
 * @param sectionId - Optional section identifier for per-plugin markers.
 *   When provided, uses `<!-- lien:{sectionId} -->` / `<!-- /lien:{sectionId} -->`.
 *   When omitted, uses the default `<!-- lien-stats -->` markers (backward compat).
 * @returns true on a successful update, false on failure — never rejects (an
 *   action shouldn't fail just because the description couldn't be updated),
 *   but callers that need to know whether the write actually landed (e.g. the
 *   delivery attestation) can check the return value instead of assuming success.
 */
export async function updatePRDescription(
  octokit: Octokit,
  prContext: PRContext,
  badgeMarkdown: string,
  logger: Logger,
  sectionId?: string,
): Promise<boolean> {
  try {
    // Get current PR
    const { data: pr } = await octokit.pulls.get({
      owner: prContext.owner,
      repo: prContext.repo,
      pull_number: prContext.pullNumber,
    });

    let currentBody = pr.body || '';

    // Clean up old per-plugin summary markers (migrated to unified section)
    currentBody = stripSection(currentBody, '<!-- lien:summary -->', '<!-- /lien:summary -->');

    const { start: startMarker, end: endMarker } = sectionMarkers(sectionId);
    const wrappedBadge = `${startMarker}\n${badgeMarkdown}\n${endMarker}`;

    let newBody: string;

    // Check if we already have this section
    const startIdx = currentBody.indexOf(startMarker);
    const endIdx = currentBody.indexOf(endMarker);

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      // Replace existing section
      newBody =
        currentBody.slice(0, startIdx) +
        wrappedBadge +
        currentBody.slice(endIdx + endMarker.length);
      logger.info(`Updating existing ${sectionId ?? 'stats'} section in PR description`);
    } else {
      // Append to end
      newBody = currentBody.trim() + '\n\n---\n\n' + wrappedBadge;
      logger.info(`Adding ${sectionId ?? 'stats'} section to PR description`);
    }

    // Update the PR
    await octokit.pulls.update({
      owner: prContext.owner,
      repo: prContext.repo,
      pull_number: prContext.pullNumber,
      body: newBody,
    });

    logger.info(`PR description updated with ${sectionId ?? 'complexity stats'}`);
    return true;
  } catch (error) {
    // Don't fail the action if we can't update the description
    logger.warning(`Failed to update PR description: ${error}`);
    return false;
  }
}

/**
 * Remove a marker-delimited section from the PR description, if present.
 * Used to clear a stale badge (e.g. the degraded-attestation notice) once a
 * rerun no longer needs it — see `postAttestationBadgeIfDegraded`'s
 * delivered-verdict path in review-pr.ts. A no-op (no API call) when the
 * section isn't in the current body, so a normal run that never posted the
 * badge doesn't touch the description at all.
 */
export async function removePRDescriptionSection(
  octokit: Octokit,
  prContext: PRContext,
  sectionId: string,
  logger: Logger,
): Promise<boolean> {
  try {
    const { data: pr } = await octokit.pulls.get({
      owner: prContext.owner,
      repo: prContext.repo,
      pull_number: prContext.pullNumber,
    });
    const currentBody = pr.body || '';
    const { start: startMarker, end: endMarker } = sectionMarkers(sectionId);
    if (!currentBody.includes(startMarker)) return true;

    const newBody = stripSection(currentBody, startMarker, endMarker);
    await octokit.pulls.update({
      owner: prContext.owner,
      repo: prContext.repo,
      pull_number: prContext.pullNumber,
      body: newBody,
    });
    logger.info(`Removed stale ${sectionId} section from PR description`);
    return true;
  } catch (error) {
    logger.warning(`Failed to remove ${sectionId} section from PR description: ${error}`);
    return false;
  }
}

/**
 * Parse unified diff patch to extract line numbers that can receive comments
 * Exported for testing
 */
export function parsePatchLines(patch: string): Set<number> {
  const lines = new Set<number>();
  let currentLine = 0;

  for (const patchLine of patch.split('\n')) {
    // Hunk header: @@ -start,count +start,count @@
    const hunkMatch = patchLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      currentLine = parseInt(hunkMatch[1], 10);
      continue;
    }

    // Added or context line (can have comments)
    if (patchLine.startsWith('+') || patchLine.startsWith(' ')) {
      if (!patchLine.startsWith('+++')) {
        lines.add(currentLine);
        currentLine++;
      }
    }
    // Deleted lines (-) don't increment currentLine
  }

  return lines;
}

/**
 * Get lines that are in the PR diff (only these can have line comments).
 * Handles pagination for PRs with 100+ files.
 */
export async function getPRDiffLines(
  octokit: Octokit,
  prContext: PRContext,
): Promise<Map<string, Set<number>>> {
  const { diffLines } = await getPRPatchData(octokit, prContext);
  return diffLines;
}

/**
 * Result of getPRPatchData — combines diff lines with raw patch text
 */
export interface PRPatchData {
  diffLines: Map<string, Set<number>>;
  patches: Map<string, string>;
}

/**
 * Get both diff lines and raw patch text in a single API traversal.
 * More efficient than calling getPRDiffLines separately when patch data is also needed.
 */
export async function getPRPatchData(octokit: Octokit, prContext: PRContext): Promise<PRPatchData> {
  const diffLines = new Map<string, Set<number>>();
  const patches = new Map<string, string>();

  const iterator = octokit.paginate.iterator(octokit.pulls.listFiles, {
    owner: prContext.owner,
    repo: prContext.repo,
    pull_number: prContext.pullNumber,
    per_page: 100,
  });

  for await (const response of iterator) {
    for (const file of response.data) {
      if (!file.patch) continue;

      patches.set(file.filename, file.patch);
      const lines = parsePatchLines(file.patch);
      if (lines.size > 0) {
        diffLines.set(file.filename, lines);
      }
    }
  }

  return { diffLines, patches };
}

// ---------------------------------------------------------------------------
// Comment Minimization
// ---------------------------------------------------------------------------

/**
 * Find and minimize (hide as "outdated") PR review comments matching a marker string.
 * Searches both PR reviews (created via postPRReview) and issue comments.
 * Uses the GraphQL `minimizeComment` mutation.
 */
export async function minimizeOutdatedComments(
  octokit: Octokit,
  prContext: PRContext,
  marker: string,
  logger: Logger,
): Promise<number> {
  let minimized = 0;

  try {
    // PR reviews (posted via pulls.createReview / postPRReview)
    const reviews = await octokit.pulls.listReviews({
      owner: prContext.owner,
      repo: prContext.repo,
      pull_number: prContext.pullNumber,
    });

    for (const review of reviews.data) {
      if (!review.body?.includes(marker)) continue;

      try {
        await minimizeViaGraphQL(octokit, review.node_id);
        minimized++;
      } catch (err) {
        logger.warning(
          `Failed to minimize review ${review.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  } catch (err) {
    logger.warning(
      `Failed to list reviews for minimization: ${err instanceof Error ? err.message : err}`,
    );
  }

  return minimized;
}

async function minimizeViaGraphQL(octokit: Octokit, nodeId: string): Promise<void> {
  await octokit.graphql(
    `mutation($id: ID!, $classifier: ReportedContentClassifiers!) {
      minimizeComment(input: { subjectId: $id, classifier: $classifier }) {
        minimizedComment { isMinimized }
      }
    }`,
    { id: nodeId, classifier: 'OUTDATED' },
  );
}
