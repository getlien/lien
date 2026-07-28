import { describe, it, expect } from 'vitest';
import {
  findSwiftSymbolUsageAssociations,
  isMultiSegmentIdentifier,
  isTypeShapedIdentifier,
} from './swift-symbol-usage-signals.js';
import type { CodeChunk } from './types.js';

describe('isTypeShapedIdentifier', () => {
  it('accepts a multi-segment PascalCase type name', () => {
    expect(isTypeShapedIdentifier('HTTPHeaders')).toBe(true);
    expect(isTypeShapedIdentifier('RetryPolicy')).toBe(true);
  });

  it('accepts an underscore-prefixed SPI/implementation-detail type name', () => {
    expect(isTypeShapedIdentifier('_CancelID')).toBe(true);
    expect(isTypeShapedIdentifier('_EffectPublisher')).toBe(true);
  });

  it('rejects a multi-segment lowercase method name', () => {
    expect(isTypeShapedIdentifier('prepareForRetry')).toBe(false);
    expect(isTypeShapedIdentifier('singleValueContainer')).toBe(false);
    expect(isTypeShapedIdentifier('withDependencies')).toBe(false);
  });

  it('rejects a single Capitalized word (still gated by isMultiSegmentIdentifier)', () => {
    expect(isTypeShapedIdentifier('Session')).toBe(false);
  });

  it('rejects an underscore-prefixed single word', () => {
    expect(isTypeShapedIdentifier('_prefix')).toBe(false);
  });
});

