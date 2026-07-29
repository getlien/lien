import { describe, it, expect } from 'vitest';
import { findCSharpTypeReferenceDependents } from './csharp-type-reference-signals.js';
import type { CodeChunk } from './types.js';

interface ChunkOptions {
  file: string;
  content?: string;
  symbolName?: string;
  symbolType?: 'class' | 'interface' | 'method' | 'function';
}

function makeChunk(opts: ChunkOptions): CodeChunk {
  return {
    content: opts.content ?? '',
    metadata: {
      file: opts.file,
      startLine: 1,
      endLine: 10,
      type: opts.symbolType === 'class' || opts.symbolType === 'interface' ? 'class' : 'function',
      language: 'csharp',
      symbolName: opts.symbolName,
      symbolType: opts.symbolType,
    },
  };
}

/** A real class/struct/record/enum declaration chunk. */
function declChunk(file: string, symbolName: string): CodeChunk {
  return makeChunk({
    file,
    content: `public class ${symbolName} { }`,
    symbolName,
    symbolType: 'class',
  });
}

/** A production/test chunk whose body references `references` by name. */
function usageChunk(file: string, references: string[]): CodeChunk {
  return makeChunk({
    file,
    content: references.map(name => `${name}.Apply(output, value);`).join('\n'),
    symbolName: 'SomeMethod',
    symbolType: 'method',
  });
}

