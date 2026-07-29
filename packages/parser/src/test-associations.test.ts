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

  describe('Go same-package test convention, tier 1 basename pairing (#902)', () => {
    it('associates foo.go with foo_test.go in the same directory, with no import at all', () => {
      // The dominant Go shape: package foo in both files, zero import
      // statement -- Go forbids a package importing itself.
      const chunks: CodeChunk[] = [
        makeChunk('pkg/cmd/label/list.go'),
        makeChunk('pkg/cmd/label/list_test.go'),
      ];

      const result = findTestAssociationsFromChunks(['pkg/cmd/label/list.go'], chunks);

      expect(result.get('pkg/cmd/label/list.go')).toEqual(['pkg/cmd/label/list_test.go']);
    });

    it('still basename-pairs an external test package file (package foo_test) sharing the directory', () => {
      // Basename pairing is deliberately package-clause-blind (#902's
      // design): an external `package foo_test` file still sits in the same
      // directory, so it pairs the same way -- no double-counting risk
      // since the result is a Set.
      const chunks: CodeChunk[] = [
        makeChunk('internal/prompter/prompter.go'),
        makeChunk('internal/prompter/prompter_test.go'),
      ];

      const result = findTestAssociationsFromChunks(['internal/prompter/prompter.go'], chunks);

      expect(result.get('internal/prompter/prompter.go')).toEqual([
        'internal/prompter/prompter_test.go',
      ]);
    });

    it('does not fan out to every test file in a directory -- only the exact basename pair', () => {
      // internal/licenses shape: several sibling .go files, one test file
      // named after only ONE of them. The others get nothing from tier 1
      // (they may get tier 2's package-level fallback -- lien annotate only,
      // not this function -- see annotate-cmd.test.ts).
      const chunks: CodeChunk[] = [
        makeChunk('internal/licenses/licenses.go'),
        makeChunk('internal/licenses/embed_linux_amd64.go'),
        makeChunk('internal/licenses/licenses_test.go'),
      ];

      const result = findTestAssociationsFromChunks(
        ['internal/licenses/licenses.go', 'internal/licenses/embed_linux_amd64.go'],
        chunks,
      );

      expect(result.get('internal/licenses/licenses.go')).toEqual([
        'internal/licenses/licenses_test.go',
      ]);
      expect(result.has('internal/licenses/embed_linux_amd64.go')).toBe(false);
    });

    it('reports no association for a genuinely untested Go file (no _test.go sibling at all)', () => {
      const chunks: CodeChunk[] = [
        makeChunk('pkg/cmd/label/list.go'),
        makeChunk('pkg/cmd/label/list_test.go'),
        makeChunk('pkg/cmd/label/untested.go'),
      ];

      const result = findTestAssociationsFromChunks(['pkg/cmd/label/untested.go'], chunks);

      expect(result.has('pkg/cmd/label/untested.go')).toBe(false);
    });

    it('composes with a real cross-package import match without duplicating the test file', () => {
      const chunks: CodeChunk[] = [
        makeChunk('pkg/cmd/label/list.go'),
        makeChunk('pkg/cmd/label/list_test.go'),
        makeChunk('pkg/cmd/other/other_test.go', ['pkg/cmd/label']),
      ];

      const result = findTestAssociationsFromChunks(['pkg/cmd/label/list.go'], chunks);

      expect(result.get('pkg/cmd/label/list.go')).toHaveLength(2);
      expect(result.get('pkg/cmd/label/list.go')).toContain('pkg/cmd/label/list_test.go');
      expect(result.get('pkg/cmd/label/list.go')).toContain('pkg/cmd/other/other_test.go');
    });

    it('does not apply the same-directory convention to a non-Go language', () => {
      // A same-named, same-directory pair in a language without
      // sameDirectoryTestConvention set must not get this treatment --
      // only real import-based matching applies.
      const chunks: CodeChunk[] = [
        makeChunk('src/list.ts'),
        makeChunk('src/list_test.ts'), // no import -- would only match via Go's convention
      ];

      const result = findTestAssociationsFromChunks(['src/list.ts'], chunks);

      expect(result.has('src/list.ts')).toBe(false);
    });
  });

  describe('direct-importer ranking (#929)', () => {
    // The real hono repro: `src/utils/jwt/jwt.test.ts` imports `./jws`
    // directly (an exact, unambiguous reference), but scan order alone
    // decided display order, so this genuine direct importer sorted behind
    // several other real-but-fuzzier matches and was truncated out of
    // `lien annotate`'s "Test coverage" line entirely. A direct importer
    // must be included AND ranked ahead of a fuzzy match, not merely
    // present somewhere in the result.
    it('ranks an exact direct importer ahead of a fuzzy match, even when the fuzzy match is scanned first', () => {
      const chunks: CodeChunk[] = [
        makeChunk('src/auth.rs'),
        // Scanned FIRST: only matches via Strategy 2's bare "source
        // directory prefix" leniency (a real match, but not a direct
        // reference to the target's own resolved path).
        makeChunk('tests/other_test.rs', ['auth']),
        // Scanned SECOND: its own import resolves to exactly the target's
        // normalized path -- the direct, unambiguous reference.
        makeChunk('tests/auth_direct_test.rs', ['src/auth']),
      ];

      const result = findTestAssociationsFromChunks(['src/auth.rs'], chunks);

      expect(result.get('src/auth.rs')).toEqual([
        'tests/auth_direct_test.rs',
        'tests/other_test.rs',
      ]);
    });

    it('still finds only the fuzzy match when no exact importer exists', () => {
      const chunks: CodeChunk[] = [
        makeChunk('src/auth.rs'),
        makeChunk('tests/other_test.rs', ['auth']),
      ];

      const result = findTestAssociationsFromChunks(['src/auth.rs'], chunks);

      expect(result.get('src/auth.rs')).toEqual(['tests/other_test.rs']);
    });

    it('does not let a Swift whole-module bare import jump the exact-match queue ahead of a real direct importer', () => {
      // The #884 Alamofire shape, reintroduced one layer up: a top-level
      // Swift file whose basename equals its own module name means a bare
      // `import Alamofire` (whole-module -- Swift's SwiftImportExtractor
      // never emits a per-file specifier) normalizes to literally the same
      // string as the target itself. Without the whole-module guard on the
      // exact-match check, this satisfies `normalize(imp) ===
      // normalizedTarget` and gets promoted straight into the trusted
      // `exact` bucket ahead of `AlamofireTests.swift`'s genuine, qualified
      // direct import. The guard rejects the bare whole-module "match"
      // entirely (mirroring the existing #884 test above), not merely
      // de-prioritizes it -- `importMatchesTarget`'s own #884 guard excludes
      // it from the fuzzy bucket too, so it must not appear in the result
      // at all.
      const chunks: CodeChunk[] = [
        makeChunk('Alamofire.swift'),
        // Scanned FIRST: bare whole-module import, coincidentally identical
        // to the target's own normalized path -- must NOT count as exact,
        // and (like every other whole-module import) is rejected outright.
        makeChunk('OtherTests.swift', ['Alamofire']),
        // Scanned SECOND: a real, qualified direct import.
        makeChunk('AlamofireTests.swift', ['./Alamofire']),
      ];

      const result = findTestAssociationsFromChunks(['Alamofire.swift'], chunks);

      expect(result.get('Alamofire.swift')).toEqual(['AlamofireTests.swift']);
    });
  });
});
