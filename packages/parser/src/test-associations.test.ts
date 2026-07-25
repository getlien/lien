import { describe, it, expect } from 'vitest';
import { findTestAssociationsFromChunks } from './test-associations.js';
import type { CodeChunk } from './types.js';

function makeChunk(file: string, imports: string[] = []): CodeChunk {
  return {
    content: '',
    metadata: {
      file,
      startLine: 1,
      endLine: 10,
      type: 'function',
      imports,
    },
  };
}

describe('findTestAssociationsFromChunks', () => {
  it('finds test files that import the target', () => {
    const chunks: CodeChunk[] = [
      makeChunk('src/auth.ts'),
      makeChunk('src/__tests__/auth.test.ts', ['../auth']),
      makeChunk('src/utils.ts'),
    ];

    const result = findTestAssociationsFromChunks(['src/auth.ts'], chunks);

    expect(result.get('src/auth.ts')).toEqual(['src/__tests__/auth.test.ts']);
  });

  it('returns empty map for files with no test associations', () => {
    const chunks: CodeChunk[] = [makeChunk('src/auth.ts'), makeChunk('src/utils.ts')];

    const result = findTestAssociationsFromChunks(['src/auth.ts'], chunks);

    expect(result.has('src/auth.ts')).toBe(false);
  });

  it('finds multiple test files for one source', () => {
    const chunks: CodeChunk[] = [
      makeChunk('src/auth.ts'),
      makeChunk('src/__tests__/auth.test.ts', ['../auth']),
      makeChunk('src/__tests__/auth.spec.ts', ['../auth']),
    ];

    const result = findTestAssociationsFromChunks(['src/auth.ts'], chunks);

    expect(result.get('src/auth.ts')).toHaveLength(2);
    expect(result.get('src/auth.ts')).toContain('src/__tests__/auth.test.ts');
    expect(result.get('src/auth.ts')).toContain('src/__tests__/auth.spec.ts');
  });

  it('handles multiple source files', () => {
    const chunks: CodeChunk[] = [
      makeChunk('src/auth.ts'),
      makeChunk('src/user.ts'),
      makeChunk('src/__tests__/auth.test.ts', ['../auth']),
      makeChunk('test/user.test.ts', ['../src/user']),
    ];

    const result = findTestAssociationsFromChunks(['src/auth.ts', 'src/user.ts'], chunks);

    expect(result.get('src/auth.ts')).toEqual(['src/__tests__/auth.test.ts']);
    expect(result.get('src/user.ts')).toEqual(['test/user.test.ts']);
  });

  it('ignores non-test files even if they import the target', () => {
    const chunks: CodeChunk[] = [
      makeChunk('src/auth.ts'),
      makeChunk('src/login.ts', ['./auth']), // Not a test file
      makeChunk('src/__tests__/auth.test.ts', ['../auth']),
    ];

    const result = findTestAssociationsFromChunks(['src/auth.ts'], chunks);

    expect(result.get('src/auth.ts')).toEqual(['src/__tests__/auth.test.ts']);
  });

  it('deduplicates test files across multiple chunks', () => {
    const chunks: CodeChunk[] = [
      makeChunk('src/auth.ts'),
      // Same test file appears in two chunks (e.g., two functions)
      makeChunk('src/__tests__/auth.test.ts', ['../auth']),
      makeChunk('src/__tests__/auth.test.ts', ['../auth', '../utils']),
    ];

    const result = findTestAssociationsFromChunks(['src/auth.ts'], chunks);

    expect(result.get('src/auth.ts')).toEqual(['src/__tests__/auth.test.ts']);
  });

  describe('whole-module-import basename hub (#884)', () => {
    it('does not associate a Swift file whose basename equals the module name with every whole-module test', () => {
      // The Alamofire shape: every test file does a bare `import Alamofire`
      // (whole-module), and Source/Alamofire.swift's own basename happens to
      // equal the module name. Before #884 this fell inside #868/#883's
      // deliberate one-leading-segment leniency and falsely hubbed every
      // test file onto this 43-line stub.
      const chunks: CodeChunk[] = [
        makeChunk('Source/Alamofire.swift'),
        makeChunk('Tests/SessionTests.swift', ['Alamofire']),
        makeChunk('Tests/ValidationTests.swift', ['Alamofire']),
      ];

      const result = findTestAssociationsFromChunks(['Source/Alamofire.swift'], chunks);

      expect(result.has('Source/Alamofire.swift')).toBe(false);
    });

    it('still associates a real Rust file via the identical one-leading-segment shape', () => {
      // Same shape (bare import, one leading directory, basename match) but
      // Rust is not a wholeModuleImports language, so the legitimate
      // source-directory-prefix convention must keep working.
      const chunks: CodeChunk[] = [
        makeChunk('src/auth.rs'),
        makeChunk('tests/auth_test.rs', ['auth']),
      ];

      const result = findTestAssociationsFromChunks(['src/auth.rs'], chunks);

      expect(result.get('src/auth.rs')).toEqual(['tests/auth_test.rs']);
    });

    it('leaves other Swift files alone when their imports are not bare whole-module hits', () => {
      // A qualified/path-like import from a Swift test file is not the bare
      // whole-module case the #884 guard targets, so normal matching still
      // applies.
      const chunks: CodeChunk[] = [
        makeChunk('Source/Networking/Session.swift'),
        makeChunk('Tests/SessionTests.swift', ['./Networking/Session']),
      ];

      const result = findTestAssociationsFromChunks(['Source/Networking/Session.swift'], chunks);

      expect(result.get('Source/Networking/Session.swift')).toEqual(['Tests/SessionTests.swift']);
    });
  });

  describe('PHP FQCN-reference association (#878)', () => {
    // These chunks model the shape `PHPImportExtractor.extractReferencedFQCNs`
    // (ast/languages/php.ts) plus PSR-4 resolution (php-psr4.ts) actually
    // produce -- a workspace-relative path merged into `imports` alongside
    // any real `use`-based imports, with no per-node distinction left by the
    // time it reaches this layer. See ast/chunker.test.ts and
    // ast/languages/php.test.ts for coverage of the extraction step itself.
    it('associates a test file that references the class only via a fully-qualified `new`, no `use` import at all', () => {
      const chunks: CodeChunk[] = [
        makeChunk('src/RetryMiddleware.php'),
        makeChunk('tests/RetryMiddlewareTest.php', ['src/RetryMiddleware']),
      ];

      const result = findTestAssociationsFromChunks(['src/RetryMiddleware.php'], chunks);

      expect(result.get('src/RetryMiddleware.php')).toEqual(['tests/RetryMiddlewareTest.php']);
    });

    it('honestly finds no association for the factory-indirection remainder (no signal in either file)', () => {
      // The real, unresolved guzzle shape: the test only ever names the
      // factory (`Middleware`), never `RetryMiddleware` itself -- that name
      // lives exclusively inside Middleware.php, a different file. No
      // extraction change can manufacture a signal that isn't textually
      // present anywhere in the test file; this is #878's honest remainder.
      const chunks: CodeChunk[] = [
        makeChunk('src/RetryMiddleware.php'),
        makeChunk('src/Middleware.php'),
        makeChunk('tests/RetryMiddlewareTest.php', ['src/Middleware']),
      ];

      const result = findTestAssociationsFromChunks(['src/RetryMiddleware.php'], chunks);

      expect(result.has('src/RetryMiddleware.php')).toBe(false);
    });
  });
});
