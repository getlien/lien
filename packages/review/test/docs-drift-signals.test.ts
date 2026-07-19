import { describe, it, expect } from 'vitest';
import type { CodeChunk } from '@liendev/parser';
import type { ReviewContext } from '../src/plugin-types.js';
import {
  computeDocsDriftCandidates,
  classifyRawDocReferences,
  isFullFileDeletion,
  extractDeletedPaths,
} from '../src/docs-drift-signals.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function patch(...lines: string[]): string {
  return lines.join('\n');
}

function makeChunk(
  file: string,
  startLine: number,
  content: string,
  type: CodeChunk['metadata']['type'] = 'doc',
): CodeChunk {
  return {
    content,
    metadata: {
      file,
      startLine,
      endLine: startLine + content.split('\n').length - 1,
      type,
      language: 'markdown',
    },
  } as CodeChunk;
}

function makeContext(opts: {
  patches?: Map<string, string>;
  repoChunks?: CodeChunk[];
  changedFiles?: string[];
}): ReviewContext {
  const patches = opts.patches ?? new Map<string, string>();
  return {
    pr: { patches },
    repoChunks: opts.repoChunks ?? [],
    changedFiles: opts.changedFiles ?? [...patches.keys()],
    chunks: [],
  } as unknown as ReviewContext;
}

/** A hunk-only, PRODUCTION-SHAPED full-file-deletion patch: no `diff --git`/`deleted file
 *  mode`/`+++ /dev/null` header — exactly what `getPRPatchData` (octokit `pulls.listFiles`)
 *  hands every plugin in prod. */
function hunkOnlyDeletion(...removedLines: string[]): string {
  return patch(`@@ -1,${removedLines.length} +0,0 @@`, ...removedLines.map(l => `-${l}`));
}

// ---------------------------------------------------------------------------
// isFullFileDeletion
// ---------------------------------------------------------------------------

