import { describe, it, expect } from 'vitest';
import type { CodeChunk } from '@liendev/parser';
import { computeSimplicitySignals, serializeSimplicitySignals } from '../src/simplicity-signals.js';

function makeChunk(
  overrides: Partial<CodeChunk['metadata']> & { content?: string } = {},
): CodeChunk {
  const { content = '', ...meta } = overrides;
  return {
    content,
    metadata: {
      file: 'test.ts',
      startLine: 1,
      endLine: 10,
      type: 'function',
      language: 'typescript',
      ...meta,
    },
  };
}

describe('computeSimplicitySignals', () => {
  it('returns empty array for empty chunks', () => {
    expect(computeSimplicitySignals([], ['test.ts'])).toEqual([]);
  });

  it('excludes files with only 1 class', () => {
    const chunks = [
      makeChunk({ file: 'a.ts', symbolType: 'class', symbolName: 'Foo' }),
      makeChunk({ file: 'a.ts', symbolType: 'method', symbolName: 'bar', complexity: 5 }),
    ];
    const signals = computeSimplicitySignals(chunks, ['a.ts']);
    expect(signals).toEqual([]);
  });

  it('flags file with 3 trivial classes', () => {
    const chunks = [
      makeChunk({ file: 'a.ts', symbolType: 'class', symbolName: 'A' }),
      makeChunk({ file: 'a.ts', symbolType: 'class', symbolName: 'B' }),
      makeChunk({ file: 'a.ts', symbolType: 'class', symbolName: 'C' }),
      makeChunk({
        file: 'a.ts',
        symbolType: 'method',
        symbolName: 'doA',
        complexity: 1,
        startLine: 1,
        endLine: 3,
      }),
      makeChunk({
        file: 'a.ts',
        symbolType: 'method',
        symbolName: 'doB',
        complexity: 1,
        startLine: 5,
        endLine: 7,
      }),
      makeChunk({
        file: 'a.ts',
        symbolType: 'method',
        symbolName: 'doC',
        complexity: 2,
        startLine: 9,
        endLine: 11,
      }),
    ];
    const signals = computeSimplicitySignals(chunks, ['a.ts']);
    expect(signals).toHaveLength(1);
    expect(signals[0].flagged).toBe(true);
    expect(signals[0].classCount).toBe(3);
    expect(signals[0].reason).toContain('possible over-abstraction');
  });

  it('does NOT flag file with 3 complex classes', () => {
    const chunks = [
      makeChunk({ file: 'a.ts', symbolType: 'class', symbolName: 'A' }),
      makeChunk({ file: 'a.ts', symbolType: 'class', symbolName: 'B' }),
      makeChunk({ file: 'a.ts', symbolType: 'class', symbolName: 'C' }),
      makeChunk({
        file: 'a.ts',
        symbolType: 'method',
        symbolName: 'doA',
        complexity: 15,
        startLine: 1,
        endLine: 40,
      }),
      makeChunk({
        file: 'a.ts',
        symbolType: 'method',
        symbolName: 'doB',
        complexity: 12,
        startLine: 42,
        endLine: 80,
      }),
    ];
    const signals = computeSimplicitySignals(chunks, ['a.ts']);
    expect(signals).toHaveLength(1);
    expect(signals[0].flagged).toBe(false);
    expect(signals[0].classCount).toBe(3);
  });

  it('includes unflagged files with classCount >= 2', () => {
    const chunks = [
      makeChunk({ file: 'a.ts', symbolType: 'class', symbolName: 'A' }),
      makeChunk({ file: 'a.ts', symbolType: 'class', symbolName: 'B' }),
      makeChunk({
        file: 'a.ts',
        symbolType: 'method',
        symbolName: 'doA',
        complexity: 10,
        startLine: 1,
        endLine: 30,
      }),
    ];
    const signals = computeSimplicitySignals(chunks, ['a.ts']);
    expect(signals).toHaveLength(1);
    expect(signals[0].flagged).toBe(false);
    expect(signals[0].classCount).toBe(2);
  });

  it('processes multiple files and only includes relevant ones', () => {
    const chunks = [
      // File with 3 trivial classes — flagged
      makeChunk({ file: 'a.ts', symbolType: 'class', symbolName: 'A' }),
      makeChunk({ file: 'a.ts', symbolType: 'class', symbolName: 'B' }),
      makeChunk({ file: 'a.ts', symbolType: 'class', symbolName: 'C' }),
      makeChunk({
        file: 'a.ts',
        symbolType: 'method',
        symbolName: 'doA',
        complexity: 1,
        startLine: 1,
        endLine: 3,
      }),
      // File with only functions — excluded (0 classes)
      makeChunk({ file: 'b.ts', symbolType: 'function', symbolName: 'helper' }),
      makeChunk({ file: 'b.ts', symbolType: 'function', symbolName: 'util' }),
      // File with 1 class — excluded (below threshold)
      makeChunk({ file: 'c.ts', symbolType: 'class', symbolName: 'Solo' }),
    ];
    const signals = computeSimplicitySignals(chunks, ['a.ts', 'b.ts', 'c.ts']);
    expect(signals).toHaveLength(1);
    expect(signals[0].file).toBe('a.ts');
  });

  it('respects filesToAnalyze filtering', () => {
    const chunks = [
      makeChunk({ file: 'a.ts', symbolType: 'class', symbolName: 'A' }),
      makeChunk({ file: 'a.ts', symbolType: 'class', symbolName: 'B' }),
      makeChunk({ file: 'a.ts', symbolType: 'class', symbolName: 'C' }),
      makeChunk({
        file: 'a.ts',
        symbolType: 'method',
        symbolName: 'doA',
        complexity: 1,
        startLine: 1,
        endLine: 3,
      }),
    ];
    // a.ts is not in filesToAnalyze
    const signals = computeSimplicitySignals(chunks, ['other.ts']);
    expect(signals).toEqual([]);
  });

  it('does NOT flag classes-only file with zero methods', () => {
    const chunks = [
      makeChunk({ file: 'a.ts', symbolType: 'class', symbolName: 'A' }),
      makeChunk({ file: 'a.ts', symbolType: 'class', symbolName: 'B' }),
      makeChunk({ file: 'a.ts', symbolType: 'class', symbolName: 'C' }),
      makeChunk({ file: 'a.ts', symbolType: 'interface', symbolName: 'D' }),
    ];
    const signals = computeSimplicitySignals(chunks, ['a.ts']);
    expect(signals).toHaveLength(1);
    expect(signals[0].flagged).toBe(false);
    expect(signals[0].classCount).toBe(3); // interfaces not counted as classes
    expect(signals[0].methodCount).toBe(0);
  });

  it('does not count interfaces as classes', () => {
    const chunks = [
      makeChunk({ file: 'a.ts', symbolType: 'interface', symbolName: 'IFoo' }),
      makeChunk({ file: 'a.ts', symbolType: 'class', symbolName: 'Foo' }),
      makeChunk({ file: 'a.ts', symbolType: 'class', symbolName: 'Bar' }),
      makeChunk({
        file: 'a.ts',
        symbolType: 'method',
        symbolName: 'doFoo',
        complexity: 1,
        startLine: 1,
        endLine: 2,
      }),
    ];
    const signals = computeSimplicitySignals(chunks, ['a.ts']);
    expect(signals).toHaveLength(1);
    expect(signals[0].classCount).toBe(2); // interface excluded
    expect(signals[0].flagged).toBe(false); // only 2 classes, below threshold
  });

  it('defaults complexity to 1 when undefined', () => {
    const chunks = [
      makeChunk({ file: 'a.ts', symbolType: 'class', symbolName: 'A' }),
      makeChunk({ file: 'a.ts', symbolType: 'class', symbolName: 'B' }),
      makeChunk({ file: 'a.ts', symbolType: 'class', symbolName: 'C' }),
      makeChunk({
        file: 'a.ts',
        symbolType: 'method',
        symbolName: 'doA',
        startLine: 1,
        endLine: 3,
      }),
    ];
    const signals = computeSimplicitySignals(chunks, ['a.ts']);
    expect(signals[0].avgMethodComplexity).toBe(1);
  });

  it('counts standalone functions separately', () => {
    const chunks = [
      makeChunk({ file: 'a.ts', symbolType: 'class', symbolName: 'A' }),
      makeChunk({ file: 'a.ts', symbolType: 'class', symbolName: 'B' }),
      makeChunk({ file: 'a.ts', symbolType: 'function', symbolName: 'helper' }),
      makeChunk({ file: 'a.ts', symbolType: 'function', symbolName: 'util' }),
    ];
    const signals = computeSimplicitySignals(chunks, ['a.ts']);
    expect(signals[0].functionCount).toBe(2);
    expect(signals[0].classCount).toBe(2);
  });
});

