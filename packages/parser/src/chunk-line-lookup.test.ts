import { describe, it, expect } from 'vitest';
import { findChunkLineIndex } from './chunk-line-lookup.js';

describe('findChunkLineIndex', () => {
  it('returns the arithmetic index when the chunk content starts where it claims', () => {
    const lines = ['function a() {', '  helper();', '}'];

    // Chunk starts at file line 10, so file line 11 is index 1.
    expect(findChunkLineIndex(lines, 11, 10, 'helper')).toBe(1);
  });

  it('corrects for leading lines trimmed out of the content', () => {
    // Range began at file line 10, but that line was blank and got trimmed, so
    // content[0] is really file line 11. Bare arithmetic would say index 2.
    const lines = ['import x', 'register(handler);', 'const y = 1;'];

    expect(findChunkLineIndex(lines, 12, 10, 'register')).toBe(1);
  });

  it('corrects an offset that would otherwise run past the end of the content', () => {
    const lines = ['a', 'b', 'register(handler);'];

    // Arithmetic gives 5, out of bounds for a 3-line content.
    expect(findChunkLineIndex(lines, 15, 10, 'register')).toBe(2);
  });

  it('prefers the nearest mention, and the earlier line on a tie', () => {
    const lines = ['register(a);', 'filler', 'register(b);'];

    // Guess is index 1 (no mention); index 0 and 2 are equidistant.
    expect(findChunkLineIndex(lines, 11, 10, 'register')).toBe(0);
  });

  it('falls back to the arithmetic guess when nothing nearby mentions the symbol', () => {
    const lines = ['a', 'b', 'c'];

    expect(findChunkLineIndex(lines, 11, 10, 'register')).toBe(1);
  });

  it('returns null when the guess is out of bounds and the symbol is nowhere near', () => {
    const lines = ['a', 'b', 'c'];

    expect(findChunkLineIndex(lines, 40, 10, 'register')).toBeNull();
    expect(findChunkLineIndex(lines, 1, 10, 'register')).toBeNull();
  });

  it('does not look further than five lines either side', () => {
    const lines = ['register(a);', 'x', 'x', 'x', 'x', 'x', 'x', 'x'];

    // Guess is index 7; the mention at index 0 is seven lines away.
    expect(findChunkLineIndex(lines, 17, 10, 'register')).toBe(7);
  });
});
