/**
 * GitHub output adapter.
 *
 * Handles the PR description badge and posts findings from plugins
 * that don't implement their own present() hook (custom/third-party plugins).
 * Built-in plugins (complexity, logic, architectural) use present() directly.
 */

import type { Octokit } from '@octokit/rest';
import type {
  OutputAdapter,
  AdapterResult,
  AdapterContext,
  ReviewFinding,
} from '../plugin-types.js';
import type { PRContext, LineComment } from '../types.js';
import { postPRReview, getPRPatchData, updatePRDescription } from '../github-api.js';
import { buildDescriptionBadge } from '../prompt.js';

/**
 * GitHub PR output adapter.
 * Posts the PR description badge and handles findings from custom plugins
 * that don't implement their own present() hook.
 */
export class GitHubAdapter implements OutputAdapter {
  async present(findings: ReviewFinding[], context: AdapterContext): Promise<AdapterResult> {
    const { logger } = context;
    const octokit = context.octokit as Octokit;
    const pr = context.pr;

    if (!octokit || !pr) {
      logger.warning('GitHub adapter requires octokit and PR context');
      return { posted: 0, skipped: 0, filtered: 0 };
    }

    await updatePRDescription(
      octokit,
      pr,
      buildDescriptionBadge(context.complexityReport, context.deltaSummary, context.deltas),
      logger,
    );

    if (findings.length === 0) {
      return { posted: 0, skipped: 0, filtered: 0 };
    }

    return this.postGenericReview(findings, octokit, pr, context);
  }

  /**
   * Post findings from custom/third-party plugins as generic inline comments.
   * Ensures findings from plugins without a present() hook are not silently dropped.
   */
  private async postGenericReview(
    findings: ReviewFinding[],
    octokit: Octokit,
    pr: PRContext,
    context: AdapterContext,
  ): Promise<AdapterResult> {
    const { logger } = context;
    const { diffLines } = await getPRPatchData(octokit, pr);

    const inDiff = findings.filter(f => {
      if (f.line === 0) return false;
      return diffLines.get(f.filepath)?.has(f.line);
    });

    if (inDiff.length < findings.length) {
      logger.info(
        `${findings.length - inDiff.length} custom plugin findings skipped (not in diff)`,
      );
    }

    if (inDiff.length === 0) return { posted: 0, skipped: findings.length, filtered: 0 };

    const comments: LineComment[] = inDiff.map(f => {
      const severityEmoji = f.severity === 'error' ? '🔴' : f.severity === 'warning' ? '🟡' : 'ℹ️';
      const symbolRef = f.symbolName ? ` in \`${f.symbolName}\`` : '';
      const suggestionLine = f.suggestion ? `\n\n💡 *${f.suggestion}*` : '';
      return {
        path: f.filepath,
        line: f.line,
        body: `${severityEmoji} **${f.pluginId}** — ${f.category}${symbolRef}\n\n${f.message}${suggestionLine}`,
      };
    });

    await postPRReview(
      octokit,
      pr,
      comments,
      `**${findings[0].pluginId}** — ${inDiff.length} finding${inDiff.length === 1 ? '' : 's'}. See inline comments.`,
      logger,
      'COMMENT',
    );

    return { posted: comments.length, skipped: findings.length - inDiff.length, filtered: 0 };
  }
}
