import { describe, it, expect, vi, afterEach } from 'vitest';

import { renderText, toJson, reviewCommand, type ReviewResult } from './review-cmd.js';
import type { SignalReport } from './review-signals.js';
import * as deltaGit from './delta-git.js';
import { NOT_A_REPO_MESSAGE } from './delta-git.js';

// Only `getRepoRoot` is stubbed; the rest of delta-git stays real, and it
// defaults to "we are in a repo" so every other test here is unaffected.
vi.mock('./delta-git.js', async importOriginal => {
  const actual = await importOriginal<typeof deltaGit>();
  return { ...actual, getRepoRoot: vi.fn(async () => '/repo') };
});

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
    unexamined: { untracked: [], nonAnalyzable: [], testsExcluded: 0, deleted: 0 },
    repoScanned: true,
    withheldSignals: [],
    allSignals: false,
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
        unexamined: { untracked: [], nonAnalyzable: [], testsExcluded: 4, deleted: 0 },
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
        unexamined: {
          untracked: [],
          nonAnalyzable: ['vendor/x.bin'],
          testsExcluded: 0,
          deleted: 0,
        },
      }),
    );

    expect(out).not.toContain('No changes against');
    expect(out).toContain('nothing reviewable');
    expect(out).toContain('1 changed file(s) the parser cannot analyze');
  });

  // A markdown-only diff parses to zero analyzable files, but the doc signals
  // read the raw patch text and can still have candidates. This renderer used
  // to assert "No signal ran, so no signal found anything" off the empty
  // analyzable set — the same false-clean shape as the three cases above, one
  // layer down, and the one that made the review skill's docs guidance wrong.
  it('reports candidates from raw-diff signals even when nothing was parser-analyzable', () => {
    const out = renderText(
      result({
        changedFiles: [],
        unexamined: {
          untracked: [],
          nonAnalyzable: ['docs/guide.md'],
          testsExcluded: 0,
          deleted: 0,
        },
        reports: [
          report({
            id: 'doc-claims',
            title: 'Documentation claims',
            candidates: [{ file: 'docs/guide.md', line: 12, detail: 'claims the old default' }],
          }),
        ],
      }),
    );

    expect(out).not.toContain('No signal ran');
    expect(out).toContain('1 candidate(s) still came from signals that read the raw diff');
    expect(out).toContain('docs/guide.md');
    expect(out).toContain('not findings');
  });

  it('still says no signal found anything when the raw-diff signals are also empty', () => {
    const out = renderText(
      result({
        changedFiles: [],
        unexamined: {
          untracked: [],
          nonAnalyzable: ['docs/guide.md'],
          testsExcluded: 0,
          deleted: 0,
        },
        reports: [report({ id: 'doc-claims', candidates: [] })],
      }),
    );

    expect(out).toContain('No signal found anything in the raw diff either');
  });

  /**
   * A deletion diff is mostly deleted files, and a deleted file has no working
   * tree content to parse. Counting them as parse FAILURES was the bug: on the
   * PR that removed `packages/review`, `lien review` reported "92 files could
   * not be parsed" — all 92 simply gone from disk, zero genuine failures. A
   * reader cannot tell that from a broken parser.
   */
  it('reports deleted files as deleted, not as parse failures', () => {
    const out = renderText(
      result({
        changedFiles: ['src/a.ts'],
        unexamined: { untracked: [], nonAnalyzable: [], testsExcluded: 0, deleted: 217 },
      }),
    );

    expect(out).toContain('217 deleted file(s) — nothing to parse, so not reviewed');
    expect(out).not.toContain('could not be parsed');
  });

  it('says nothing about deletions when the diff deletes nothing', () => {
    const out = renderText(result({ changedFiles: ['src/a.ts'] }));
    expect(out).not.toContain('deleted file(s)');
  });

  it('distinguishes an empty diff from a diff with nothing reviewable', () => {
    const empty = renderText(
      result({
        changedFiles: [],
        unexamined: { untracked: [], nonAnalyzable: [], testsExcluded: 0, deleted: 0 },
      }),
    );
    const unreviewable = renderText(
      result({
        changedFiles: [],
        unexamined: { untracked: [], nonAnalyzable: [], testsExcluded: 1, deleted: 0 },
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

  // A bare "(8)" reads as "it found 8". For a signal that truncates inside its
  // own compute function it means "it returned 8 of some number it never told
  // us" — 8 of 1,241 on one real diff. Showing a ceiling as a total is the same
  // failure as showing an empty result as a clean one.
  it('says the count is a ceiling for a signal that caps its own list', () => {
    const out = renderText(
      result({
        reports: [report({ candidates: [{ file: 'a.ts', detail: 'x' }], capped: true })],
      }),
    );

    expect(out).toContain('caps its own list');
    expect(out).not.toMatch(/Stale duplicate literals {2}\(1\)/);
  });

  it('reports the exact remainder when the signal knows it', () => {
    const out = renderText(
      result({
        reports: [report({ candidates: [{ file: 'a.ts', detail: 'x' }], omitted: 207 })],
      }),
    );

    expect(out).toContain('1 shown, 207 more not listed');
  });

  it('prints a plain count when nothing was dropped', () => {
    const out = renderText(
      result({ reports: [report({ candidates: [{ file: 'a.ts', detail: 'x' }] })] }),
    );

    expect(out).toContain('Stale duplicate literals  (1)');
    expect(out).not.toContain('not listed');
    expect(out).not.toContain('caps its own list');
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
        unexamined: {
          untracked: ['new.ts', 'other.ts'],
          nonAnalyzable: [],
          testsExcluded: 0,
          deleted: 0,
        },
      }),
    );

    expect(out).toContain('Not examined:');
    expect(out).toContain('2 untracked file(s) were NOT reviewed');
  });

  it('names non-analyzable changed files', () => {
    const out = renderText(
      result({
        unexamined: { untracked: [], nonAnalyzable: ['a.bin'], testsExcluded: 0, deleted: 0 },
      }),
    );
    expect(out).toContain('1 changed file(s) are not parser-analyzable');
  });

  it('names excluded test files and how to include them', () => {
    const out = renderText(
      result({ unexamined: { untracked: [], nonAnalyzable: [], testsExcluded: 3, deleted: 0 } }),
    );

    expect(out).toContain('3 changed test file(s) were excluded');
    expect(out).toContain('--include-tests');
  });

  it('says the cross-file signals were blinded when the repo scan was skipped', () => {
    const out = renderText(result({ repoScanned: false }));
    expect(out).toContain('--no-repo-scan was set');
  });

  // Diff content is attacker-controlled the moment you review a branch you did
  // not write. An ESC sequence reaching console.log intact can repaint the
  // terminal or forge this command's own summary (CWE-150).
  it('escapes terminal control characters in a candidate detail', () => {
    const out = renderText(
      result({
        reports: [
          report({
            candidates: [{ file: 'src/a.ts', line: 1, detail: 'before[2Kforged summary' }],
          }),
        ],
      }),
    );

    expect(out).not.toContain('');
    expect(out).not.toContain('');
    expect(out).toContain('\\x1b');
    expect(out).toContain('\\x07');
  });

  it('escapes control characters in a candidate file path too', () => {
    const out = renderText(
      result({ reports: [report({ candidates: [{ file: 'src/[31ma.ts', detail: 'x' }] })] }),
    );

    expect(out).not.toContain('');
    expect(out).toContain('\\x1b');
  });

  // Same class as the test-file case, in a third variant: untracked files were
  // not counted, so the early return hid them behind a false "no changes".
  it('does NOT claim "no changes" when the worktree holds only untracked files', () => {
    const out = renderText(
      result({
        changedFiles: [],
        unexamined: {
          untracked: ['new.ts', 'other.ts'],
          nonAnalyzable: [],
          testsExcluded: 0,
          deleted: 0,
        },
      }),
    );

    expect(out).not.toContain('No changes against');
    expect(out).toContain('nothing reviewable');
    expect(out).toContain('2 untracked file(s)');
    expect(out).toContain('git add');
  });

  // A failed parse makes every signal's silence meaningless, so it is the
  // loudest thing the report can say.
  it('says the changed files could not be parsed, and that silence proves nothing', () => {
    const out = renderText(result({ scanFailure: 'the scan produced no parseable chunks' }));

    expect(out).toContain('could not be parsed');
    expect(out).toContain('no parseable chunks');
    expect(out).toContain('silence proves nothing');
  });

  it('says the repo corpus was withheld when the repo scan failed', () => {
    const out = renderText(result({ repoScanFailure: 'the scan failed for an unreported reason' }));

    expect(out).toContain('repo-wide scan failed');
    expect(out).toContain('withheld rather than half-supplied');
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
          unexamined: { untracked: ['x.ts'], nonAnalyzable: [], testsExcluded: 2, deleted: 0 },
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

describe('--all-signals precision caveat (#1152)', () => {
  it('warns about unestablished precision when the 13 signals actually RAN', () => {
    const out = renderText(result({ allSignals: true, withheldSignals: [] }));
    expect(out).toContain('precision has never been established');
    expect(out).toContain('106');
    expect(out).toContain('rated none actionable');
  });

  it('says a short list is not a complete one, since the loud signals self-cap', () => {
    const out = renderText(result({ allSignals: true, withheldSignals: [] }));
    expect(out).toContain('cap their own lists');
    expect(out).toContain('TypeScript/JavaScript-only');
  });

  it('does not print the ran-caveat on a default run', () => {
    // The default run has its own note, on the withheld list. Printing both
    // would state the same measurement twice for opposite reasons.
    const out = renderText(result({ allSignals: false, withheldSignals: ['stale-literal'] }));
    expect(out).not.toContain('precision has never been established');
    expect(out).toContain('measured 0 useful');
  });

  it('keys off the explicit flag, not an empty withheld list', () => {
    // `withheldSignals: []` is the test fixture default and does NOT mean
    // --all-signals ran. Inferring it would have fired this caveat on every
    // existing test in this file (#1152).
    const out = renderText(result({ allSignals: false, withheldSignals: [] }));
    expect(out).not.toContain('precision has never been established');
  });
});

describe('toJson carries the caveats a machine consumer needs (#1152)', () => {
  it('says --all-signals ran, rather than leaving it to be inferred', () => {
    // The gap this closes: the renderer got an explicit `allSignals` flag
    // while the JSON path was left inferring it from an empty
    // `withheldSignals` -- so `--all-signals --format json` emitted exactly
    // what a default run emits, handing over 13 unvalidated signals'
    // candidates with no marker. SKILL.md points readers at --format json.
    const out = JSON.parse(toJson(result({ allSignals: true, withheldSignals: [] })));
    expect(out.allSignals).toBe(true);
  });

  it('distinguishes a default run in the same field', () => {
    const out = JSON.parse(
      toJson(result({ allSignals: false, withheldSignals: ['stale-literal'] })),
    );
    expect(out.allSignals).toBe(false);
  });

  it('exposes scanPartial, which only the text renderer could see before', () => {
    const out = JSON.parse(toJson(result({ scanPartial: '3 files could not be parsed' })));
    expect(out.scanPartial).toBe('3 files could not be parsed');
  });

  it('emits scanPartial as null rather than dropping the key when there is none', () => {
    // A missing key and "nothing was partial" are different statements; a
    // consumer cannot tell the field is supported if it vanishes.
    const out = JSON.parse(toJson(result({ scanPartial: undefined })));
    expect(out.scanPartial).toBeNull();
  });
});

describe('reviewCommand outside a git repository (#1150)', () => {
  it('reports the reason and exits 2, without leaking the git invocation', async () => {
    // Before: the first git call escaped as "Command failed: git ls-files
    // --others --exclude-standard -z" plus git's own fatal, at exit 1 --
    // telling the user about our flags rather than their problem, while
    // `lien delta` in the same directory already answered properly at exit 2.
    vi.mocked(deltaGit.getRepoRoot).mockResolvedValueOnce(null);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    await reviewCommand({ format: 'text' });

    expect(exitSpy).toHaveBeenCalledWith(2);
    const errs = errSpy.mock.calls.flat().join(' ');
    expect(errs).toContain(NOT_A_REPO_MESSAGE);
    expect(errs).not.toContain('Command failed');
    expect(errs).not.toContain('ls-files');
  });
});
