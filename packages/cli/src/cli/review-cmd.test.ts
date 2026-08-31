import { describe, it, expect, vi, afterEach } from 'vitest';

import { renderText, toJson, reviewCommand, type ReviewResult } from './review-cmd.js';
import type { SignalReport } from './review-signals.js';

function report(overrides: Partial<SignalReport> = {}): SignalReport {
  return {
    id: 'stale-literal',
    title: 'Stale duplicate literals',
    question: 'A literal changed here — does the old value still appear elsewhere?',
    candidates: [],
    ...overrides,
  };
}

function result(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    base: 'HEAD',
    reports: [],
    changedFiles: ['src/a.ts'],
    unexamined: { untracked: [], nonAnalyzable: [], testsExcluded: 0 },
    repoScanned: true,
    durationMs: 12,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe('renderText', () => {
  // The whole point of the command's honesty contract: an empty diff must not
  // read like a clean review.
  it('says nothing was analyzed when there are no changes, not "clean"', () => {
    const out = renderText(result({ changedFiles: [] }));

    expect(out).toContain('No changes against HEAD');
    expect(out).toContain('this is not a clean review, it is an empty one');
    expect(out).not.toMatch(/\bclean\b(?!\s+review)/);
  });

  it('names the base ref it compared against', () => {
    const out = renderText(result({ base: 'origin/main' }));
    expect(out).toContain('vs origin/main');
  });

  // Three empty states, and conflating any two is a lie. Telling someone who
  // just changed four test files "no changes against HEAD — make a change" is
  // worse than an empty report: it sends them after the wrong problem.
  it('does NOT claim "no changes" when the diff was all test files', () => {
    const out = renderText(
      result({
        changedFiles: [],
        unexamined: { untracked: [], nonAnalyzable: [], testsExcluded: 4 },
      }),
    );

    expect(out).not.toContain('No changes against');
    expect(out).toContain('nothing reviewable');
    expect(out).toContain('4 changed test file(s)');
    expect(out).toContain('--include-tests');
  });

  it('does NOT claim "no changes" when the diff was all non-analyzable files', () => {
    const out = renderText(
      result({
        changedFiles: [],
        unexamined: { untracked: [], nonAnalyzable: ['vendor/x.bin'], testsExcluded: 0 },
      }),
    );

    expect(out).not.toContain('No changes against');
    expect(out).toContain('nothing reviewable');
    expect(out).toContain('1 changed file(s) the parser cannot analyze');
  });

  it('distinguishes an empty diff from a diff with nothing reviewable', () => {
    const empty = renderText(
      result({
        changedFiles: [],
        unexamined: { untracked: [], nonAnalyzable: [], testsExcluded: 0 },
      }),
    );
    const unreviewable = renderText(
      result({
        changedFiles: [],
        unexamined: { untracked: [], nonAnalyzable: [], testsExcluded: 1 },
      }),
    );

    expect(empty).toContain('No changes against HEAD');
    expect(unreviewable).not.toBe(empty);
  });

  it('renders a candidate with file and line', () => {
    const out = renderText(
      result({
        reports: [
          report({
            candidates: [{ file: 'src/a.ts', line: 42, detail: 'something worth a look' }],
          }),
        ],
      }),
    );

    expect(out).toContain('src/a.ts:42');
    expect(out).toContain('something worth a look');
    expect(out).toContain('Stale duplicate literals  (1)');
  });

  it('omits the line when a candidate has none, rather than printing undefined', () => {
    const out = renderText(
      result({ reports: [report({ candidates: [{ file: 'src/a.ts', detail: 'file-level' }] })] }),
    );

    expect(out).toContain('src/a.ts');
    expect(out).not.toContain('undefined');
    expect(out).not.toContain('src/a.ts:');
  });

  it('prints the question so a reader can judge relevance', () => {
    const out = renderText(
      result({ reports: [report({ candidates: [{ file: 'a.ts', detail: 'x' }] })] }),
    );
    expect(out).toContain('does the old value still appear elsewhere?');
  });

  // "Found nothing" and "could not look" are the same shape unless the
  // constraint is stated, which is this repo's index-state-honesty rule applied
  // to a command with no index.
  it('reports a limitation on a signal that found nothing', () => {
    const out = renderText(
      result({
        reports: [report({ candidates: [], limitation: 'Needs the repo-wide scan.' })],
      }),
    );

    expect(out).toContain('Signals that ran constrained:');
    expect(out).toContain('Needs the repo-wide scan.');
  });

  it('reports a limitation alongside candidates too', () => {
    const out = renderText(
      result({
        reports: [
          report({
            candidates: [{ file: 'a.ts', detail: 'x' }],
            limitation: 'TypeScript/JavaScript only.',
          }),
        ],
      }),
    );

    expect(out).toContain('Note: TypeScript/JavaScript only.');
  });

  it('says so when no signal produced a candidate', () => {
    const out = renderText(result({ reports: [report(), report({ id: 'other' })] }));
    expect(out).toContain('No candidates from any signal.');
  });

  it('names untracked files as not reviewed', () => {
    const out = renderText(
      result({
        unexamined: { untracked: ['new.ts', 'other.ts'], nonAnalyzable: [], testsExcluded: 0 },
      }),
    );

    expect(out).toContain('Not examined:');
    expect(out).toContain('2 untracked file(s) were NOT reviewed');
  });

  it('names non-analyzable changed files', () => {
    const out = renderText(
      result({ unexamined: { untracked: [], nonAnalyzable: ['a.bin'], testsExcluded: 0 } }),
    );
    expect(out).toContain('1 changed file(s) are not parser-analyzable');
  });

  it('names excluded test files and how to include them', () => {
    const out = renderText(
      result({ unexamined: { untracked: [], nonAnalyzable: [], testsExcluded: 3 } }),
    );

    expect(out).toContain('3 changed test file(s) were excluded');
    expect(out).toContain('--include-tests');
  });

  it('says the cross-file signals were blinded when the repo scan was skipped', () => {
    const out = renderText(result({ repoScanned: false }));
    expect(out).toContain('--no-repo-scan was set');
  });

  it('states that it never fails a build', () => {
    const out = renderText(result());
    expect(out).toContain('never fails a build');
    expect(out).toContain('candidates for you to judge, not findings');
  });

  it('counts candidates across signals in the summary', () => {
    const out = renderText(
      result({
        reports: [
          report({
            candidates: [
              { file: 'a.ts', detail: 'x' },
              { file: 'b.ts', detail: 'y' },
            ],
          }),
          report({ id: 'other', candidates: [{ file: 'c.ts', detail: 'z' }] }),
        ],
      }),
    );

    expect(out).toContain('3 candidate(s) across 2 signal(s)');
  });
});

describe('toJson', () => {
  it('emits every signal, including ones with no candidates', () => {
    const parsed = JSON.parse(
      toJson(
        result({
          reports: [
            report({ candidates: [{ file: 'a.ts', line: 1, detail: 'x' }] }),
            report({ id: 'quiet', candidates: [] }),
          ],
        }),
      ),
    );

    expect(parsed.signals).toHaveLength(2);
    expect(parsed.signals[1].id).toBe('quiet');
    expect(parsed.signals[1].candidates).toEqual([]);
  });

  it('carries the limitation as null rather than omitting the key', () => {
    const parsed = JSON.parse(toJson(result({ reports: [report()] })));
    expect(parsed.signals[0].limitation).toBeNull();
  });

  it('carries repoScanned and the unexamined counts', () => {
    const parsed = JSON.parse(
      toJson(
        result({
          repoScanned: false,
          unexamined: { untracked: ['x.ts'], nonAnalyzable: [], testsExcluded: 2 },
        }),
      ),
    );

    expect(parsed.repoScanned).toBe(false);
    expect(parsed.unexamined.untracked).toEqual(['x.ts']);
    expect(parsed.unexamined.testsExcluded).toBe(2);
  });
});

describe('reviewCommand', () => {
  it('rejects an unknown format with a non-zero exit', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await reviewCommand({ format: 'yaml' });

    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.flat().join(' ')).toContain("Unknown format 'yaml'");
  });

  // An unresolvable ref is an operational failure, which exits non-zero. What
  // the signals report never does — that distinction is the command's contract.
  it('exits non-zero when the base ref cannot be resolved', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await reviewCommand({ base: 'refs/heads/definitely-not-a-real-ref-xyz' });

    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.flat().join(' ')).toContain('could not run');
  });
});
