/**
 * Tests for github.ts utility functions
 */

import { describe, it, expect } from 'vitest';
import { parsePatchLines } from '../src/github.js';

describe('parsePatchLines', () => {
  it('parses a simple single-hunk diff', () => {
    const patch = `@@ -1,3 +1,4 @@
 line 1
 line 2
+new line
 line 3`;

    const lines = parsePatchLines(patch);
    
    expect(lines.has(1)).toBe(true);  // context line
    expect(lines.has(2)).toBe(true);  // context line
    expect(lines.has(3)).toBe(true);  // added line
    expect(lines.has(4)).toBe(true);  // context line
    expect(lines.size).toBe(4);
  });

  it('parses a diff with only additions', () => {
    const patch = `@@ -0,0 +1,3 @@
+line 1
+line 2
+line 3`;

    const lines = parsePatchLines(patch);
    
    expect(lines.has(1)).toBe(true);
    expect(lines.has(2)).toBe(true);
    expect(lines.has(3)).toBe(true);
    expect(lines.size).toBe(3);
  });

  it('handles deleted lines correctly (no increment)', () => {
    const patch = `@@ -1,4 +1,3 @@
 line 1
-deleted line
 line 2
 line 3`;

    const lines = parsePatchLines(patch);
    
    // Lines should be 1, 2, 3 (deleted line doesn't affect numbering)
    expect(lines.has(1)).toBe(true);
    expect(lines.has(2)).toBe(true);
    expect(lines.has(3)).toBe(true);
    expect(lines.size).toBe(3);
  });

  it('parses multiple hunks', () => {
    const patch = `@@ -1,3 +1,4 @@
 line 1
+added at top
 line 2
 line 3
@@ -10,3 +11,4 @@
 line 10
+added in middle
 line 11
 line 12`;

    const lines = parsePatchLines(patch);
    
    // First hunk: lines 1-4
    expect(lines.has(1)).toBe(true);
    expect(lines.has(2)).toBe(true);
    expect(lines.has(3)).toBe(true);
    expect(lines.has(4)).toBe(true);
    
    // Second hunk: lines 11-14
    expect(lines.has(11)).toBe(true);
    expect(lines.has(12)).toBe(true);
    expect(lines.has(13)).toBe(true);
    expect(lines.has(14)).toBe(true);
  });

  it('ignores file header lines (+++ and ---)', () => {
    // Note: In GitHub's patch format, +++ lines usually don't appear
    // in the middle of hunks, but we should handle them gracefully
    const patch = `@@ -1,2 +1,3 @@
 existing
+new line
 another`;

    const lines = parsePatchLines(patch);
    
    // Should have lines 1, 2, 3
    expect(lines.has(1)).toBe(true);
    expect(lines.has(2)).toBe(true);
    expect(lines.has(3)).toBe(true);
    expect(lines.size).toBe(3);
  });

  it('handles hunk with only context (no changes)', () => {
    const patch = `@@ -5,3 +5,3 @@
 context 1
 context 2
 context 3`;

    const lines = parsePatchLines(patch);
    
    expect(lines.has(5)).toBe(true);
    expect(lines.has(6)).toBe(true);
    expect(lines.has(7)).toBe(true);
    expect(lines.size).toBe(3);
  });

  it('handles empty patch', () => {
    const patch = '';
    const lines = parsePatchLines(patch);
    expect(lines.size).toBe(0);
  });

  it('handles hunk header with function context', () => {
    // GitHub often includes function context after @@
    const patch = `@@ -10,5 +10,6 @@ function example() {
 line 10
 line 11
+new line
 line 12
 line 13
 line 14`;

    const lines = parsePatchLines(patch);
    
    expect(lines.has(10)).toBe(true);
    expect(lines.has(11)).toBe(true);
    expect(lines.has(12)).toBe(true);
    expect(lines.has(13)).toBe(true);
    expect(lines.has(14)).toBe(true);
    expect(lines.has(15)).toBe(true);
    expect(lines.size).toBe(6);
  });

  it('handles mixed additions and deletions', () => {
    const patch = `@@ -1,5 +1,5 @@
 line 1
-old line 2
+new line 2
 line 3
-old line 4
+new line 4
 line 5`;

    const lines = parsePatchLines(patch);
    
    // Result should be lines 1, 2, 3, 4, 5 in the new file
    expect(lines.has(1)).toBe(true);
    expect(lines.has(2)).toBe(true);  // new line 2
    expect(lines.has(3)).toBe(true);
    expect(lines.has(4)).toBe(true);  // new line 4
    expect(lines.has(5)).toBe(true);
    expect(lines.size).toBe(5);
  });
});

