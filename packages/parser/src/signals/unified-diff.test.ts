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

  // Git appends a TAB to the `---`/`+++` header whenever the path contains a
  // space. Left in place the extension reads as `.ts\t`, the file is judged
  // unanalyzable and silently dropped — which hit exactly the case that taking
  // the path from `+++` was supposed to fix.
  it('strips the trailing tab git adds when a path contains a space', () => {
    const diff = [
      `${DIFF_HEADER}a/sub dir/my file.ts b/sub dir/my file.ts`,
      '--- a/sub dir/my file.ts\t',
      '+++ b/sub dir/my file.ts\t',
      '@@ -1,1 +1,1 @@',
      '+x',
    ].join('\n');

    expect([...parseUnifiedDiff(diff).patches.keys()]).toEqual(['sub dir/my file.ts']);
  });

  // `core.quotePath` is ON by default, so a non-ASCII path arrives octal-escaped
  // and quoted. The escapes are per-BYTE, so they must decode to bytes and then
  // be read as UTF-8.
  it('unquotes and octal-decodes a non-ASCII path', () => {
    const diff = [
      `${DIFF_HEADER}"a/caf\\303\\251.ts" "b/caf\\303\\251.ts"`,
      '--- "a/caf\\303\\251.ts"',
      '+++ "b/caf\\303\\251.ts"',
      '@@ -1,1 +1,1 @@',
      '+x',
    ].join('\n');

    expect([...parseUnifiedDiff(diff).patches.keys()]).toEqual(['café.ts']);
  });

  it('handles a quoted path that also carries a trailing tab', () => {
    const diff = [
      `${DIFF_HEADER}"a/caf\\303\\251 dir/x.ts" "b/caf\\303\\251 dir/x.ts"`,
      '+++ "b/caf\\303\\251 dir/x.ts"\t',
      '@@ -1,1 +1,1 @@',
      '+x',
    ].join('\n');

    expect([...parseUnifiedDiff(diff).patches.keys()]).toEqual(['café dir/x.ts']);
  });

  // Without the named-escape table `\t` decoded to the LETTER `t`, so a path
  // containing a tab came out silently wrong rather than failing.
  it('decodes git C-style escapes rather than dropping the backslash', () => {
    const diff = [
      `${DIFF_HEADER}"a/we\\tird.ts" "b/we\\tird.ts"`,
      '+++ "b/we\\tird.ts"',
      '@@ -1,1 +1,1 @@',
      '+x',
    ].join('\n');

    expect([...parseUnifiedDiff(diff).patches.keys()]).toEqual(['we\tird.ts']);
  });

  it('keeps an escaped quote as a literal quote', () => {
    const diff = [
      `${DIFF_HEADER}"a/od\\"d.ts" "b/od\\"d.ts"`,
      '+++ "b/od\\"d.ts"',
      '@@ -1,1 +1,1 @@',
      '+x',
    ].join('\n');

    expect([...parseUnifiedDiff(diff).patches.keys()]).toEqual(['od"d.ts']);
  });

  // A binary or mode-only change has no `+++` line, so it depends entirely on
  // the header fallback — which could not match a QUOTED header at all, and so
  // produced no entry whatsoever for a non-ASCII binary file.
  it('falls back to a QUOTED header when there is no +++ line', () => {
    const diff = [
      `${DIFF_HEADER}"a/caf\\303\\251.png" "b/caf\\303\\251.png"`,
      'index 111..222 100644',
      'Binary files differ',
    ].join('\n');

    const { patches, diffLines } = parseUnifiedDiff(diff);

    expect([...patches.keys()]).toEqual(['café.png']);
    expect(diffLines.get('café.png')).toEqual(new Set());
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
