import { describe, it, expect } from 'vitest';
import {
  findCSharpTypeReferenceDependents,
  buildCSharpTypeReferenceIndex,
  resolveCSharpTypeReferenceDependents,
  resolveCSharpTypeReferenceDependentsBruteForce,
} from './csharp-type-reference-signals.js';
import type { CodeChunk } from './types.js';

interface ChunkOptions {
  file: string;
  content?: string;
  symbolName?: string;
  symbolType?: 'class' | 'interface' | 'method' | 'function';
  parentClass?: string;
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
      parentClass: opts.parentClass,
    },
  };
}

/** A real class/struct/record/enum declaration chunk, optionally namespaced (a
 * `namespace X;` line prefixed into content, mirroring how a real file's
 * derived namespace is recovered from chunk content -- see
 * `deriveCSharpNamespace`). */
function declChunk(file: string, symbolName: string, namespace?: string): CodeChunk {
  const nsPrefix = namespace ? `namespace ${namespace};\n\n` : '';
  return makeChunk({
    file,
    content: `${nsPrefix}public class ${symbolName} { }`,
    symbolName,
    symbolType: 'class',
  });
}

/** A NESTED type declaration chunk (`parentClass` set), optionally namespaced. */
function nestedDeclChunk(
  file: string,
  symbolName: string,
  parentClass: string,
  namespace?: string,
): CodeChunk {
  const nsPrefix = namespace ? `namespace ${namespace};\n\n` : '';
  return makeChunk({
    file,
    content: `${nsPrefix}class ${parentClass} { class ${symbolName} { } }`,
    symbolName,
    symbolType: 'class',
    parentClass,
  });
}

/** A production/test chunk whose body references `references` by name,
 * optionally namespaced (see `declChunk`). */
