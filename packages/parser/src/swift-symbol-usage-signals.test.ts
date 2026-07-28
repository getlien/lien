import { describe, it, expect } from 'vitest';
import {
  findSwiftSymbolUsageAssociations,
  isMultiSegmentIdentifier,
} from './swift-symbol-usage-signals.js';
import type { CodeChunk } from './types.js';

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

  it('associates via a method-level symbol (not just the type name)', () => {
    const chunks: CodeChunk[] = [
      declChunk('Source/Core/Request.swift', 'Request'),
      methodChunk('Source/Core/Request.swift', 'prepareForRetry'),
      testChunk('Tests/RequestTests.swift', ['prepareForRetry']),
    ];

    const result = findSwiftSymbolUsageAssociations(['Source/Core/Request.swift'], chunks);

    expect(result.get('Source/Core/Request.swift')).toEqual(['Tests/RequestTests.swift']);
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
