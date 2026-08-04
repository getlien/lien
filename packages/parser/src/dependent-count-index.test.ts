import { describe, it, expect } from 'vitest';
import type { CodeChunk } from './types.js';
import {
  computeDependentCountsFromChunks,
  computeDependentCountsBruteForce,
} from './dependent-count-index.js';

const ROOT = '/workspace';

function chunk(
  file: string,
  options: {
    imports?: string[];
    importedSymbols?: Record<string, string[]>;
    content?: string;
    language?: string;
  } = {},
): CodeChunk {
  return {
    content: options.content ?? '// body',
    metadata: {
      file,
      startLine: 1,
      endLine: 10,
      type: 'function',
      language: options.language ?? 'typescript',
      imports: options.imports ?? [],
      importedSymbols: options.importedSymbols,
    },
  } as CodeChunk;
}

/**
 * A multi-language corpus using each language's real specifier shape, as the
 * index actually stores it after extraction-time resolution. Every shape here
 * was read off a real indexed corpus (gin, anyhow, flask, serilog, Exposed,
 * javapoet, TCA) rather than guessed — the #1071 defect was originally reported
 * with a fabricated-looking Java case that the pipeline never actually stores,
 * so the fixtures are deliberately anchored to observed values.
 */
function multiLanguageCorpus(): CodeChunk[] {
  return [
    // TypeScript: relative specifiers.
    chunk('src/utils/logger.ts', { content: 'export function log() {}' }),
    chunk('src/a.ts', { imports: ['./utils/logger'] }),
    chunk('src/nested/deep/b.ts', { imports: ['../../utils/logger'] }),

    // Go: module-prefix-stripped package directory (#867/#887). Names a
    // DIRECTORY, so every .go file inside it is a member.
    chunk('internal/bytesconv/bytesconv.go', {
      language: 'go',
      content: 'func StringToBytes() {}',
    }),
    chunk('internal/bytesconv/helpers.go', { language: 'go', content: 'func pad() {}' }),
    chunk('tree.go', { language: 'go', imports: ['internal/bytesconv'] }),

    // Python: dotted package module (#901/#929).
    chunk('src/flask/app.py', { language: 'python', content: 'class Flask: pass' }),
    chunk('tests/test_app.py', { language: 'python', imports: ['src.flask.app'] }),

    // Java: an already-source-root-resolved path (#1046 rewrites the dotted FQN
    // at extraction time, so the stored specifier is a path, not `com.x.Y`).
    chunk('src/main/java/com/example/Widget.java', { language: 'java' }),
    chunk('src/main/java/com/example/App.java', {
      language: 'java',
      imports: ['src/main/java/com/example/Widget.java'],
    }),

    // Swift: whole-module import — deliberately unresolvable per file (#884).
    chunk('Sources/App/Feature.swift', { language: 'swift', imports: ['Foundation'] }),
    chunk('Sources/App/Foundation.swift', { language: 'swift', content: 'struct Wrapper {}' }),

    // PHP: PSR-4 namespace specifier (#1028).
    chunk('app/Models/Order.php', { language: 'php', content: 'class Order {}' }),
    chunk('app/Services/OrderService.php', { language: 'php', imports: ['App\\Models\\Order'] }),

    // A file that imports itself, and an external package nobody indexes.
    chunk('src/self.ts', { imports: ['./self', 'lodash'] }),
  ];
}