function usageChunk(file: string, references: string[], namespace?: string): CodeChunk {
  const nsPrefix = namespace ? `namespace ${namespace};\n\n` : '';
  return makeChunk({
    file,
    content: `${nsPrefix}${references.map(name => `${name}.Apply(output, value);`).join('\n')}`,
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

  describe('tier 1 widened to test-declared types (#943 widening)', () => {
    it('recovers a type declared ONLY in a test file -- test files are now valid declaring files, not just referencers', () => {
      const chunks: CodeChunk[] = [
        declChunk('test/Support/DummySink.cs', 'DummySink'),
        usageChunk('test/Core/LoggerTests.cs', ['DummySink']),
      ];

      expect(findCSharpTypeReferenceDependents('test/Support/DummySink.cs', chunks)).toEqual([
        'test/Core/LoggerTests.cs',
      ]);
    });

    it('still drops a name that is ambiguous across TWO test files (widening does not relax the uniqueness gate itself)', () => {
      const chunks: CodeChunk[] = [
        declChunk('test/A/Fixture.cs', 'Fixture'),
        declChunk('test/B/Fixture.cs', 'Fixture'),
        usageChunk('test/C/Consumer.cs', ['Fixture']),
      ];

      expect(findCSharpTypeReferenceDependents('test/A/Fixture.cs', chunks)).toEqual([]);
      expect(findCSharpTypeReferenceDependents('test/B/Fixture.cs', chunks)).toEqual([]);
    });
  });

  describe('tier 2: namespace-scoped shadow resolution for globally-ambiguous names', () => {
    // Deliberate reproduction of the exact collision risk called out for this
    // feature: `Serilog.Core.Logger` vs `Serilog.Logger` vs a test's own
    // `Logger` -- three separate, real classes sharing the identical bare
    // name `Logger`, each declared in a different namespace. Real C# resolves
    // a bare `Logger` reference via lexical namespace enclosure + shadowing
    // (nearest enclosing declaration wins), never by picking one arbitrarily.
    const coreLogger = declChunk('src/Core/Logger.cs', 'Logger', 'Serilog.Core');
    const topLevelLogger = declChunk('src/Logger.cs', 'Logger', 'Serilog');
    const testLogger = declChunk('test/Support/Logger.cs', 'Logger', 'Serilog.Tests.Support');

    // Referencer physically inside Serilog.Core (a CHILD namespace of Serilog.Core
    // itself) -- its chain is [Serilog.Core.Sinks, Serilog.Core, Serilog, ""],
    // so BOTH Logger declarations are technically visible, but Serilog.Core is
    // the closer (shadowing) match.
    const coreSinkConsumer = usageChunk(
      'src/Core/Sinks/SomeSink.cs',
      ['Logger'],
      'Serilog.Core.Sinks',
    );
    // Referencer in Serilog.Formatting -- a SIBLING of Serilog.Core (not an
    // ancestor/descendant), so Serilog.Core.Logger is NOT visible here at all;
    // only the outer Serilog.Logger is.
    const siblingConsumer = usageChunk('src/Formatting/SomeFormatter.cs', ['Logger'], 'Serilog');
    // Referencer inside the test's own namespace -- resolves to its own local
    // Logger, invisible from anywhere else.
    const testConsumer = usageChunk(
      'test/Support/LoggerConsumerTests.cs',
      ['Logger'],
      'Serilog.Tests.Support',
    );

    const chunks: CodeChunk[] = [
      coreLogger,
      topLevelLogger,
      testLogger,
      coreSinkConsumer,
      siblingConsumer,
      testConsumer,
    ];

    it('resolves the closest enclosing declaration (Serilog.Core.Sinks -> Serilog.Core.Logger, shadowing the outer Serilog.Logger)', () => {
      expect(findCSharpTypeReferenceDependents('src/Core/Logger.cs', chunks)).toEqual([
        'src/Core/Sinks/SomeSink.cs',
      ]);
    });

    it('resolves the outer declaration for a SIBLING namespace that cannot see the inner one (Serilog -> Serilog.Logger only)', () => {
      expect(findCSharpTypeReferenceDependents('src/Logger.cs', chunks)).toEqual([
        'src/Formatting/SomeFormatter.cs',
      ]);
    });

    it('resolves a test namespace to its own local declaration, invisible from production namespaces', () => {
      expect(findCSharpTypeReferenceDependents('test/Support/Logger.cs', chunks)).toEqual([
        'test/Support/LoggerConsumerTests.cs',
      ]);
    });

    it('never guesses when two DIFFERENT files declare the same name in the IDENTICAL namespace (genuine same-depth tie)', () => {
      const tieChunks: CodeChunk[] = [
        declChunk('src/A/Handler.cs', 'Handler', 'Root.Shared'),
        declChunk('src/B/Handler.cs', 'Handler', 'Root.Shared'),
        usageChunk('src/C/Consumer.cs', ['Handler'], 'Root.Shared'),
      ];

      // Both A and B sit at the identical chain position (index 0) for this
      // referencer -- an unresolvable tie, not a shadowing win for either.
      expect(findCSharpTypeReferenceDependents('src/A/Handler.cs', tieChunks)).toEqual([]);
      expect(findCSharpTypeReferenceDependents('src/B/Handler.cs', tieChunks)).toEqual([]);
    });

    it('does not resolve across SIBLING namespaces that share no ancestor/descendant relationship', () => {
      // Root.A and Root.B are siblings; a referencer in Root.C (an unrelated
      // third sibling) can see neither unqualified -- an enclosure miss, not
      // a tie, and just as un-guessable.
      const chunks: CodeChunk[] = [
        declChunk('src/A/Handler.cs', 'Handler', 'Root.A'),
        declChunk('src/B/Handler.cs', 'Handler', 'Root.B'),
        usageChunk('src/C/Consumer.cs', ['Handler'], 'Root.C'),
      ];

      expect(findCSharpTypeReferenceDependents('src/A/Handler.cs', chunks)).toEqual([]);
      expect(findCSharpTypeReferenceDependents('src/B/Handler.cs', chunks)).toEqual([]);
    });
  });

  describe('nested-type candidacy (#regression guards)', () => {
    it('does not let a NESTED type declared in a TEST file collide with an unrelated top-level production type of the same name', () => {
      // Reproduces the exact serilog/serilog regression found while widening
      // tier 1 to test-declared types: `LoggerConfigurationTests.cs` declares
      // an unrelated NESTED test-double also named `ProjectedDestructuringPolicy`.
      const chunks: CodeChunk[] = [
        declChunk('src/Policies/ProjectedDestructuringPolicy.cs', 'ProjectedDestructuringPolicy'),
        nestedDeclChunk(
          'test/Configuration/LoggerConfigurationTests.cs',
          'ProjectedDestructuringPolicy',
          'LoggerConfigurationTests',
        ),
        usageChunk('src/Configuration/LoggerDestructuringConfiguration.cs', [
          'ProjectedDestructuringPolicy',
        ]),
      ];

      expect(
        findCSharpTypeReferenceDependents('src/Policies/ProjectedDestructuringPolicy.cs', chunks),
      ).toEqual(['src/Configuration/LoggerDestructuringConfiguration.cs']);
    });

    it('excludes a referencer file entirely when it ALSO genuinely constructs its own local same-named double, not just declares it', () => {
      // The real serilog/serilog shape that a mere declaration-chunk exclusion
      // did not catch: `LoggerConfigurationTests.cs` doesn't just declare its
      // local `ProjectedDestructuringPolicy` double -- a SEPARATE test method
      // in the same file also genuinely constructs it (`new
      // ProjectedDestructuringPolicy(...)`), which real C# shadowing resolves
      // to the LOCAL double, never the production class. A word-boundary text
      // match cannot tell that specific occurrence apart from a genuine
      // reference to the production type, so the whole file must be excluded
      // as evidence -- not just its declaration chunk.
      const chunks: CodeChunk[] = [
        declChunk('src/Policies/ProjectedDestructuringPolicy.cs', 'ProjectedDestructuringPolicy'),
        nestedDeclChunk(
          'test/Configuration/LoggerConfigurationTests.cs',
          'ProjectedDestructuringPolicy',
          'LoggerConfigurationTests',
        ),
        // A separate chunk in the SAME file: a test method genuinely
        // constructing the LOCAL double, not the production class.
        usageChunk('test/Configuration/LoggerConfigurationTests.cs', [
          'ProjectedDestructuringPolicy',
        ]),
      ];

      expect(
        findCSharpTypeReferenceDependents('src/Policies/ProjectedDestructuringPolicy.cs', chunks),
      ).toEqual([]);
    });

    it('still recovers a PRODUCTION nested type declared in its own file (partial-class continuation pattern)', () => {
      // Reproduces serilog/serilog's `DepthLimiter.cs`: `partial class
      // PropertyValueConverter { class DepthLimiter { ... } }` declared in a
      // SEPARATE file from `PropertyValueConverter.cs` itself, which
      // references the nested type unqualified (legitimate: nested types are
      // visible, unqualified, throughout every `partial` piece of their
      // enclosing type).
      const chunks: CodeChunk[] = [
        nestedDeclChunk('src/Capturing/DepthLimiter.cs', 'DepthLimiter', 'PropertyValueConverter'),
        usageChunk('src/Capturing/PropertyValueConverter.cs', ['DepthLimiter']),
      ];

      expect(findCSharpTypeReferenceDependents('src/Capturing/DepthLimiter.cs', chunks)).toEqual([
        'src/Capturing/PropertyValueConverter.cs',
      ]);
    });
  });
});

// #1040: `buildCSharpTypeReferenceIndex` + `resolveCSharpTypeReferenceDependents`
// let a caller resolve MANY target files against one project-wide scan --
// extracted from `findCSharpTypeReferenceDependents` so `test-associations.ts`
// doesn't rebuild the index per target file (see that module's
// `collectCSharpNamespaceTests`).
describe('buildCSharpTypeReferenceIndex + resolveCSharpTypeReferenceDependents (#1040 build-once API)', () => {
  it('resolving against a pre-built index matches findCSharpTypeReferenceDependents for the same target', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/Parsing/Alignment.cs', 'Alignment'),
      usageChunk('src/Rendering/Padding.cs', ['Alignment']),
    ];

    const index = buildCSharpTypeReferenceIndex(chunks);

    expect(resolveCSharpTypeReferenceDependents('src/Parsing/Alignment.cs', index)).toEqual(
      findCSharpTypeReferenceDependents('src/Parsing/Alignment.cs', chunks),
    );
  });

  it('resolves multiple different target files against the SAME built index without rebuilding it per target', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/Parsing/Alignment.cs', 'Alignment'),
      declChunk('src/Rendering/Padding.cs', 'Padding'),
      usageChunk('test/AlignmentTests.cs', ['Alignment']),
      usageChunk('test/PaddingTests.cs', ['Padding']),
    ];

    const index = buildCSharpTypeReferenceIndex(chunks);

    expect(resolveCSharpTypeReferenceDependents('src/Parsing/Alignment.cs', index)).toEqual([
      'test/AlignmentTests.cs',
    ]);
    expect(resolveCSharpTypeReferenceDependents('src/Rendering/Padding.cs', index)).toEqual([
      'test/PaddingTests.cs',
    ]);
  });
});

