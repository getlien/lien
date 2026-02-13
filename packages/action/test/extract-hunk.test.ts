import { describe, it, expect } from 'vitest';
import { extractRelevantHunk } from '@liendev/review';

describe('extractRelevantHunk', () => {
  it('extracts added lines within range', () => {
    const patch = `@@ -1,3 +1,5 @@
 line 1
 line 2
+new line A
+new line B
 line 3`;

    const result = extractRelevantHunk(patch, 3, 4);

    expect(result).toContain('+new line A');
    expect(result).toContain('+new line B');
  });

  it('returns null when no lines overlap with range', () => {
    const patch = `@@ -1,3 +1,4 @@
 line 1
 line 2
+new line
 line 3`;

    const result = extractRelevantHunk(patch, 10, 20);

    expect(result).toBeNull();
  });

  it('returns null for empty patch', () => {
    expect(extractRelevantHunk('', 1, 10)).toBeNull();
  });

  it('includes deleted lines at the current position', () => {
    const patch = `@@ -1,4 +1,3 @@
 line 1
 line 2
-removed line
 line 3`;

    const result = extractRelevantHunk(patch, 1, 3);

    expect(result).toContain('-removed line');
    expect(result).toContain(' line 1');
  });

  it('handles multiple hunks with gaps', () => {
    const patch = `@@ -1,3 +1,4 @@
 line 1
+added early
 line 2
 line 3
@@ -10,3 +11,4 @@
 line 10
+added late
 line 11
 line 12`;

    // Only get lines from the second hunk
    const result = extractRelevantHunk(patch, 11, 13);

    expect(result).not.toContain('added early');
    expect(result).toContain('+added late');
    expect(result).toContain(' line 11');
  });

  it('handles range at exact hunk boundaries', () => {
    const patch = `@@ -1,3 +1,4 @@
 line 1
 line 2
+new line
 line 3`;

    // Range covers exactly the added line (line 3) and line 3 becomes line 4
    const result = extractRelevantHunk(patch, 1, 1);

    expect(result).toBe(' line 1');
  });

  it('excludes +++ file header lines', () => {
    const patch = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 line 1
+new line
 line 2`;

    const result = extractRelevantHunk(patch, 1, 3);

    expect(result).not.toContain('+++');
    expect(result).toContain('+new line');
  });

  it('handles context lines mixed with additions and deletions', () => {
    const patch = `@@ -5,6 +5,6 @@
 context before
-old implementation
+new implementation
 context middle
-another old line
+another new line
 context after`;

    const result = extractRelevantHunk(patch, 5, 10);

    expect(result).toContain(' context before');
    expect(result).toContain('-old implementation');
    expect(result).toContain('+new implementation');
    expect(result).toContain('-another old line');
    expect(result).toContain('+another new line');
    expect(result).toContain(' context after');
  });

  it('handles only-deletions patch within range', () => {
    const patch = `@@ -3,5 +3,3 @@
 kept line
-deleted line 1
-deleted line 2
 another kept line`;

    const result = extractRelevantHunk(patch, 3, 5);

    expect(result).toContain('-deleted line 1');
    expect(result).toContain('-deleted line 2');
    expect(result).toContain(' kept line');
  });
});