describe('findCSharpTypeReferenceDependents', () => {
  it('finds a file that references a uniquely-declared type via a word-boundary match', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/Parsing/Alignment.cs', 'Alignment'),
      usageChunk('src/Rendering/Padding.cs', ['Alignment']),
    ];

    expect(findCSharpTypeReferenceDependents('src/Parsing/Alignment.cs', chunks)).toEqual([
      'src/Rendering/Padding.cs',
    ]);
  });

  it('reproduces the real #930 serilog shape: property-access references still count', () => {
    // `pt.Alignment` is a PROPERTY access, not a constructor/static call, but
    // the property happens to share its type's name (idiomatic C#) — a
    // word-boundary text match still (correctly, per real ground truth)
    // attributes it as a dependent.
    const chunks: CodeChunk[] = [
      declChunk('src/Parsing/Alignment.cs', 'Alignment'),
      makeChunk({
        file: 'src/Rendering/MessageTemplateRenderer.cs',
        content: 'if (!pt.Alignment.HasValue) return;',
        symbolName: 'Render',
        symbolType: 'method',
      }),
    ];

    expect(findCSharpTypeReferenceDependents('src/Parsing/Alignment.cs', chunks)).toEqual([
      'src/Rendering/MessageTemplateRenderer.cs',
    ]);
  });

  it('does not match a longer identifier that merely contains the type name as a substring', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/Parsing/Alignment.cs', 'Alignment'),
      usageChunk('src/Parsing/MessageTemplateParser.cs', ['AlignmentDirection']),
    ];

    expect(findCSharpTypeReferenceDependents('src/Parsing/Alignment.cs', chunks)).toEqual([]);
  });

  it('is case-sensitive: a lowercase local/parameter of the same spelling does not match', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/Parsing/Alignment.cs', 'Alignment'),
      usageChunk('src/Rendering/Padding.cs', ['alignment']),
    ];

    expect(findCSharpTypeReferenceDependents('src/Parsing/Alignment.cs', chunks)).toEqual([]);
  });

  it('excludes the declaring file itself', () => {
    const chunks: CodeChunk[] = [declChunk('src/Parsing/Alignment.cs', 'Alignment')];

    expect(findCSharpTypeReferenceDependents('src/Parsing/Alignment.cs', chunks)).toEqual([]);
  });

  it('drops an ambiguous type name declared in more than one file', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/A/Options.cs', 'Options'),
      declChunk('src/B/Options.cs', 'Options'),
      usageChunk('src/C/Consumer.cs', ['Options']),
    ];

    expect(findCSharpTypeReferenceDependents('src/A/Options.cs', chunks)).toEqual([]);
    expect(findCSharpTypeReferenceDependents('src/B/Options.cs', chunks)).toEqual([]);
  });

  it('includes a test file that references the type (not test-association-scoped)', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/Parsing/Alignment.cs', 'Alignment'),
      usageChunk('test/Serilog.Tests/Parsing/MessageTemplateParserTests.cs', ['Alignment']),
    ];

    expect(findCSharpTypeReferenceDependents('src/Parsing/Alignment.cs', chunks)).toEqual([
      'test/Serilog.Tests/Parsing/MessageTemplateParserTests.cs',
    ]);
  });

  it('ignores non-C# files entirely, on both the declaration and usage side', () => {
    const chunks: CodeChunk[] = [
      makeChunk({
        file: 'src/Parsing/Alignment.swift',
        content: 'class Alignment {}',
        symbolName: 'Alignment',
        symbolType: 'class',
      }),
      makeChunk({
        file: 'src/Rendering/Padding.go',
        content: 'Alignment.Apply(w, v)',
        symbolName: 'Apply',
        symbolType: 'function',
      }),
    ];

    expect(findCSharpTypeReferenceDependents('src/Parsing/Alignment.swift', chunks)).toEqual([]);
  });

  it('returns nothing for a non-C# target file', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/Parsing/Alignment.cs', 'Alignment'),
      usageChunk('src/Rendering/Padding.cs', ['Alignment']),
    ];

    expect(findCSharpTypeReferenceDependents('src/Parsing/Alignment.ts', chunks)).toEqual([]);
  });

  it('deduplicates multiple referencing chunks in the same file into one entry', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/Parsing/Alignment.cs', 'Alignment'),
      usageChunk('src/Rendering/Padding.cs', ['Alignment']),
      usageChunk('src/Rendering/Padding.cs', ['Alignment']),
    ];

    expect(findCSharpTypeReferenceDependents('src/Parsing/Alignment.cs', chunks)).toEqual([
      'src/Rendering/Padding.cs',
    ]);
  });

  it('recovers all five real serilog dependents from a single uniquely-declared type', () => {
    // Reproduces the exact #930 fixture: five real production files
    // referencing `Alignment` via a mix of parameter types, property
    // access, and local variable type declarations.
    const chunks: CodeChunk[] = [
      declChunk('src/Serilog/Rendering/Alignment.cs', 'Alignment'),
      makeChunk({
        file: 'src/Serilog/Rendering/Padding.cs',
        content:
          'public static void Apply(TextWriter output, string value, in Alignment? alignment)',
        symbolName: 'Apply',
        symbolType: 'method',
      }),
      makeChunk({
        file: 'src/Serilog/Rendering/MessageTemplateRenderer.cs',
        content: 'if (!pt.Alignment.HasValue) return;',
        symbolName: 'Render',
        symbolType: 'method',
      }),
      makeChunk({
        file: 'src/Serilog/Formatting/Display/MessageTemplateTextFormatter.cs',
        content: 'Padding.Apply(output, moniker, pt.Alignment);',
        symbolName: 'Format',
        symbolType: 'method',
      }),
      makeChunk({
        file: 'src/Serilog/Parsing/PropertyToken.cs',
        content: 'public Alignment? Alignment { get; }',
        symbolName: 'Alignment',
        symbolType: 'method',
      }),
      makeChunk({
        file: 'src/Serilog/Parsing/MessageTemplateParser.cs',
        content: 'Alignment? alignmentValue = null;',
        symbolName: 'Parse',
        symbolType: 'method',
      }),
    ];

    expect(findCSharpTypeReferenceDependents('src/Serilog/Rendering/Alignment.cs', chunks)).toEqual(
      [
        'src/Serilog/Formatting/Display/MessageTemplateTextFormatter.cs',
        'src/Serilog/Parsing/MessageTemplateParser.cs',
        'src/Serilog/Parsing/PropertyToken.cs',
        'src/Serilog/Rendering/MessageTemplateRenderer.cs',
        'src/Serilog/Rendering/Padding.cs',
      ],
    );
  });
});