describe('computeDependentCountsFromChunks', () => {
  it('resolves relative specifiers from any directory depth', () => {
    const counts = computeDependentCountsFromChunks(multiLanguageCorpus(), ROOT);
    expect(counts.get('src/utils/logger.ts')).toBe(2);
  });

  it('resolves a Go package-directory specifier to every file in that package', () => {
    const counts = computeDependentCountsFromChunks(multiLanguageCorpus(), ROOT);
    // `internal/bytesconv` names the package, so both of its files gain the
    // importer — Go's real semantics, and what get_dependents already reports.
    expect(counts.get('internal/bytesconv/bytesconv.go')).toBe(1);
    expect(counts.get('internal/bytesconv/helpers.go')).toBe(1);
  });

  it('resolves a Python dotted module specifier', () => {
    const counts = computeDependentCountsFromChunks(multiLanguageCorpus(), ROOT);
    expect(counts.get('src/flask/app.py')).toBe(1);
  });

  it('resolves a PHP PSR-4 namespace specifier', () => {
    const counts = computeDependentCountsFromChunks(multiLanguageCorpus(), ROOT);
    expect(counts.get('app/Models/Order.php')).toBe(1);
  });

  it('leaves a Swift whole-module import unresolved rather than basename-matching it', () => {
    // The #884 guard: `import Foundation` must NOT attach to a file that merely
    // happens to be named Foundation.swift. This is the documented reason a
    // Swift corpus legitimately reads 0 everywhere.
    const counts = computeDependentCountsFromChunks(multiLanguageCorpus(), ROOT);
    expect(counts.get('Sources/App/Foundation.swift')).toBeUndefined();
  });

  it('never counts a file as its own dependent', () => {
    const counts = computeDependentCountsFromChunks(multiLanguageCorpus(), ROOT);
    expect(counts.get('src/self.ts')).toBeUndefined();
  });

  it('does not double count one importer that reaches a target twice', () => {
    const chunks = [
      chunk('src/utils/logger.ts'),
      // Same file, two chunks, plus a duplicate specifier and an importedSymbols
      // key naming the same module — still one dependent.
      chunk('src/a.ts', {
        imports: ['./utils/logger', './utils/logger'],
        importedSymbols: { './utils/logger': ['log'] },
      }),
      chunk('src/a.ts', { imports: ['./utils/logger'] }),
    ];
    expect(computeDependentCountsFromChunks(chunks, ROOT).get('src/utils/logger.ts')).toBe(1);
  });

  it('counts an importedSymbols key with no matching `imports` entry', () => {
    const chunks = [
      chunk('src/utils/logger.ts'),
      chunk('src/a.ts', { importedSymbols: { './utils/logger': ['log'] } }),
    ];
    expect(computeDependentCountsFromChunks(chunks, ROOT).get('src/utils/logger.ts')).toBe(1);
  });

  it('omits files with no dependents entirely (a zero is an absent key)', () => {
    const counts = computeDependentCountsFromChunks([chunk('src/lonely.ts')], ROOT);
    expect(counts.size).toBe(0);
  });

  it('keys the result on the raw file string, not a normalized path', () => {
    const chunks = [
      chunk('/workspace/src/utils/logger.ts'),
      chunk('/workspace/src/a.ts', { imports: ['./utils/logger'] }),
    ];
    const counts = computeDependentCountsFromChunks(chunks, ROOT);
    expect(counts.get('/workspace/src/utils/logger.ts')).toBe(1);
    expect(counts.get('src/utils/logger')).toBeUndefined();
  });

  it('tolerates a chunk with no file and an empty specifier', () => {
    const chunks = [
      chunk('src/a.ts', { imports: ['', './b'] }),
      chunk('src/b.ts'),
      { content: 'x', metadata: { file: '', startLine: 1, endLine: 1 } } as CodeChunk,
    ];
    const counts = computeDependentCountsFromChunks(chunks, ROOT);
    expect(counts.get('src/b.ts')).toBe(1);
  });
});

/**
 * The property that makes the candidate index a pruning OPTIMIZATION rather than
 * a third import-matching dialect: for the same chunk set, the pruned pass and
 * the unpruned cross product must agree exactly. If the necessary condition the
 * candidate keys encode (see the module doc) were ever too narrow, this is what
 * catches it — silently, otherwise, the pruned pass would just lose edges and
 * report a plausible-looking smaller number.
 *
 * Also verified out-of-band against eight real corpora (serilog, OrchardCore,
 * Exposed, TCA, javapoet, gin, anyhow, flask): 0 mismatches on all of them, with
 * the pruned pass up to 20x faster.
 */
describe('candidate pruning is exact (brute-force equivalence)', () => {
  const corpora: Record<string, CodeChunk[]> = {
    'multi-language': multiLanguageCorpus(),
    'deep relative chains': [
      chunk('src/a/b/c/target.ts'),
      chunk('src/a/b/c/d/e/f.ts', { imports: ['../../target'] }),
      chunk('src/a/other.ts', { imports: ['./b/c/target'] }),
    ],
    'dotted segments in file names': [
      // A file whose own basename carries dots — the `charAfter === '.'` edge in
      // matchesWithSourcePrefix that `allKeys`'s dot-parts exist for.
      chunk('src/Serilog.Core/Enrichers.cs', { language: 'csharp' }),
      chunk('src/App.cs', { language: 'csharp', imports: ['Serilog.Core.Enrichers'] }),
      chunk('src/pkg/mod.thing.py', { language: 'python', imports: ['pkg.mod'] }),
    ],
    'ambiguous basenames across directories': [
      chunk('src/one/index.ts'),
      chunk('src/two/index.ts'),
      chunk('src/three.ts', { imports: ['./one', './two/index'] }),
    ],
    'rust mod and crate specifiers': [
      chunk('tests/common/mod.rs', { language: 'rust' }),
      chunk('tests/test_macros.rs', { language: 'rust', imports: ['tests/common'] }),
      chunk('src/error.rs', { language: 'rust', imports: ['crate::error'] }),
    ],
  };

  for (const [name, chunks] of Object.entries(corpora)) {
    it(`agrees with the brute-force cross product: ${name}`, () => {
      const pruned = computeDependentCountsFromChunks(chunks, ROOT);
      const brute = computeDependentCountsBruteForce(chunks, ROOT);
      // Compare as sorted entry lists so a missing key fails loudly with the
      // whole diff visible, not as an undefined-vs-0 near miss.
      const normalize = (m: Map<string, number>) => [...m.entries()].sort();
      expect(normalize(pruned)).toEqual(normalize(brute));
    });
  }
});