// #1071: `resolveCSharpTypeReferenceDependents` now resolves candidates
// through a project-wide reference index (`candidateFilesForName`) instead of
// scanning every file per target. `resolveCSharpTypeReferenceDependentsBruteForce`
// keeps the never-pruned loop around specifically so this suite can prove the
// two agree, rather than trusting the pruning argument in the module doc
// unverified.
describe('resolveCSharpTypeReferenceDependents matches the brute-force reference implementation (#1071)', () => {
  // One fixture corpus spanning every resolution path the module doc
  // describes: a uniquely-declared type (Alignment), an ambiguous type
  // resolved by namespace scoping + shadowing (Logger, reproducing the
  // Serilog.Core/Serilog/Serilog.Tests.Support fixture above), a referencer
  // that declares its own same-named type (ProjectedDestructuringPolicy,
  // reproducing the nested-type regression fixture above), and a non-C# file
  // sitting in the same corpus.
  const chunks: CodeChunk[] = [
    declChunk('src/Parsing/Alignment.cs', 'Alignment'),
    usageChunk('src/Rendering/Padding.cs', ['Alignment']),

    declChunk('src/Core/Logger.cs', 'Logger', 'Serilog.Core'),
    declChunk('src/Logger.cs', 'Logger', 'Serilog'),
    declChunk('test/Support/Logger.cs', 'Logger', 'Serilog.Tests.Support'),
    usageChunk('src/Core/Sinks/SomeSink.cs', ['Logger'], 'Serilog.Core.Sinks'),
    usageChunk('src/Formatting/SomeFormatter.cs', ['Logger'], 'Serilog'),
    usageChunk('test/Support/LoggerConsumerTests.cs', ['Logger'], 'Serilog.Tests.Support'),

    declChunk('src/Policies/ProjectedDestructuringPolicy.cs', 'ProjectedDestructuringPolicy'),
    nestedDeclChunk(
      'test/Configuration/LoggerConfigurationTests.cs',
      'ProjectedDestructuringPolicy',
      'LoggerConfigurationTests',
    ),
    usageChunk('test/Configuration/LoggerConfigurationTests.cs', ['ProjectedDestructuringPolicy']),
    usageChunk('src/Configuration/LoggerDestructuringConfiguration.cs', [
      'ProjectedDestructuringPolicy',
    ]),

    makeChunk({
      file: 'src/Rendering/Padding.go',
      content: 'Alignment.Apply(w, v)\nLogger.Info("x")',
      symbolName: 'Apply',
      symbolType: 'function',
    }),
  ];

  const index = buildCSharpTypeReferenceIndex(chunks);
  const everyFile = [...new Set(chunks.map(chunk => chunk.metadata.file))];

  it.each(everyFile)('agrees with the brute-force reference for target %s', target => {
    expect(resolveCSharpTypeReferenceDependents(target, index)).toEqual(
      resolveCSharpTypeReferenceDependentsBruteForce(target, index),
    );
  });

  it('still returns the real (non-empty) recovered dependents -- the comparison above is not vacuously passing on two empty results', () => {
    expect(resolveCSharpTypeReferenceDependents('src/Parsing/Alignment.cs', index)).toEqual([
      'src/Rendering/Padding.cs',
    ]);
    expect(resolveCSharpTypeReferenceDependents('src/Core/Logger.cs', index)).toEqual([
      'src/Core/Sinks/SomeSink.cs',
    ]);
    expect(
      resolveCSharpTypeReferenceDependents('src/Policies/ProjectedDestructuringPolicy.cs', index),
    ).toEqual(['src/Configuration/LoggerDestructuringConfiguration.cs']);
  });

  it('falls back to a full C# file scan (never a silent miss) for a type name the reference index could not have tokenized as one token', () => {
    // `NewÜnicodeType` has a non-ASCII character in the middle -- unusual but
    // valid in a real C# identifier. `\bNewÜnicodeType\b` genuinely matches it
    // in normal surrounding punctuation/whitespace (a JS `\b` only anchors at
    // the very start/end of the whole matched literal, never at a character
    // in the middle) -- verified directly: `/\bNewÜnicodeType\b/.test(
    // 'NewÜnicodeType.Apply(x);')` is `true`. But `IDENTIFIER_TOKEN_RE`'s
    // ASCII-only character class can never tokenize this as ONE token -- it
    // splits into `New` and `nicodeType` -- so `index.referenceIndex` has no
    // bucket for the full name at all, and `isPlainAsciiIdentifier` correctly
    // rejects it. Without `candidateFilesForName`'s `allCSharpFiles`
    // fallback, this real reference would go silently unrecovered instead of
    // reproducing the brute-force result.
    const chunks: CodeChunk[] = [
      declChunk('src/Weird/NewUnicodeType.cs', 'NewÜnicodeType'),
      usageChunk('src/Weird/Consumer.cs', ['NewÜnicodeType']),
    ];
    const unicodeIndex = buildCSharpTypeReferenceIndex(chunks);

    expect(
      resolveCSharpTypeReferenceDependents('src/Weird/NewUnicodeType.cs', unicodeIndex),
    ).toEqual(['src/Weird/Consumer.cs']);
    expect(
      resolveCSharpTypeReferenceDependents('src/Weird/NewUnicodeType.cs', unicodeIndex),
    ).toEqual(
      resolveCSharpTypeReferenceDependentsBruteForce('src/Weird/NewUnicodeType.cs', unicodeIndex),
    );
  });
});
