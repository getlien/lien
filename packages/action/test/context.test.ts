import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { buildContextFromEvent, type PullRequestEvent } from '../src/context.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadFixture(): Promise<PullRequestEvent> {
  const raw = await readFile(join(__dirname, 'fixtures', 'event.json'), 'utf8');
  return JSON.parse(raw) as PullRequestEvent;
}

describe('buildContextFromEvent', () => {
  it('maps owner/repo from GITHUB_REPOSITORY', async () => {
    const event = await loadFixture();
    const ctx = buildContextFromEvent(event, 'getlien/lien');
    expect(ctx.pr.owner).toBe('getlien');
    expect(ctx.pr.repo).toBe('lien');
    expect(ctx.baseRepoFullName).toBe('getlien/lien');
  });

  it('uses head SHA from the event, NOT the merge commit', async () => {
    const event = await loadFixture();
    const ctx = buildContextFromEvent(event, 'getlien/lien');
    // The critical correctness point: headSha is event.pull_request.head.sha.
    expect(ctx.pr.headSha).toBe(event.pull_request.head.sha);
    expect(ctx.pr.headSha).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(ctx.pr.baseSha).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  });

  it('maps PR number, title, and body', async () => {
    const event = await loadFixture();
    const ctx = buildContextFromEvent(event, 'getlien/lien');
    expect(ctx.pr.pullNumber).toBe(42);
    expect(ctx.pr.title).toBe('Add caching layer to the indexer');
    expect(ctx.pr.body).toContain('LRU cache');
  });

  it('maps head/base refs', async () => {
    const event = await loadFixture();
    const ctx = buildContextFromEvent(event, 'getlien/lien');
    expect(ctx.headRef).toBe('feature/cache');
    expect(ctx.baseRef).toBe('main');
  });

  it('derives fork head-repo from event.pull_request.head.repo.full_name', async () => {
    const event = await loadFixture();
    const ctx = buildContextFromEvent(event, 'getlien/lien');
    // Fork PR: head repo differs from base repo, and the fork flag is surfaced.
    expect(ctx.headRepoFullName).toBe('octocat/lien-fork');
    expect(ctx.isFork).toBe(true);
  });

  it('falls back to GITHUB_REPOSITORY when head.repo is absent (same-repo PR)', async () => {
    const event = await loadFixture();
    event.pull_request.head.repo = null;
    const ctx = buildContextFromEvent(event, 'getlien/lien');
    expect(ctx.headRepoFullName).toBe('getlien/lien');
    expect(ctx.isFork).toBe(false);
  });

  it('maps null body to undefined', async () => {
    const event = await loadFixture();
    event.pull_request.body = null;
    const ctx = buildContextFromEvent(event, 'getlien/lien');
    expect(ctx.pr.body).toBeUndefined();
  });

  it('throws on a malformed GITHUB_REPOSITORY', async () => {
    const event = await loadFixture();
    expect(() => buildContextFromEvent(event, 'no-slash')).toThrow(/owner\/repo/);
  });
});
