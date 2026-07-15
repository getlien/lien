/**
 * End-to-end `reviewPullRequest` coverage for the attestation's `scope`
 * field — the exact ambiguity that let #572/#754 through (a full-repo
 * complexity scan misattributed as PR-scoped). Only the clone and GitHub API
 * boundary are mocked; complexity analysis runs for real against a temp
 * checkout so the eligibility-path branching is exercised, not re-described.
 */
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { silentLogger } from '../src/test-helpers.js';
import type { ReviewCoreContext } from '../src/review-pr.js';

const { cloneBySha } = vi.hoisted(() => ({ cloneBySha: vi.fn() }));
vi.mock('../src/clone.js', () => ({ cloneBySha }));

const githubApi = vi.hoisted(() => ({
  getPRChangedFiles: vi.fn(),
  getPRPatchData: vi.fn(async () => ({ patches: new Map(), diffLines: new Map() })),
  updatePRDescription: vi.fn(async () => true),
  removePRDescriptionSection: vi.fn(async () => true),
}));
vi.mock('../src/github-api.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/github-api.js')>();
  return { ...actual, ...githubApi };
});

const { reviewPullRequest } = await import('../src/review-pr.js');

async function makeCheckout(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'lien-review-pr-test-'));
  await writeFile(
    join(dir, 'foo.ts'),
    'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
    'utf8',
  );
  return { dir, cleanup: async () => rm(dir, { recursive: true, force: true }) };
}

function baseCtx(overrides?: Partial<ReviewCoreContext>): ReviewCoreContext {
  return {
    octokit: {} as ReviewCoreContext['octokit'],
    pr: {
      owner: 'o',
      repo: 'r',
      pullNumber: 1,
      title: 'Test PR',
      baseSha: 'base-sha',
      headSha: 'head-sha',
    },
    headRepoFullName: 'o/r',
    baseRepoFullName: 'o/r',
    token: 'tok',
    config: {
      threshold: '15',
      blockOnNewErrors: false,
      reviewTypes: { complexity: true, summary: false, architectural: false, bugs: false },
    },
    llm: null,
    logger: silentLogger,
    ...overrides,
  };
}

describe('reviewPullRequest — scope.eligibilityPath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    githubApi.getPRPatchData.mockResolvedValue({ patches: new Map(), diffLines: new Map() });
    githubApi.updatePRDescription.mockResolvedValue(true);
    githubApi.removePRDescriptionSection.mockResolvedValue(true);
  });

  it('is "zero_files_early_exit" when the PR touches no analyzable files and summary is off', async () => {
    githubApi.getPRChangedFiles.mockResolvedValue(['README.md']);
    const checkout = await makeCheckout();
    cloneBySha.mockResolvedValueOnce(checkout);

    const result = await reviewPullRequest(baseCtx());

    expect(result.attestation.scope.eligibilityPath).toBe('zero_files_early_exit');
    expect(result.attestation.verdict).toBe('delivered');
    expect(cloneBySha).toHaveBeenCalledTimes(1); // only the head clone — base is never attempted
    await checkout.cleanup();
  });

  it('is "full_repo_fallback" when the PR touches no analyzable files but summary is on', async () => {
    githubApi.getPRChangedFiles.mockResolvedValue(['README.md']);
    const checkout = await makeCheckout();
    cloneBySha.mockResolvedValueOnce(checkout);

    const result = await reviewPullRequest(
      baseCtx({
        config: {
          threshold: '15',
          blockOnNewErrors: false,
          reviewTypes: { complexity: true, summary: true, architectural: false, bugs: false },
        },
      }),
    );

    expect(result.attestation.scope.eligibilityPath).toBe('full_repo_fallback');
    await checkout.cleanup();
  });

  it('is "normal" when the PR touches analyzable files', async () => {
    githubApi.getPRChangedFiles.mockResolvedValue(['foo.ts']);
    const headCheckout = await makeCheckout();
    cloneBySha.mockResolvedValueOnce(headCheckout);
    // Base clone: reject — runAnalysisPhase swallows this into baselineReport:null.
    cloneBySha.mockRejectedValueOnce(new Error('base clone skipped in test'));

    const result = await reviewPullRequest(baseCtx());

    expect(result.attestation.scope.eligibilityPath).toBe('normal');
    expect(result.attestation.scope.filesAnalyzed).toBe(1);
    await headCheckout.cleanup();
  });
});
