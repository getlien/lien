import { describe, it, expect } from 'vitest';

import { parsePatchLines, parseUnifiedDiff } from './unified-diff.js';

describe('parsePatchLines', () => {
  it('collects context and added lines, skipping deleted lines', () => {
    const patch = [
      '@@ -10,3 +10,4 @@ function foo() {',
      ' context1',
      '+added1',
      ' context2',
      '-removed1',
      ' context3',
    ].join('\n');

    expect(parsePatchLines(patch)).toEqual(new Set([10, 11, 12, 13]));
  });

  it('resets the line counter at each hunk header', () => {
    const patch = ['@@ -1,2 +1,2 @@', '+line1', ' line2', '@@ -20,1 +21,1 @@', '+line3'].join('\n');

    expect(parsePatchLines(patch)).toEqual(new Set([1, 2, 21]));
  });

  it('ignores the "+++ b/file" header line instead of counting it as line 0', () => {
    const patch = ['--- a/file.ts', '+++ b/file.ts', '@@ -1,1 +1,2 @@', ' context', '+added'].join(
      '\n',
    );

    expect(parsePatchLines(patch)).toEqual(new Set([1, 2]));
  });
});

describe('parseUnifiedDiff', () => {
  const DIFF_HEADER = 'diff --git ';

  it('splits a multi-file diff by file, keeping each patch and its lines', () => {
    const diff = [
      `${DIFF_HEADER}a/src/a.ts b/src/a.ts`,
      'index 111..222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,1 +1,2 @@',
      ' keep',
      '+added',
      `${DIFF_HEADER}a/src/b.ts b/src/b.ts`,
      'index 333..444 100644',
      '--- a/src/b.ts',
      '+++ b/src/b.ts',
      '@@ -10,1 +10,1 @@',
      '+changed',
    ].join('\n');

    const { patches, diffLines } = parseUnifiedDiff(diff);

    expect([...patches.keys()]).toEqual(['src/a.ts', 'src/b.ts']);
    expect(diffLines.get('src/a.ts')).toEqual(new Set([1, 2]));
    expect(diffLines.get('src/b.ts')).toEqual(new Set([10]));
  });

  it('re-attaches the separator the split consumed', () => {
    const diff = [
      `${DIFF_HEADER}a/x.ts b/x.ts`,
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1,1 +1,1 @@',
      '+one',
    ].join('\n');

    expect(parseUnifiedDiff(diff).patches.get('x.ts')).toBe(
      `${DIFF_HEADER}a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1,1 +1,1 @@\n+one`,
    );
  });

  // A filename with a space has no unambiguous split in the block header, whose
  // only separator is ` b/`. Taking the path from `+++` avoids the problem.
  it('handles a filename containing a space', () => {
    const diff = [
      `${DIFF_HEADER}a/src/my file.ts b/src/my file.ts`,
      '--- a/src/my file.ts',
      '+++ b/src/my file.ts',
      '@@ -1,1 +1,1 @@',
      '+x',
    ].join('\n');

    expect([...parseUnifiedDiff(diff).patches.keys()]).toEqual(['src/my file.ts']);
  });

  // A deletion must be present-but-empty, not absent: a caller has to be able
  // to tell "deleted" from "not in this diff".
  it('records a deleted file with an empty line set rather than dropping it', () => {
    const diff = [
      `${DIFF_HEADER}a/gone.ts b/gone.ts`,
      'deleted file mode 100644',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-one',
      '-two',
    ].join('\n');

    const { patches, diffLines } = parseUnifiedDiff(diff);

    expect(patches.has('gone.ts')).toBe(true);
    expect(diffLines.get('gone.ts')).toEqual(new Set());
  });

  it('takes the post-image path for a rename', () => {
    const diff = [
      `${DIFF_HEADER}a/old/name.ts b/new/name.ts`,
      'similarity index 98%',
      'rename from old/name.ts',
      'rename to new/name.ts',
      '--- a/old/name.ts',
      '+++ b/new/name.ts',
      '@@ -1,1 +1,1 @@',
      '+x',
    ].join('\n');

    expect([...parseUnifiedDiff(diff).patches.keys()]).toEqual(['new/name.ts']);
  });

  it('falls back to the block header when there is no +++ line (binary file)', () => {
    const diff = [
      `${DIFF_HEADER}a/logo.png b/logo.png`,
      'index 555..666 100644',
      'Binary files a/logo.png and b/logo.png differ',
    ].join('\n');

    const { patches, diffLines } = parseUnifiedDiff(diff);

    expect([...patches.keys()]).toEqual(['logo.png']);
    expect(diffLines.get('logo.png')).toEqual(new Set());
  });

  it('returns empty maps for an empty diff', () => {
    const { patches, diffLines } = parseUnifiedDiff('');

    expect(patches.size).toBe(0);
    expect(diffLines.size).toBe(0);
  });

  it('ignores leading noise before the first file block', () => {
    const diff = [
      'commit deadbeef',
      'Author: someone',
      '',
      `${DIFF_HEADER}a/x.ts b/x.ts`,
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1,1 +1,1 @@',
      '+x',
    ].join('\n');

    expect([...parseUnifiedDiff(diff).patches.keys()]).toEqual(['x.ts']);
  });
});
