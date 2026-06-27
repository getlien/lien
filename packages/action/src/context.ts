/**
 * Build the {@link ReviewCoreContext} inputs from the GitHub Actions
 * environment: the `pull_request` event payload (`$GITHUB_EVENT_PATH`) plus the
 * `GITHUB_REPOSITORY` env var.
 *
 * The critical mapping is `headSha` — it MUST come from
 * `event.pull_request.head.sha`, NOT `GITHUB_SHA` (which on `pull_request` is
 * the ephemeral merge commit, not the PR head). We also surface the head repo's
 * `full_name` and `fork` flag for fork-aware cloning and the fork write guard.
 */

import { readFile } from 'node:fs/promises';

import type { PRContext } from '@liendev/review';

/** The slice of the GitHub `pull_request` event payload we consume. */
export interface PullRequestEvent {
  pull_request: {
    number: number;
    title: string;
    body?: string | null;
    head: {
      sha: string;
      ref: string;
      repo?: {
        full_name?: string;
        fork?: boolean;
      } | null;
    };
    base: {
      sha: string;
      ref: string;
    };
  };
}

export interface ActionContext {
  pr: PRContext;
  /** event.pull_request.head.repo.full_name (fork-aware), else GITHUB_REPOSITORY. */
  headRepoFullName: string;
  /** GITHUB_REPOSITORY — the repo the workflow runs in. */
  baseRepoFullName: string;
  headRef: string;
  baseRef: string;
  /** True when the PR head lives in a forked repo (write-token limitation applies). */
  isFork: boolean;
}

/**
 * Pure mapping from a parsed event payload + the `GITHUB_REPOSITORY` string to
 * an {@link ActionContext}. Kept side-effect-free so it can be unit-tested
 * against a saved `event.json` fixture.
 */
export function buildContextFromEvent(
  event: PullRequestEvent,
  githubRepository: string,
): ActionContext {
  const [owner, repo] = githubRepository.split('/');
  if (!owner || !repo) {
    throw new Error(`GITHUB_REPOSITORY must be "owner/repo", got "${githubRepository}"`);
  }

  const prEvent = event.pull_request;
  if (!prEvent) {
    throw new Error('Event payload has no pull_request — this action runs on pull_request events');
  }

  const headRepoFullName = prEvent.head.repo?.full_name || githubRepository;
  const isFork = prEvent.head.repo?.fork === true;

  const pr: PRContext = {
    owner,
    repo,
    pullNumber: prEvent.number,
    title: prEvent.title,
    body: prEvent.body ?? undefined,
    baseSha: prEvent.base.sha,
    // NOTE: head SHA from the event, NOT GITHUB_SHA (the merge commit).
    headSha: prEvent.head.sha,
  };

  return {
    pr,
    headRepoFullName,
    baseRepoFullName: githubRepository,
    headRef: prEvent.head.ref,
    baseRef: prEvent.base.ref,
    isFork,
  };
}

/**
 * Read `$GITHUB_EVENT_PATH` + `$GITHUB_REPOSITORY` from the environment and
 * build the {@link ActionContext}.
 */
export async function loadContext(): Promise<ActionContext> {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error('GITHUB_EVENT_PATH is not set — this action must run inside GitHub Actions');
  }
  const githubRepository = process.env.GITHUB_REPOSITORY;
  if (!githubRepository) {
    throw new Error('GITHUB_REPOSITORY is not set');
  }

  const raw = await readFile(eventPath, 'utf8');
  const event = JSON.parse(raw) as PullRequestEvent;
  return buildContextFromEvent(event, githubRepository);
}