describe('isMultiSegmentIdentifier', () => {
  it('rejects single Capitalized English words (must NEVER associate)', () => {
    expect(isMultiSegmentIdentifier('Get')).toBe(false);
    expect(isMultiSegmentIdentifier('Run')).toBe(false);
    expect(isMultiSegmentIdentifier('Map')).toBe(false);
    expect(isMultiSegmentIdentifier('Send')).toBe(false);
    expect(isMultiSegmentIdentifier('Session')).toBe(false);
    expect(isMultiSegmentIdentifier('Client')).toBe(false);
  });

  it('rejects bare lowercase words and bare ALL-CAPS acronyms', () => {
    expect(isMultiSegmentIdentifier('count')).toBe(false);
    expect(isMultiSegmentIdentifier('URL')).toBe(false);
    expect(isMultiSegmentIdentifier('API')).toBe(false);
  });

  it('accepts real multi-segment PascalCase/camelCase identifiers', () => {
    expect(isMultiSegmentIdentifier('TypeMap')).toBe(true);
    expect(isMultiSegmentIdentifier('getStatusCode')).toBe(true);
    expect(isMultiSegmentIdentifier('RetryMiddleware')).toBe(true);
    expect(isMultiSegmentIdentifier('prepareForRetry')).toBe(true);
  });

  it('accepts an acronym-prefixed PascalCase identifier (HTTPHeaders)', () => {
    expect(isMultiSegmentIdentifier('HTTPHeaders')).toBe(true);
  });

  it('accepts an internally-underscored identifier', () => {
    expect(isMultiSegmentIdentifier('get_status_code')).toBe(true);
  });

  it('rejects a single word with only a decorative leading/trailing underscore', () => {
    expect(isMultiSegmentIdentifier('_prefix')).toBe(false);
    expect(isMultiSegmentIdentifier('suffix_')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findSwiftSymbolUsageAssociations
// ---------------------------------------------------------------------------

interface ChunkOptions {
  file: string;
  symbolName?: string;
  symbolType?: 'function' | 'method' | 'class' | 'interface';
  signature?: string;
  callSites?: Array<{ symbol: string; line: number }>;
  language?: string;
}

function makeChunk(opts: ChunkOptions): CodeChunk {
  return {
    content: '',
    metadata: {
      file: opts.file,
      startLine: 1,
      endLine: 10,
      type: opts.symbolType === 'class' || opts.symbolType === 'interface' ? 'class' : 'function',
      language: opts.language ?? 'swift',
      symbolName: opts.symbolName,
      symbolType: opts.symbolType,
      signature: opts.signature,
      callSites: opts.callSites,
    },
  };
}

/** A real, non-extension class/struct declaration chunk. */
function declChunk(file: string, symbolName: string): CodeChunk {
  return makeChunk({
    file,
    symbolName,
    symbolType: 'class',
    signature: `class ${symbolName}`,
  });
}

/** An `extension <symbolName>` declaration chunk. */
function extensionChunk(file: string, symbolName: string): CodeChunk {
  return makeChunk({
    file,
    symbolName,
    symbolType: 'class',
    signature: `extension ${symbolName}`,
  });
}

/** A method/function declaration chunk. */
function methodChunk(file: string, symbolName: string): CodeChunk {
  return makeChunk({
    file,
    symbolName,
    symbolType: 'method',
    signature: `func ${symbolName}()`,
  });
}

/** A Swift XCTest-shaped test chunk referencing `callSites`. */
function testChunk(file: string, callSites: string[]): CodeChunk {
  return makeChunk({
    file,
    symbolName: 'testSomething',
    symbolType: 'method',
    signature: 'func testSomething()',
    callSites: callSites.map((symbol, i) => ({ symbol, line: i + 1 })),
  });
}

describe('findSwiftSymbolUsageAssociations', () => {
  it('associates a test referencing a uniquely-defined, multi-segment type', () => {
    const chunks: CodeChunk[] = [
      declChunk('Source/Core/HTTPHeaders.swift', 'HTTPHeaders'),
      testChunk('Tests/HTTPHeadersTests.swift', ['HTTPHeaders']),
    ];

    const result = findSwiftSymbolUsageAssociations(['Source/Core/HTTPHeaders.swift'], chunks);

    expect(result.get('Source/Core/HTTPHeaders.swift')).toEqual(['Tests/HTTPHeadersTests.swift']);
  });

  it('associates via a method-level symbol WHEN the same edge also has a type-shaped driver', () => {
    // Note: a bare single-segment type name like `Request` itself can never
    // serve as the type-shaped driver (it fails `isMultiSegmentIdentifier`,
    // same as `Session`/`Get`/`Run`) — this fixture uses a realistically
    // multi-segment type name (`RequestBuilder`) so the type-shaped driver
    // requirement below can actually be satisfied.
    const chunks: CodeChunk[] = [
      declChunk('Source/Core/RequestBuilder.swift', 'RequestBuilder'),
      methodChunk('Source/Core/RequestBuilder.swift', 'prepareForRetry'),
      testChunk('Tests/RequestBuilderTests.swift', ['RequestBuilder', 'prepareForRetry']),
    ];

    const result = findSwiftSymbolUsageAssociations(['Source/Core/RequestBuilder.swift'], chunks);

    expect(result.get('Source/Core/RequestBuilder.swift')).toEqual([
      'Tests/RequestBuilderTests.swift',
    ]);
  });

  // Post-ship adversarial re-verification (#869): a purely method-driven edge
  // — no type-shaped co-driver at all — is demoted, even when the method
  // name is uniquely declared in-project. See `isTypeShapedIdentifier`'s doc
  // for the confirmed real-world false positives this catches.
  describe('type-shaped-driver requirement (post-ship hardening)', () => {
    it('demotes an edge whose ONLY driver is a method name, even when uniquely defined', () => {
      const chunks: CodeChunk[] = [
        declChunk('Source/Core/Request.swift', 'Request'),
        methodChunk('Source/Core/Request.swift', 'prepareForRetry'),
        testChunk('Tests/RequestTests.swift', ['prepareForRetry']), // no type-shaped co-driver
      ];

      const result = findSwiftSymbolUsageAssociations(['Source/Core/Request.swift'], chunks);

      expect(result.get('Source/Core/Request.swift')).toBeUndefined();
    });

    // Confirmed real false positive (Alamofire/Alamofire, Tests/TestHelpers.swift:505):
    // `decoder.singleValueContainer()` inside `extension HTTPHeaders: Decodable`
    // calls the Swift stdlib `Decoder` protocol's own witness — completely
    // unrelated to Alamofire's own, differently-typed `singleValueContainer()`
    // declared on its custom `URLEncodedFormEncoder`. Both happen to be the
    // only project-indexed declaration of that bare name, so pre-hardening
    // this associated `URLEncodedFormEncoder.swift` with every test that
    // merely implements ANY `Decodable` conformance — a foreign-protocol-
    // witness collision, not a real reference to the encoder at all.
    it('does not associate a foreign-protocol-witness method call (singleValueContainer regression)', () => {
      const chunks: CodeChunk[] = [
        declChunk('Source/Features/URLEncodedFormEncoder.swift', 'URLEncodedFormEncoder'),
        methodChunk('Source/Features/URLEncodedFormEncoder.swift', 'singleValueContainer'),
        testChunk('Tests/TestHelpers.swift', ['singleValueContainer']),
      ];

      const result = findSwiftSymbolUsageAssociations(
        ['Source/Features/URLEncodedFormEncoder.swift'],
        chunks,
      );

      expect(result.get('Source/Features/URLEncodedFormEncoder.swift')).toBeUndefined();
    });

    // Confirmed real false positive (swift-composable-architecture,
    // Tests/ComposableArchitectureTests/ComposableArchitectureTests.swift):
    // `group.addTask { ... }` (no `name:` argument) calls the Swift stdlib
    // `TaskGroup.addTask(priority:operation:)` directly — TCA's own
    // `Effect.swift` only adds a DIFFERENT, `name:`-taking overload as a
    // backwards-compatible shim, never invoked by a call with no `name:`.
    // Both are the only project-indexed declaration of `addTask`, but the
    // stdlib's own `TaskGroup` extension is invisible to the indexer.
    it('does not associate a stdlib-type-extension-overload method call (addTask regression)', () => {
      const chunks: CodeChunk[] = [
        declChunk('Source/Effect.swift', 'Effect'),
        methodChunk('Source/Effect.swift', 'addTask'),
        testChunk('Tests/ComposableArchitectureTests.swift', ['addTask']),
      ];

      const result = findSwiftSymbolUsageAssociations(['Source/Effect.swift'], chunks);

      expect(result.get('Source/Effect.swift')).toBeUndefined();
    });

    // Confirmed real false positive (swift-composable-architecture,
    // Tests/ComposableArchitectureTests/ViewStoreTests.swift):
    // `Array(...).flatMap { $0 }` calls the Swift stdlib `Sequence.flatMap`
    // on a plain `[[Int]]` — unrelated to TCA's own `TaskResult.flatMap`,
    // a completely different (project-defined) type.
    it('does not associate a stdlib-Sequence method call (flatMap regression)', () => {
      const chunks: CodeChunk[] = [
        declChunk('Source/Deprecations.swift', 'TaskResult'),
        methodChunk('Source/Deprecations.swift', 'flatMap'),
        testChunk('Tests/ViewStoreTests.swift', ['flatMap']),
      ];

      const result = findSwiftSymbolUsageAssociations(['Source/Deprecations.swift'], chunks);

      expect(result.get('Source/Deprecations.swift')).toBeUndefined();
    });

    // Confirmed real false positive (swift-composable-architecture,
    // 4 test files): a bare `withDependencies { ... }` call resolves to the
    // EXTERNAL `swift-dependencies` package's own top-level free function —
    // a separate Swift package dependency, never indexed — not TCA's own
    // `TestStore.withDependencies` method, which requires a `store.` receiver.
    it('does not associate an external-package free-function call (withDependencies regression)', () => {
      const chunks: CodeChunk[] = [
        declChunk('Source/TestStore.swift', 'TestStore'),
        methodChunk('Source/TestStore.swift', 'withDependencies'),
        testChunk('Tests/EffectCancellationTests.swift', ['withDependencies']),
      ];

      const result = findSwiftSymbolUsageAssociations(['Source/TestStore.swift'], chunks);

      expect(result.get('Source/TestStore.swift')).toBeUndefined();
    });

    it('still associates when the same edge ALSO has a type-shaped driver alongside the risky method name', () => {
      const chunks: CodeChunk[] = [
        declChunk('Source/Features/URLEncodedFormEncoder.swift', 'URLEncodedFormEncoder'),
        methodChunk('Source/Features/URLEncodedFormEncoder.swift', 'singleValueContainer'),
        testChunk('Tests/ParameterEncoderTests.swift', [
          'URLEncodedFormEncoder',
          'singleValueContainer',
        ]),
      ];

      const result = findSwiftSymbolUsageAssociations(
        ['Source/Features/URLEncodedFormEncoder.swift'],
        chunks,
      );

      expect(result.get('Source/Features/URLEncodedFormEncoder.swift')).toEqual([
        'Tests/ParameterEncoderTests.swift',
      ]);
    });
  });

  it('never associates via a single Capitalized word, even when uniquely defined (must NEVER associate)', () => {
    const chunks: CodeChunk[] = [
      declChunk('Source/Core/Session.swift', 'Session'),
      testChunk('Tests/SessionTests.swift', ['Session']),
    ];

    const result = findSwiftSymbolUsageAssociations(['Source/Core/Session.swift'], chunks);

    expect(result.get('Source/Core/Session.swift')).toBeUndefined();
  });

  it('does not associate when the symbol is defined in more than one file (not unique)', () => {
    const chunks: CodeChunk[] = [
      declChunk('Source/Core/TypeMap.swift', 'TypeMap'),
      declChunk('Source/Other/TypeMap.swift', 'TypeMap'), // duplicate definition elsewhere
      testChunk('Tests/TypeMapTests.swift', ['TypeMap']),
    ];

    const result = findSwiftSymbolUsageAssociations(['Source/Core/TypeMap.swift'], chunks);

    expect(result.get('Source/Core/TypeMap.swift')).toBeUndefined();
  });

  it('excludes an extension of a foreign (never really declared) type from the definition side', () => {
    // HTTPURLResponse is a Foundation type — never has a real (non-extension)
    // declaration anywhere in the project, only this extension.
    const chunks: CodeChunk[] = [
      extensionChunk('Source/Core/HTTPHeaders.swift', 'HTTPURLResponse'),
      testChunk('Tests/SomeTests.swift', ['HTTPURLResponse']),
    ];

    const result = findSwiftSymbolUsageAssociations(['Source/Core/HTTPHeaders.swift'], chunks);

    expect(result.get('Source/Core/HTTPHeaders.swift')).toBeUndefined();
  });

  it('does not exclude an extension of an in-project type that also has a real declaration', () => {
    // MultipartFormData is genuinely declared in-project; an extension of it
    // elsewhere is real, in-project structure, not a foreign-type FP shape.
    // (Two defining files means "not unique" under the conservative
    // uniqueness gate — this asserts the extension does NOT itself get
    // silently dropped, only that uniqueness still requires exactly one file.)
    const chunks: CodeChunk[] = [
      declChunk('Source/Core/MultipartFormData.swift', 'MultipartFormData'),
      extensionChunk('Source/Core/MultipartFormData+Encoding.swift', 'MultipartFormData'),
      testChunk('Tests/MultipartFormDataTests.swift', ['MultipartFormData']),
    ];

    const result = findSwiftSymbolUsageAssociations(
      ['Source/Core/MultipartFormData.swift', 'Source/Core/MultipartFormData+Encoding.swift'],
      chunks,
    );

    // Two real (non-foreign) definitions -> not unique -> no association for either file.
    expect(result.get('Source/Core/MultipartFormData.swift')).toBeUndefined();
    expect(result.get('Source/Core/MultipartFormData+Encoding.swift')).toBeUndefined();
  });

  it('ignores non-Swift chunks entirely (same-language gate)', () => {
    const chunks: CodeChunk[] = [
      makeChunk({
        file: 'src/TypeMap.ts',
        symbolName: 'TypeMap',
        symbolType: 'class',
        signature: 'class TypeMap',
        language: 'typescript',
      }),
      testChunk('Tests/TypeMapTests.swift', ['TypeMap']),
    ];

    const result = findSwiftSymbolUsageAssociations(['src/TypeMap.ts'], chunks);

    expect(result.get('src/TypeMap.ts')).toBeUndefined();
  });

  it('dedupes multiple test files and multiple call sites into one list', () => {
    const chunks: CodeChunk[] = [
      declChunk('Source/Core/RetryPolicy.swift', 'RetryPolicy'),
      testChunk('Tests/RetryPolicyTests.swift', ['RetryPolicy', 'RetryPolicy']),
      testChunk('Tests/RetryPolicyMoreTests.swift', ['RetryPolicy']),
    ];

    const result = findSwiftSymbolUsageAssociations(['Source/Core/RetryPolicy.swift'], chunks);

    expect(result.get('Source/Core/RetryPolicy.swift')).toEqual([
      'Tests/RetryPolicyTests.swift',
      'Tests/RetryPolicyMoreTests.swift',
    ]);
  });

  it('only reports associations for requested filepaths', () => {
    const chunks: CodeChunk[] = [
      declChunk('Source/Core/HTTPHeaders.swift', 'HTTPHeaders'),
      declChunk('Source/Core/RetryPolicy.swift', 'RetryPolicy'),
      testChunk('Tests/HTTPHeadersTests.swift', ['HTTPHeaders']),
      testChunk('Tests/RetryPolicyTests.swift', ['RetryPolicy']),
    ];

    const result = findSwiftSymbolUsageAssociations(['Source/Core/HTTPHeaders.swift'], chunks);

    expect(result.get('Source/Core/HTTPHeaders.swift')).toEqual(['Tests/HTTPHeadersTests.swift']);
    expect(result.has('Source/Core/RetryPolicy.swift')).toBe(false);
  });
});