describe('serializeSimplicitySignals', () => {
  it('returns empty string when no signals', () => {
    expect(serializeSimplicitySignals([])).toBe('');
  });

  it('produces expected markdown format', () => {
    const signals = computeSimplicitySignals(
      [
        makeChunk({ file: 'src/kiss-violations.ts', symbolType: 'class', symbolName: 'A' }),
        makeChunk({ file: 'src/kiss-violations.ts', symbolType: 'class', symbolName: 'B' }),
        makeChunk({ file: 'src/kiss-violations.ts', symbolType: 'class', symbolName: 'C' }),
        makeChunk({ file: 'src/kiss-violations.ts', symbolType: 'function', symbolName: 'create' }),
        makeChunk({
          file: 'src/kiss-violations.ts',
          symbolType: 'method',
          symbolName: 'transform',
          complexity: 1,
          startLine: 1,
          endLine: 3,
        }),
        makeChunk({
          file: 'src/kiss-violations.ts',
          symbolType: 'method',
          symbolName: 'validate',
          complexity: 1,
          startLine: 5,
          endLine: 7,
        }),
      ],
      ['src/kiss-violations.ts'],
    );

    const output = serializeSimplicitySignals(signals);
    expect(output).toContain('## File Structure Signals');
    expect(output).toContain('kiss-violations.ts');
    expect(output).toContain('3 classes');
    expect(output).toContain('1 functions');
    expect(output).toContain('2 methods');
    expect(output).toContain('avg method complexity');
    expect(output).toContain('⚠️');
    expect(output).toContain('possible over-abstraction');
  });

  it('omits warning line for unflagged files', () => {
    const signals = computeSimplicitySignals(
      [
        makeChunk({ file: 'a.ts', symbolType: 'class', symbolName: 'A' }),
        makeChunk({ file: 'a.ts', symbolType: 'class', symbolName: 'B' }),
        makeChunk({
          file: 'a.ts',
          symbolType: 'method',
          symbolName: 'doA',
          complexity: 10,
          startLine: 1,
          endLine: 30,
        }),
      ],
      ['a.ts'],
    );

    const output = serializeSimplicitySignals(signals);
    expect(output).toContain('## File Structure Signals');
    expect(output).not.toContain('⚠️');
  });
});
