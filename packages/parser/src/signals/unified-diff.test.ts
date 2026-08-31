import { describe, it, expect } from 'vitest';

import { parsePatchLines } from './unified-diff.js';

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