describe('isFullFileDeletion', () => {
  it('is true for a hunk-only patch whose every hunk new-side starts at 0', () => {
    expect(isFullFileDeletion(hunkOnlyDeletion('function old() {}', 'export default old;'))).toBe(
      true,
    );
  });

  it('is false when a hunk new-side start is non-zero (a partial-file edit)', () => {
    const p = patch('@@ -1,3 +1,1 @@', '-a', '-b', ' c');
    expect(isFullFileDeletion(p)).toBe(false);
  });

  it('is false when there are no hunk headers at all', () => {
    expect(isFullFileDeletion('')).toBe(false);
    expect(isFullFileDeletion('not a diff')).toBe(false);
  });

  it('is true even when a fixture carries full diff --git / deleted-file-mode headers', () => {
    const p = patch(
      'diff --git a/foo.ts b/foo.ts',
      'deleted file mode 100644',
      'index abc123..0000000',
      '--- a/foo.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-a',
      '-b',
    );
    expect(isFullFileDeletion(p)).toBe(true);
  });

  it('is false when only some hunks of a multi-hunk file zero out (not a whole-file deletion)', () => {
    const p = patch('@@ -1,2 +0,0 @@', '-a', '-b', '@@ -10,2 +8,2 @@', '-c', '-d', '+c2', '+d2');
    expect(isFullFileDeletion(p)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractDeletedPaths
// ---------------------------------------------------------------------------

describe('extractDeletedPaths', () => {
  it('groups a fully-deleted file under its package directory when the whole directory is gone', () => {
    const patches = new Map([
      ['packages/runner/src/index.ts', hunkOnlyDeletion('export function run() {}')],
    ]);
    const referands = extractDeletedPaths(patches, []);
    // Full path only — no trailing-segment alt-token (dropped: a bare segment like "runner" is
    // often a generic English word and produced false candidates on unrelated ambient prose).
    expect(referands).toEqual([{ token: 'packages/runner', kind: 'deleted-path' }]);
  });

  it('falls back to the file itself when the directory is NOT fully gone', () => {
    const patches = new Map([
      ['packages/review/src/old-helper.ts', hunkOnlyDeletion('export function oldHelper() {}')],
    ]);
    const stillThere = [
      makeChunk('packages/review/src/other.ts', 1, 'export const x = 1;', 'block'),
    ];
    const referands = extractDeletedPaths(patches, stillThere);
    expect(referands).toEqual([
      { token: 'packages/review/src/old-helper.ts', kind: 'deleted-path' },
    ]);
  });

  it('a root-level deleted file is its own referand (no path grouping possible)', () => {
    const patches = new Map([['README-old.md', hunkOnlyDeletion('# Old readme')]]);
    const referands = extractDeletedPaths(patches, []);
    expect(referands).toEqual([{ token: 'README-old.md', kind: 'deleted-path' }]);
  });

  it('returns [] when no patch is a full-file deletion', () => {
    const patches = new Map([
      ['src/a.ts', patch('@@ -1,1 +1,1 @@', '-const a = 1;', '+const a = 2;')],
    ]);
    expect(extractDeletedPaths(patches, [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// computeDocsDriftCandidates — positives
// ---------------------------------------------------------------------------

describe('computeDocsDriftCandidates — positives', () => {
  it('fires Tier-1 (behavioral-claim) on a removed export named in an untouched claim line', () => {
    const patches = new Map([
      ['src/util.ts', patch('@@ -1,1 +0,0 @@', '-export function oldFunc() {}')],
    ]);
    const repoChunks = [
      makeChunk('docs/util-guide.md', 10, 'The `oldFunc` helper requires a valid config object.'),
    ];
    const ctx = makeContext({ patches, repoChunks });

    const candidates = computeDocsDriftCandidates(ctx);
    expect(candidates).toEqual([
      expect.objectContaining({
        referand: 'oldFunc',
        referandKind: 'removed-export',
        docFile: 'docs/util-guide.md',
        docLine: 10,
        positionTier: 'behavioral-claim',
      }),
    ]);
  });

  it(
    'fires Tier-2 (structural-mention) on a deleted directory named in an untouched structure ' +
      'bullet, discovered via a PRODUCTION-SHAPED hunk-only patch (no diff headers)',
    () => {
      const patches = new Map([
        ['packages/runner/src/index.ts', hunkOnlyDeletion('export function run() {}')],
      ]);
      const repoChunks = [
        makeChunk(
          'CLAUDE.md',
          40,
          '- `packages/runner` — internal build runner package used by CI',
        ),
      ];
      const ctx = makeContext({ patches, repoChunks });

      const candidates = computeDocsDriftCandidates(ctx);
      expect(candidates).toEqual([
        expect.objectContaining({
          referand: 'packages/runner',
          referandKind: 'deleted-path',
          docFile: 'CLAUDE.md',
          docLine: 40,
          positionTier: 'structural-mention',
        }),
      ]);
    },
  );

  it(
    'fires a deleted-path/structural-mention candidate on an untouched bullet that ALSO cites an ' +
      'unrelated ADR link on the same line (regression: link suppression is narrow — only the ' +
      "referand's own occurrence inside a link span suppresses, not merely a link ANYWHERE on the line)",
    () => {
      const patches = new Map([
        ['packages/runner/src/index.ts', hunkOnlyDeletion('export function run() {}')],
      ]);
      const repoChunks = [
        makeChunk(
          'CLAUDE.md',
          40,
          '- `platform/` and `packages/runner` — hosted-platform remnants (see ' +
            '[ADR-012](docs/architecture/decisions/0012-self-hostable-review-action.md)); safe to ignore.',
        ),
      ];
      const ctx = makeContext({ patches, repoChunks });

      const candidates = computeDocsDriftCandidates(ctx);
      const runnerCandidate = candidates.find(c => c.referand === 'packages/runner');
      expect(runnerCandidate).toEqual(
        expect.objectContaining({
          referand: 'packages/runner',
          referandKind: 'deleted-path',
          docFile: 'CLAUDE.md',
          docLine: 40,
          positionTier: 'structural-mention',
        }),
      );
    },
  );

  it('fires on a renamed identifier (mapping.from) named in an untouched claim line', () => {
    const patches = new Map(
      Array.from({ length: 5 }, (_, i) => [
        `src/a${i}.ts`,
        patch('@@ -1,1 +1,1 @@', '-const oldWidget = 1;', '+const newWidget = 1;'),
      ]),
    );
    const repoChunks = [
      makeChunk(
        'docs/widgets.md',
        3,
        'The `oldWidget` component is required for legacy rendering.',
      ),
    ];
    const ctx = makeContext({ patches, repoChunks });

    const candidates = computeDocsDriftCandidates(ctx);
    expect(candidates).toEqual([
      expect.objectContaining({
        referand: 'oldWidget',
        referandKind: 'renamed-identifier',
        docFile: 'docs/widgets.md',
        docLine: 3,
        positionTier: 'behavioral-claim',
      }),
    ]);
  });
});

// ---------------------------------------------------------------------------
// computeDocsDriftCandidates — suppression negatives
// ---------------------------------------------------------------------------

describe('computeDocsDriftCandidates — suppression negatives', () => {
  const patches = new Map([
    ['src/util.ts', patch('@@ -1,1 +0,0 @@', '-export function oldFunc() {}')],
  ]);

  it('suppresses a reference inside a fenced code block', () => {
    const repoChunks = [
      makeChunk(
        'docs/util-guide.md',
        1,
        ['# Guide', '```', 'oldFunc() // example call requires nothing', '```'].join('\n'),
      ),
    ];
    const ctx = makeContext({ patches, repoChunks });
    expect(computeDocsDriftCandidates(ctx)).toEqual([]);
  });

  it('suppresses a reference in a CHANGELOG file', () => {
    const repoChunks = [
      makeChunk('CHANGELOG.md', 1, 'The `oldFunc` helper requires a config object.'),
    ];
    const ctx = makeContext({ patches, repoChunks });
    expect(computeDocsDriftCandidates(ctx)).toEqual([]);
  });

  it('suppresses a reference in a .changeset entry', () => {
    const repoChunks = [
      makeChunk('.changeset/some-change.md', 1, 'The `oldFunc` helper requires a config object.'),
    ];
    const ctx = makeContext({ patches, repoChunks });
    expect(computeDocsDriftCandidates(ctx)).toEqual([]);
  });

  it('suppresses a past-tense / historical / retirement note', () => {
    const repoChunks = [
      makeChunk('docs/util-guide.md', 1, 'The `oldFunc` helper was removed and replaced.'),
    ];
    const ctx = makeContext({ patches, repoChunks });
    expect(computeDocsDriftCandidates(ctx)).toEqual([]);
  });

  it('suppresses a reference that sits inside a markdown link target', () => {
    const repoChunks = [
      makeChunk(
        'docs/util-guide.md',
        1,
        'See [the helper](./packages/oldFunc/README.md) requires review.',
      ),
    ];
    const ctx = makeContext({ patches, repoChunks });
    expect(computeDocsDriftCandidates(ctx)).toEqual([]);
  });

  it('suppresses a deleted-path referand that sits ONLY inside a link target (narrow suppression, not blanket)', () => {
    const deletedPathPatches = new Map([
      ['packages/runner/src/index.ts', hunkOnlyDeletion('export function run() {}')],
    ]);
    const repoChunks = [
      makeChunk(
        'docs/guide.md',
        1,
        'See [the runner package](./packages/runner/README.md) for details.',
      ),
    ];
    const ctx = makeContext({ patches: deletedPathPatches, repoChunks });
    expect(computeDocsDriftCandidates(ctx)).toEqual([]);
  });

  it('excludes a doc file the PR itself touched (untouched-only sweep)', () => {
    const touchedFile = 'docs/util-guide.md';
    const patchesWithTouchedDoc = new Map(patches);
    patchesWithTouchedDoc.set(touchedFile, patch('@@ -1,1 +1,1 @@', '-old line', '+new line'));
    const repoChunks = [
      makeChunk(touchedFile, 1, 'The `oldFunc` helper requires a valid config object.'),
    ];
    const ctx = makeContext({ patches: patchesWithTouchedDoc, repoChunks });
    expect(computeDocsDriftCandidates(ctx)).toEqual([]);
  });

  it('returns [] when the PR removes/renames/deletes nothing (no referand)', () => {
    const noopPatches = new Map([
      ['src/util.ts', patch('@@ -1,1 +1,1 @@', '-const x = 1;', '+const x = 2;')],
    ]);
    const repoChunks = [
      makeChunk('docs/guide.md', 1, 'This mentions oldFunc but nothing removed.'),
    ];
    const ctx = makeContext({ patches: noopPatches, repoChunks });
    expect(computeDocsDriftCandidates(ctx)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// computeDocsDriftCandidates — boundary precision (adversarial review finding: plain \b treats
// `-`/`.` as boundaries even though they continue the same identifier/path in this codebase's
// conventions, producing false matches inside a longer, unrelated token)
// ---------------------------------------------------------------------------

describe('computeDocsDriftCandidates — boundary precision (no substring false-matches)', () => {
  it('does NOT match a deleted-path referand as a prefix of a hyphen-suffixed longer path', () => {
    const patches = new Map([
      ['packages/runner/src/index.ts', hunkOnlyDeletion('export function run() {}')],
    ]);
    const repoChunks = [
      makeChunk(
        'docs/guide.md',
        1,
        '- `packages/runner-hosted` — an unrelated package that merely shares a prefix.',
      ),
    ];
    const ctx = makeContext({ patches, repoChunks });
    expect(computeDocsDriftCandidates(ctx)).toEqual([]);
  });

  it('does NOT match a deleted-path referand as a suffix of a hyphen-prefixed longer path', () => {
    const patches = new Map([
      ['packages/runner/src/index.ts', hunkOnlyDeletion('export function run() {}')],
    ]);
    const repoChunks = [
      makeChunk(
        'docs/guide.md',
        1,
        '- `sub-packages/runner` — an unrelated package that merely shares a suffix.',
      ),
    ];
    const ctx = makeContext({ patches, repoChunks });
    expect(computeDocsDriftCandidates(ctx)).toEqual([]);
  });

  it('DOES match a deleted-path referand when followed by / (a legitimate sub-path reference)', () => {
    const patches = new Map([
      ['packages/runner/src/index.ts', hunkOnlyDeletion('export function run() {}')],
    ]);
    const repoChunks = [
      makeChunk('docs/guide.md', 1, '- `packages/runner/README.md` — see this for details.'),
    ];
    const ctx = makeContext({ patches, repoChunks });
    const candidates = computeDocsDriftCandidates(ctx);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].referand).toBe('packages/runner');
  });

  it('does NOT match a removed-export referand adjacent to a hyphen (a different identifier)', () => {
    const patches = new Map([
      ['src/util.ts', patch('@@ -1,1 +0,0 @@', '-export function fetchUser() {}')],
    ]);
    const repoChunks = [
      makeChunk('docs/guide.md', 1, 'The `my-fetchUser` helper requires a config object.'),
    ];
    const ctx = makeContext({ patches, repoChunks });
    expect(computeDocsDriftCandidates(ctx)).toEqual([]);
  });

  it('does NOT match a removed-export referand adjacent to a period (a different identifier)', () => {
    const patches = new Map([
      ['src/util.ts', patch('@@ -1,1 +0,0 @@', '-export function fetchUser() {}')],
    ]);
    const repoChunks = [
      makeChunk('docs/guide.md', 1, 'The `fetchUser.old` helper requires a config object.'),
    ];
    const ctx = makeContext({ patches, repoChunks });
    expect(computeDocsDriftCandidates(ctx)).toEqual([]);
  });

  it('still matches the exact removed-export referand surrounded by plain prose/punctuation', () => {
    const patches = new Map([
      ['src/util.ts', patch('@@ -1,1 +0,0 @@', '-export function fetchUser() {}')],
    ]);
    const repoChunks = [
      makeChunk('docs/guide.md', 1, 'The `fetchUser` helper requires a config object.'),
    ];
    const ctx = makeContext({ patches, repoChunks });
    const candidates = computeDocsDriftCandidates(ctx);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].referand).toBe('fetchUser');
  });
});

// ---------------------------------------------------------------------------
// computeDocsDriftCandidates — determinism + cap
// ---------------------------------------------------------------------------

describe('computeDocsDriftCandidates — determinism + cap', () => {
  it('caps at 15, sorted deterministically (tier, then referand, then docFile:line)', () => {
    // 4 removed exports, each named in 5 separate untouched doc files' claim lines — 20 raw
    // candidates (all Tier-1), collapsed to the 15-candidate cap.
    const patches = new Map(
      Array.from({ length: 4 }, (_, i) => [
        `src/mod${i}.ts`,
        patch('@@ -1,1 +0,0 @@', `-export function oldFunc${i}() {}`),
      ]),
    );
    const repoChunks = Array.from({ length: 5 }, (_, j) =>
      makeChunk(
        `docs/notes-${j}.md`,
        1,
        Array.from({ length: 4 }, (_, i) => `The \`oldFunc${i}\` helper requires review.`).join(
          '\n',
        ),
      ),
    );
    const ctx = makeContext({ patches, repoChunks });

    const first = computeDocsDriftCandidates(ctx);
    const second = computeDocsDriftCandidates(ctx);

    expect(first).toHaveLength(15);
    expect(first).toEqual(second); // deterministic across repeated calls
    // Sorted by referand name — oldFunc0/1/2 (15 total) survive, oldFunc3 is dropped by the cap.
    expect(first.every(c => c.referand !== 'oldFunc3')).toBe(true);
    expect(new Set(first.map(c => c.referand))).toEqual(
      new Set(['oldFunc0', 'oldFunc1', 'oldFunc2']),
    );
  });
});

// ---------------------------------------------------------------------------
// classifyRawDocReferences — the census helper
// ---------------------------------------------------------------------------

describe('classifyRawDocReferences', () => {
  it('tallies suppressed vs tiered raw matches for the same referand', () => {
    const patches = new Map([
      ['src/util.ts', patch('@@ -1,1 +0,0 @@', '-export function oldFunc() {}')],
    ]);
    const repoChunks = [
      makeChunk('docs/a.md', 1, 'The `oldFunc` helper requires a config object.'), // tier1
      makeChunk('docs/b.md', 1, 'The `oldFunc` helper was removed and replaced.'), // suppressed
    ];
    const ctx = makeContext({ patches, repoChunks });

    expect(classifyRawDocReferences(ctx)).toEqual({
      total: 2,
      tier1: 1,
      tier2: 0,
      suppressed: 1,
    });
  });

  it('returns all-zero tallies when there is no referand', () => {
    const noopPatches = new Map([
      ['src/util.ts', patch('@@ -1,1 +1,1 @@', '-const x = 1;', '+const x = 2;')],
    ]);
    const ctx = makeContext({ patches: noopPatches, repoChunks: [] });
    expect(classifyRawDocReferences(ctx)).toEqual({ total: 0, tier1: 0, tier2: 0, suppressed: 0 });
  });
});
