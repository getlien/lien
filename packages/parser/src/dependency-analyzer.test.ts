import { describe, it, expect } from 'vitest';
import {
  analyzeDependencies,
  findReExportedSymbolsForFile,
  chunkImportsFrom,
  COMPLEXITY_THRESHOLDS,
} from './dependency-analyzer.js';
import { chunkByAST } from './ast/chunker.js';
import type { CodeChunk, ChunkMetadata } from './types.js';

describe('analyzeDependencies', () => {
  const workspaceRoot = '/test/workspace';

  function createChunk(
    file: string,
    imports: string[] = [],
    complexity?: number,
    options?: {
      exports?: string[];
      importedSymbols?: Record<string, string[]>;
    },
  ): CodeChunk {
    return {
      content: 'test content',
      metadata: {
        file,
        startLine: 1,
        endLine: 10,
        type: 'function',
        language: 'typescript',
        imports,
        complexity,
        ...(options?.exports && { exports: options.exports }),
        ...(options?.importedSymbols && { importedSymbols: options.importedSymbols }),
      } as ChunkMetadata,
    };
  }

  it('should find direct dependents', () => {
    const chunks: CodeChunk[] = [
      createChunk('src/utils.ts', []),
      createChunk('src/app.ts', ['src/utils.ts']),
      createChunk('src/config.ts', ['src/utils.ts']),
    ];

    const result = analyzeDependencies('src/utils.ts', chunks, workspaceRoot);

    expect(result.dependentCount).toBe(2);
    expect(result.dependents.map(d => d.filepath)).toEqual(
      expect.arrayContaining(['src/app.ts', 'src/config.ts']),
    );
  });

  it('should calculate risk level based on dependent count', () => {
    const chunks: CodeChunk[] = [
      createChunk('src/utils.ts', []),
      // Add dependents up to LOW threshold (5)
      ...Array.from({ length: 3 }, (_, i) => createChunk(`src/dep${i}.ts`, ['src/utils.ts'])),
    ];

    const result = analyzeDependencies('src/utils.ts', chunks, workspaceRoot);
    expect(result.riskLevel).toBe('low');
  });

  it('should boost risk level to medium with more dependents', () => {
    const chunks: CodeChunk[] = [
      createChunk('src/utils.ts', []),
      // Add dependents between LOW and MEDIUM threshold (5-15)
      ...Array.from({ length: 10 }, (_, i) => createChunk(`src/dep${i}.ts`, ['src/utils.ts'])),
    ];

    const result = analyzeDependencies('src/utils.ts', chunks, workspaceRoot);
    expect(result.riskLevel).toBe('medium');
  });

  it('should boost risk level to high with many dependents', () => {
    const chunks: CodeChunk[] = [
      createChunk('src/utils.ts', []),
      // Add dependents between MEDIUM and HIGH threshold (15-30)
      ...Array.from({ length: 20 }, (_, i) => createChunk(`src/dep${i}.ts`, ['src/utils.ts'])),
    ];

    const result = analyzeDependencies('src/utils.ts', chunks, workspaceRoot);
    expect(result.riskLevel).toBe('high');
  });

  it('should boost risk level to critical with very many dependents', () => {
    const chunks: CodeChunk[] = [
      createChunk('src/utils.ts', []),
      // Add more than HIGH threshold (30+)
      ...Array.from({ length: 35 }, (_, i) => createChunk(`src/dep${i}.ts`, ['src/utils.ts'])),
    ];

    const result = analyzeDependencies('src/utils.ts', chunks, workspaceRoot);
    expect(result.riskLevel).toBe('critical');
  });

  it('should calculate complexity metrics for dependents', () => {
    const chunks: CodeChunk[] = [
      createChunk('src/utils.ts', []),
      createChunk('src/app.ts', ['src/utils.ts'], 15),
      createChunk('src/config.ts', ['src/utils.ts'], 25),
      createChunk('src/helper.ts', ['src/utils.ts'], 5),
    ];

    const result = analyzeDependencies('src/utils.ts', chunks, workspaceRoot);

    expect(result.complexityMetrics).toBeDefined();
    expect(result.complexityMetrics!.filesWithComplexityData).toBe(3);
    expect(result.complexityMetrics!.maxComplexity).toBe(25);
    expect(result.complexityMetrics!.averageComplexity).toBeCloseTo((15 + 25 + 5) / 3, 1);
  });

  it('should boost risk level based on complexity metrics', () => {
    const chunks: CodeChunk[] = [
      createChunk('src/utils.ts', []),
      // Only 3 dependents (LOW risk by count), but high complexity
      createChunk('src/app.ts', ['src/utils.ts'], 30), // High complexity
      createChunk('src/config.ts', ['src/utils.ts'], 28),
      createChunk('src/helper.ts', ['src/utils.ts'], 26),
    ];

    const result = analyzeDependencies('src/utils.ts', chunks, workspaceRoot);

    // Should be boosted from 'low' (by count) to 'critical' (by complexity)
    expect(result.dependentCount).toBe(3); // Only 3 dependents
    expect(result.complexityMetrics!.maxComplexity).toBeGreaterThan(
      COMPLEXITY_THRESHOLDS.CRITICAL_MAX,
    );
    expect(result.riskLevel).toBe('critical');
  });

  it('should identify high-complexity dependents', () => {
    const chunks: CodeChunk[] = [
      createChunk('src/utils.ts', []),
      createChunk('src/app.ts', ['src/utils.ts'], 25),
      createChunk('src/config.ts', ['src/utils.ts'], 15),
      createChunk('src/helper.ts', ['src/utils.ts'], 5),
      createChunk('src/api.ts', ['src/utils.ts'], 18),
    ];

    const result = analyzeDependencies('src/utils.ts', chunks, workspaceRoot);

    expect(result.complexityMetrics?.highComplexityDependents).toBeDefined();
    const highComplexFiles = result.complexityMetrics!.highComplexityDependents.map(
      d => d.filepath,
    );

    // Should include files with complexity > HIGH_COMPLEXITY_DEPENDENT (10)
    expect(highComplexFiles).toContain('src/app.ts');
    expect(highComplexFiles).toContain('src/config.ts');
    expect(highComplexFiles).toContain('src/api.ts');
    expect(highComplexFiles).not.toContain('src/helper.ts'); // 5 is below threshold
  });

  it('should handle files with no dependents', () => {
    const chunks: CodeChunk[] = [
      createChunk('src/utils.ts', []),
      createChunk('src/app.ts', ['src/other.ts']),
    ];

    const result = analyzeDependencies('src/utils.ts', chunks, workspaceRoot);

    expect(result.dependentCount).toBe(0);
    expect(result.dependents).toHaveLength(0);
    expect(result.riskLevel).toBe('low');
  });

  it('should identify test files correctly', () => {
    const chunks: CodeChunk[] = [
      createChunk('src/utils.ts', []),
      createChunk('src/app.ts', ['src/utils.ts']),
      createChunk('src/utils.test.ts', ['src/utils.ts']),
      createChunk('tests/utils.spec.ts', ['src/utils.ts']),
    ];

    const result = analyzeDependencies('src/utils.ts', chunks, workspaceRoot);

    expect(result.dependentCount).toBe(3);

    const testFiles = result.dependents.filter(d => d.isTestFile);
    const sourceFiles = result.dependents.filter(d => !d.isTestFile);

    expect(testFiles).toHaveLength(2);
    expect(sourceFiles).toHaveLength(1);
  });

  it('should deduplicate chunks from the same file', () => {
    const chunks: CodeChunk[] = [
      createChunk('src/utils.ts', []),
      // Multiple chunks from same dependent file
      {
        ...createChunk('src/app.ts', ['src/utils.ts'], 10),
        metadata: {
          ...createChunk('src/app.ts', ['src/utils.ts'], 10).metadata,
          startLine: 1,
          endLine: 50,
        } as ChunkMetadata,
      },
      {
        ...createChunk('src/app.ts', ['src/utils.ts'], 15),
        metadata: {
          ...createChunk('src/app.ts', ['src/utils.ts'], 15).metadata,
          startLine: 51,
          endLine: 100,
        } as ChunkMetadata,
      },
      {
        ...createChunk('src/app.ts', ['src/utils.ts'], 20),
        metadata: {
          ...createChunk('src/app.ts', ['src/utils.ts'], 20).metadata,
          startLine: 101,
          endLine: 150,
        } as ChunkMetadata,
      },
    ];

    const result = analyzeDependencies('src/utils.ts', chunks, workspaceRoot);

    // Should count as 1 dependent file, not 3
    expect(result.dependentCount).toBe(1);
    expect(result.dependents).toHaveLength(1);
    expect(result.dependents[0].filepath).toBe('src/app.ts');

    // But complexity metrics should aggregate all chunks
    expect(result.complexityMetrics?.maxComplexity).toBe(20);
  });

  it('should handle chunks without complexity data', () => {
    const chunks: CodeChunk[] = [
      createChunk('src/utils.ts', []),
      createChunk('src/app.ts', ['src/utils.ts']), // No complexity
      createChunk('src/config.ts', ['src/utils.ts'], 15),
    ];

    const result = analyzeDependencies('src/utils.ts', chunks, workspaceRoot);

    expect(result.dependentCount).toBe(2);
    expect(result.complexityMetrics?.filesWithComplexityData).toBe(1); // Only src/config.ts has complexity
    expect(result.complexityMetrics?.maxComplexity).toBe(15);
  });

  it('should return low risk when no complexity data available', () => {
    const chunks: CodeChunk[] = [
      createChunk('src/utils.ts', []),
      createChunk('src/app.ts', ['src/utils.ts']), // No complexity
      createChunk('src/config.ts', ['src/utils.ts']), // No complexity
    ];

    const result = analyzeDependencies('src/utils.ts', chunks, workspaceRoot);

    expect(result.dependentCount).toBe(2);
    expect(result.riskLevel).toBe('low'); // 2 dependents = low risk by count
    expect(result.complexityMetrics).toBeUndefined(); // No complexity data
  });

  describe('barrel re-export tracking', () => {
    it('should not flag "imports target + exports unrelated" as a re-exporter (#526)', () => {
      // a.ts is the target. b.ts uses fnA from a but exports a different symbol
      // (fnB). Pre-fix, b was wrongly flagged as a re-exporter — any consumer of
      // b (like c.ts) would then be pulled in as a transitive dependent of a.
      const chunks: CodeChunk[] = [
        createChunk('src/a.ts', [], undefined, { exports: ['fnA'] }),
        createChunk('src/b.ts', ['src/a.ts'], undefined, {
          exports: ['fnB'],
          importedSymbols: { './a': ['fnA'] },
        }),
        createChunk('src/c.ts', ['src/b.ts'], undefined, {
          importedSymbols: { './b': ['fnB'] },
        }),
      ];

      const result = analyzeDependencies('src/a.ts', chunks, workspaceRoot);

      const dependentPaths = result.dependents.map(d => d.filepath);
      expect(dependentPaths).toContain('src/b.ts'); // direct, correct
      expect(dependentPaths).not.toContain('src/c.ts'); // must not leak through b
    });

    it('should short-circuit on a Rust-style "*" wildcard glob import', () => {
      // Rust `use foo::*` writes a '*' marker into importedSymbols. A file
      // that glob-imports the target AND exports anything counts as re-
      // exporting everything the target exports.
      const chunks: CodeChunk[] = [
        createChunk('src/a.ts', [], undefined, { exports: ['fnA'] }),
        createChunk('src/b.ts', ['src/a.ts'], undefined, {
          importedSymbols: { './a': ['*'] },
          exports: ['fnA'],
        }),
        createChunk('src/c.ts', ['src/b.ts'], undefined, {
          importedSymbols: { './b': ['fnA'] },
        }),
      ];

      const result = analyzeDependencies('src/a.ts', chunks, workspaceRoot);

      const dependentPaths = result.dependents.map(d => d.filepath);
      expect(dependentPaths).toContain('src/b.ts'); // direct
      expect(dependentPaths).toContain('src/c.ts'); // transitive via glob re-export
    });

    it('should short-circuit on a JS-style "* as ns" namespace import', () => {
      // `import * as ns from './a'; export { ns };` → importedSymbols stores
      // '* as ns' and exports lists 'ns'. b counts as a re-exporter because
      // the namespace import pulls in everything.
      const chunks: CodeChunk[] = [
        createChunk('src/a.ts', [], undefined, { exports: ['fnA'] }),
        createChunk('src/b.ts', ['src/a.ts'], undefined, {
          importedSymbols: { './a': ['* as ns'] },
          exports: ['ns'],
        }),
        createChunk('src/c.ts', ['src/b.ts'], undefined, {
          importedSymbols: { './b': ['ns'] },
        }),
      ];

      const result = analyzeDependencies('src/a.ts', chunks, workspaceRoot);

      const dependentPaths = result.dependents.map(d => d.filepath);
      expect(dependentPaths).toContain('src/b.ts');
      expect(dependentPaths).toContain('src/c.ts');
    });

    it('should find transitive dependents through barrel files', () => {
      // auth.ts → index.ts (re-exports) → handler.ts (imports from index)
      const chunks: CodeChunk[] = [
        // Target file
        createChunk('src/auth.ts', [], undefined, {
          exports: ['AuthService'],
        }),
        // Barrel file: imports from auth.ts, exports AuthService
        createChunk('src/index.ts', ['src/auth.ts'], undefined, {
          exports: ['AuthService'],
          importedSymbols: { './auth': ['AuthService'] },
        }),
        // Consumer: imports from index.ts (the barrel)
        createChunk('src/handler.ts', ['src/index.ts'], undefined, {
          importedSymbols: { './index': ['AuthService'] },
        }),
      ];

      const result = analyzeDependencies('src/auth.ts', chunks, workspaceRoot);

      const dependentPaths = result.dependents.map(d => d.filepath);
      // Should find both the barrel file (direct) and the handler (transitive)
      expect(dependentPaths).toContain('src/index.ts');
      expect(dependentPaths).toContain('src/handler.ts');
      expect(result.dependentCount).toBe(2);
    });

    it('should find dependents through chained re-exports', () => {
      // target → barrel1 → barrel2 → consumer
      const chunks: CodeChunk[] = [
        createChunk('src/core/validate.ts', [], undefined, {
          exports: ['validateEmail'],
        }),
        // First barrel: re-exports from validate.ts
        createChunk('src/core/index.ts', ['src/core/validate.ts'], undefined, {
          exports: ['validateEmail'],
          importedSymbols: { './validate': ['validateEmail'] },
        }),
        // Second barrel: re-exports from core/index.ts
        createChunk('src/index.ts', ['src/core/index.ts'], undefined, {
          exports: ['validateEmail'],
          importedSymbols: { './core/index': ['validateEmail'] },
        }),
        // Consumer: imports from top-level barrel
        createChunk('src/app.ts', ['src/index.ts'], undefined, {
          importedSymbols: { './index': ['validateEmail'] },
        }),
      ];

      const result = analyzeDependencies('src/core/validate.ts', chunks, workspaceRoot);

      const dependentPaths = result.dependents.map(d => d.filepath);
      expect(dependentPaths).toContain('src/core/index.ts');
      expect(dependentPaths).toContain('src/index.ts');
      expect(dependentPaths).toContain('src/app.ts');
      expect(result.dependentCount).toBe(3);
    });

    it('should handle cyclic import graphs with re-exports without infinite loops', () => {
      // a.ts and b.ts import from each other (cyclic import graph). b genuinely
      // re-exports foo from a, and c imports foo via b — so c is a transitive
      // dependent of a. The BFS must terminate despite the cycle.
      const chunks: CodeChunk[] = [
        createChunk('src/a.ts', ['src/b.ts'], undefined, {
          exports: ['foo'],
          importedSymbols: { './b': ['bar'] },
        }),
        createChunk('src/b.ts', ['src/a.ts'], undefined, {
          // b re-exports foo (imported from a AND listed in exports).
          exports: ['foo', 'bar'],
          importedSymbols: { './a': ['foo'] },
        }),
        createChunk('src/c.ts', ['src/b.ts'], undefined, {
          importedSymbols: { './b': ['foo'] },
        }),
      ];

      // Should not hang — circular detection prevents infinite traversal
      const result = analyzeDependencies('src/a.ts', chunks, workspaceRoot);

      const dependentPaths = result.dependents.map(d => d.filepath);
      expect(dependentPaths).toContain('src/b.ts');
      expect(dependentPaths).toContain('src/c.ts');
    });

    it('should not produce false positives for unrelated barrel exports', () => {
      // barrel exports from different source, not target
      const chunks: CodeChunk[] = [
        createChunk('src/target.ts', [], undefined, {
          exports: ['targetFn'],
        }),
        // Barrel imports from OTHER file, not target
        createChunk('src/barrel.ts', ['src/other.ts'], undefined, {
          exports: ['otherFn'],
          importedSymbols: { './other': ['otherFn'] },
        }),
        // Consumer imports from barrel
        createChunk('src/consumer.ts', ['src/barrel.ts'], undefined, {
          importedSymbols: { './barrel': ['otherFn'] },
        }),
      ];

      const result = analyzeDependencies('src/target.ts', chunks, workspaceRoot);

      // Consumer should NOT be a dependent of target.ts
      expect(result.dependentCount).toBe(0);
    });

    it('should deduplicate mixed direct and transitive dependents', () => {
      const chunks: CodeChunk[] = [
        createChunk('src/auth.ts', [], undefined, {
          exports: ['AuthService'],
        }),
        // Barrel re-exports
        createChunk('src/index.ts', ['src/auth.ts'], undefined, {
          exports: ['AuthService'],
          importedSymbols: { './auth': ['AuthService'] },
        }),
        // Consumer imports from both auth.ts directly AND via barrel
        createChunk('src/handler.ts', ['src/auth.ts', 'src/index.ts'], undefined, {
          importedSymbols: { './auth': ['AuthService'], './index': ['AuthService'] },
        }),
      ];

      const result = analyzeDependencies('src/auth.ts', chunks, workspaceRoot);

      const dependentPaths = result.dependents.map(d => d.filepath);
      expect(dependentPaths).toContain('src/handler.ts');
      // handler.ts should appear only once, not twice
      expect(dependentPaths.filter(p => p === 'src/handler.ts')).toHaveLength(1);
    });

    it('should find dependents through barrel re-exports with imports array', () => {
      // auth.ts → index.ts (barrel with imports + exports) → handler.ts
      const chunks: CodeChunk[] = [
        createChunk('src/auth.ts', [], undefined, {
          exports: ['AuthService'],
        }),
        // Barrel using wildcard re-export: has import from auth.ts and exports
        createChunk('src/index.ts', ['src/auth.ts'], undefined, {
          exports: ['AuthService'],
          importedSymbols: { './auth': ['AuthService'] },
        }),
        // Consumer imports from barrel
        createChunk('src/handler.ts', ['src/index.ts'], undefined, {
          importedSymbols: { './index': ['AuthService'] },
        }),
      ];

      const result = analyzeDependencies('src/auth.ts', chunks, workspaceRoot);

      const dependentPaths = result.dependents.map(d => d.filepath);
      expect(dependentPaths).toContain('src/index.ts');
      expect(dependentPaths).toContain('src/handler.ts');
      expect(result.dependentCount).toBe(2);
    });

    it('should behave the same when no re-exporters exist', () => {
      // No barrel files — regression test
      const chunks: CodeChunk[] = [
        createChunk('src/utils.ts', [], undefined, {
          exports: ['helper'],
        }),
        createChunk('src/app.ts', ['src/utils.ts'], undefined, {
          importedSymbols: { './utils': ['helper'] },
        }),
      ];

      const result = analyzeDependencies('src/utils.ts', chunks, workspaceRoot);

      expect(result.dependentCount).toBe(1);
      expect(result.dependents[0].filepath).toBe('src/app.ts');
    });
  });

  describe('whole-module-import basename hub (#884)', () => {
    it('does not count Swift whole-module test imports as dependents of a same-basename file', () => {
      const chunks: CodeChunk[] = [
        createChunk('Source/Alamofire.swift', []),
        createChunk('Tests/SessionTests.swift', ['Alamofire']),
        createChunk('Tests/ValidationTests.swift', ['Alamofire']),
      ];

      const result = analyzeDependencies('Source/Alamofire.swift', chunks, workspaceRoot);

      expect(result.dependentCount).toBe(0);
    });

    it('still counts a real dependent via the identical one-leading-segment shape for a non-whole-module language', () => {
      const chunks: CodeChunk[] = [
        createChunk('src/auth.rs', []),
        createChunk('tests/auth_test.rs', ['auth']),
      ];

      const result = analyzeDependencies('src/auth.rs', chunks, workspaceRoot);

      expect(result.dependentCount).toBe(1);
      expect(result.dependents[0].filepath).toBe('tests/auth_test.rs');
    });
  });

  describe('#887 language-aware directory-vs-file matching (findDependentChunks)', () => {
    it('Ruby: a bare multi-segment require does not credit a sibling file under the same directory', () => {
      // rack-protection/lib/rack/protection/base.rb bare-requires
      // 'rack/protection' -- that must resolve to the umbrella
      // rack-protection/lib/rack/protection.rb, not to an unrelated sibling
      // module that merely shares the directory (#887).
      const chunks: CodeChunk[] = [
        createChunk('rack-protection/lib/rack/protection/base.rb', ['rack/protection']),
      ];

      const result = analyzeDependencies(
        'rack-protection/lib/rack/protection/xss_header.rb',
        chunks,
        workspaceRoot,
      );

      expect(result.dependents.map(d => d.filepath)).not.toContain(
        'rack-protection/lib/rack/protection/base.rb',
      );
    });

    it('Ruby: the umbrella entry point itself is still a legitimate match', () => {
      const chunks: CodeChunk[] = [
        createChunk('rack-protection/lib/rack/protection/base.rb', ['rack/protection']),
      ];

      const result = analyzeDependencies(
        'rack-protection/lib/rack/protection.rb',
        chunks,
        workspaceRoot,
      );

      expect(result.dependents.map(d => d.filepath)).toContain(
        'rack-protection/lib/rack/protection/base.rb',
      );
    });

    it('Go: a package-directory import still credits every file in the directory as a dependent (the caught regression)', () => {
      // #877 normalizes `import "mymodule/internal/fs"` down to the bare
      // `internal/fs`. In Go that names a PACKAGE, so every .go file inside
      // the directory (e.g. fs.go) is a legitimate dependent -- an earlier
      // revision of the #887 fix broke this (67 -> 9 dependent edges on a
      // real gin clone) by applying Ruby's stricter anchor unconditionally.
      const chunks: CodeChunk[] = [createChunk('render/html.go', ['internal/fs'])];

      const result = analyzeDependencies('internal/fs/fs.go', chunks, workspaceRoot);

      expect(result.dependents.map(d => d.filepath)).toContain('render/html.go');
    });

    it('applies the language check per chunk, not once per shared import key', () => {
      // Two chunks share the identical normalized import key ('pkg/sub'):
      // one Go, one Ruby. findDependentChunks's fuzzy loop iterates the
      // index by key, so it must not decide "match or no match" once per
      // key -- the Go chunk is a real dependent, the Ruby chunk is not.
      const chunks: CodeChunk[] = [
        createChunk('render/html.go', ['pkg/sub']),
        createChunk('lib/pkg/consumer.rb', ['pkg/sub']),
      ];

      const result = analyzeDependencies('pkg/sub/child.go', chunks, workspaceRoot);
      const filepaths = result.dependents.map(d => d.filepath);

      expect(filepaths).toContain('render/html.go');
      expect(filepaths).not.toContain('lib/pkg/consumer.rb');
    });
  });

  describe('#953 Python-strategy fan-out on a bare directory specifier (addFuzzyMatchChunks)', () => {
    it('does not credit a TypeScript file with a resolved bare-directory import as a dependent of an unrelated file under that directory', () => {
      // Simulates what `resolveRelativeImport` produces for a dots-only
      // specifier like `'../..'` (from src/middleware/jwt/index.ts) when the
      // directory has no `index.<ext>` for `resolveJsDirectoryIndex` to
      // redirect to: the bare directory name `src` is left in `imports`.
      // Without the #953 guard, `matchesFile`'s Python Strategy 5
      // (`matchesParentPythonPackage('src', 'src/utils/color')`) fuzzy-
      // matches this against EVERY file under src/ -- fabricating a
      // dependent edge with no real relationship to the target (the exact
      // hono/TypeScript repro from `matchesFile`'s own #929 doc comment).
      const chunks: CodeChunk[] = [createChunk('src/middleware/jwt/index.ts', ['src'])];

      const result = analyzeDependencies('src/utils/color.ts', chunks, workspaceRoot);

      expect(result.dependents.map(d => d.filepath)).not.toContain('src/middleware/jwt/index.ts');
      expect(result.dependentCount).toBe(0);
    });

    it('still credits a genuine Python bare-package import as a dependent (real Strategy 5 semantic preserved)', () => {
      const chunks: CodeChunk[] = [createChunk('app/consumer.py', ['src'])];

      const result = analyzeDependencies('src/utils/helpers.py', chunks, workspaceRoot);

      expect(result.dependents.map(d => d.filepath)).toContain('app/consumer.py');
    });
  });

  // #994 Phase 3 characterization: `buildReExportGraph` is one of the four
  // match-side call paths path-matching.ts:378-388 (pre-fix) documents as not
  // routed through `importMatchesTarget`. Its own re-export detection
  // (`fileIsReExporter` -> `findReExportedSymbolsForFile` ->
  // `collectImportedSymbolsFromSource`) already routes through the guarded
  // primitive, so the three guards below are exercised here at the
  // `buildReExportGraph`/`analyzeDependencies` level for the first time --
  // previously #884 only had unit coverage one layer down
  // (`findReExportedSymbolsForFile`'s own describe block), and #887/#929 had
  // none at all in the barrel/re-export path.
  describe('buildReExportGraph guard coverage (#994 Phase 3 characterization)', () => {
    it('#884: a Swift whole-module bare import does not make a same-basename file a re-exporter', () => {
      const chunks: CodeChunk[] = [
        createChunk('Source/Alamofire.swift', [], undefined, { exports: ['Alamofire'] }),
        // Bare whole-module import sharing the target's basename (the #884
        // false-hub shape) that also happens to export the same name --
        // without the guard this would look like a genuine re-export.
        createChunk('Source/Core/Session.swift', ['Alamofire'], undefined, {
          importedSymbols: { Alamofire: ['Alamofire'] },
          exports: ['Alamofire'],
        }),
        createChunk('Tests/SessionTests.swift', ['Source/Core/Session.swift'], undefined, {
          importedSymbols: { './Session': ['Alamofire'] },
        }),
      ];

      const result = analyzeDependencies('Source/Alamofire.swift', chunks, workspaceRoot);

      const dependentPaths = result.dependents.map(d => d.filepath);
      expect(dependentPaths).not.toContain('Source/Core/Session.swift');
      expect(dependentPaths).not.toContain('Tests/SessionTests.swift');
    });

    it('#887 (Ruby): a bare multi-segment require does not make a sibling file a re-exporter of an unrelated target', () => {
      // Mirrors the #887 findDependentChunks fixture above, for the
      // re-export path instead: base.rb bare-requires 'rack/protection',
      // which Ruby's single-file semantics resolve to the umbrella entry
      // point ONLY, never to a sibling under the same directory. If this
      // guard were missing here, base.rb would be wrongly credited as a
      // re-exporter of xss_header.rb (a sibling, not the umbrella), pulling
      // in its own consumers as fabricated transitive dependents.
      const chunks: CodeChunk[] = [
        createChunk('rack-protection/lib/rack/protection/base.rb', ['rack/protection'], undefined, {
          importedSymbols: { 'rack/protection': ['ProtectionThing'] },
          exports: ['ProtectionThing'],
        }),
        createChunk(
          'rack-protection/lib/rack/protection/consumer.rb',
          ['rack/protection/base'],
          undefined,
          { importedSymbols: { 'rack/protection/base': ['ProtectionThing'] } },
        ),
      ];

      const result = analyzeDependencies(
        'rack-protection/lib/rack/protection/xss_header.rb',
        chunks,
        workspaceRoot,
      );

      const dependentPaths = result.dependents.map(d => d.filepath);
      expect(dependentPaths).not.toContain('rack-protection/lib/rack/protection/base.rb');
      expect(dependentPaths).not.toContain('rack-protection/lib/rack/protection/consumer.rb');
    });

    it('#929 (Python): a TypeScript resolved bare-directory import does not make its file a re-exporter of an unrelated file under that directory', () => {
      const chunks: CodeChunk[] = [
        createChunk('src/middleware/jwt/index.ts', ['src'], undefined, {
          importedSymbols: { src: ['color'] },
          exports: ['color'],
        }),
        createChunk('src/middleware/jwt/consumer.ts', ['src/middleware/jwt/index.ts'], undefined, {
          importedSymbols: { './index': ['color'] },
        }),
      ];

      const result = analyzeDependencies('src/utils/color.ts', chunks, workspaceRoot);

      const dependentPaths = result.dependents.map(d => d.filepath);
      expect(dependentPaths).not.toContain('src/middleware/jwt/index.ts');
      expect(dependentPaths).not.toContain('src/middleware/jwt/consumer.ts');
    });

    it('still finds a genuine re-exporter through a Go package-directory import (regression guard)', () => {
      const chunks: CodeChunk[] = [
        createChunk('internal/fs/fs.go', [], undefined, { exports: ['Open'] }),
        createChunk('render/html.go', ['internal/fs'], undefined, {
          importedSymbols: { 'internal/fs': ['Open'] },
          exports: ['Open'],
        }),
        createChunk('app/main.go', ['render/html.go'], undefined, {
          importedSymbols: { 'render/html': ['Open'] },
        }),
      ];

      const result = analyzeDependencies('internal/fs/fs.go', chunks, workspaceRoot);

      const dependentPaths = result.dependents.map(d => d.filepath);
      expect(dependentPaths).toContain('render/html.go');
      expect(dependentPaths).toContain('app/main.go');
    });
  });

  // #994 Phase 3 characterization: `buildReExportGraph`'s own raw
  // `matchesFile(filepath, normalizedTarget)` self-skip call (excluding the
  // target file itself from re-exporter consideration) is orthogonal to the
  // three guards above -- there is no import specifier in play, only two
  // already-identically-normalized file paths, so none of #884/#887/#929
  // apply to it. This pins its current behavior; see the NOTE below for why
  // it's suspicious.
  describe('buildReExportGraph self-skip fuzzy-matching (#994 Phase 3, investigated)', () => {
    it('a two-hop re-export chain through a file whose own path fuzzy-matches the target is still found (masking regression guard)', () => {
      // Investigation note (not a confirmed bug -- see #994 Phase 3 report):
      // `fs/fs.go` and `internal/fs/fs.go` are two DIFFERENT real files.
      // buildReExportGraph's self-skip does `matchesFile(filepath,
      // normalizedTarget)` -- a fuzzy match, not exact equality, even though
      // both sides already come from the SAME `normalizePathCached` (so a
      // plain `===` would be exact and sufficient). `matchesFile('fs/fs.go',
      // 'internal/fs/fs.go')` returns true via Strategy 2's permissive
      // (Go-default) multi-segment tail match -- the same boundary rule that
      // legitimately lets a bare `internal/fs` import credit every file in
      // that package directory here misfires on a FILE-vs-FILE identity
      // check instead of an import-vs-file one, so `fs/fs.go` is wrongly
      // treated as if it WERE the target and excluded from
      // `reExporterPaths` via `continue`.
      //
      // On paper this should silently drop any consumer only reachable
      // through `fs/fs.go`'s re-export chain. Empirically it does not: ANY
      // specifier that references `fs/fs.go` by its own path/name (the only
      // way to build a chain through it) ALSO fuzzy-matches the target
      // directly, by the same tail-match property that trips the self-skip
      // in the first place. So `mid/wrapper.go` (which re-exports
      // `fs/fs.go`'s `Open`) gets independently, directly recognized as a
      // target re-exporter by `buildReExportGraph`'s own loop over every
      // file in the corpus -- bypassing the broken chain through `fs/fs.go`
      // entirely -- and `app/main.go` is still found. Two attempts to
      // construct a repro where this masking does NOT apply were
      // unsuccessful; the self-skip's fuzzy-vs-exact mismatch looks like a
      // code smell (using an import matcher for a file-identity check) but
      // has no demonstrated observable effect through `analyzeDependencies`/
      // `findDependents`. Reported as an unconfirmed finding, not fixed here.
      const chunks: CodeChunk[] = [
        createChunk('internal/fs/fs.go', [], undefined, { exports: ['Open'] }),
        createChunk('fs/fs.go', ['internal/fs'], undefined, {
          importedSymbols: { 'internal/fs': ['Open'] },
          exports: ['Open'],
        }),
        createChunk('mid/wrapper.go', ['fs/fs.go'], undefined, {
          importedSymbols: { 'fs/fs.go': ['Open'] },
          exports: ['Open'],
        }),
        createChunk('app/main.go', ['mid/wrapper.go'], undefined, {
          importedSymbols: { 'mid/wrapper.go': ['Open'] },
        }),
      ];

      const result = analyzeDependencies('internal/fs/fs.go', chunks, workspaceRoot);
      const dependentPaths = result.dependents.map(d => d.filepath);

      expect(dependentPaths).toContain('fs/fs.go');
      expect(dependentPaths).toContain('mid/wrapper.go');
      expect(dependentPaths).toContain('app/main.go');
    });
  });
});

// Direct unit coverage for the shared re-export intersection algorithm,
// consumed by both `fileIsReExporter` here and the CLI's `get_dependents`
// handler (#532).
describe('findReExportedSymbolsForFile', () => {
  const identity = (path: string): string => path;

  function chunk(
    file: string,
    options?: { exports?: string[]; importedSymbols?: Record<string, string[]> },
  ): CodeChunk {
    return {
      content: 'test content',
      metadata: {
        file,
        startLine: 1,
        endLine: 10,
        type: 'function',
        language: 'typescript',
        ...(options?.exports && { exports: options.exports }),
        ...(options?.importedSymbols && { importedSymbols: options.importedSymbols }),
      } as ChunkMetadata,
    };
  }

  it('returns empty when the file imports nothing from the source', () => {
    const chunks = [chunk('src/b.ts', { exports: ['fnB'] })];
    expect(findReExportedSymbolsForFile(chunks, 'src/a.ts', identity)).toEqual([]);
  });

  it('returns empty when the file exports nothing of its own', () => {
    const chunks = [chunk('src/b.ts', { importedSymbols: { 'src/a.ts': ['fnA'] } })];
    expect(findReExportedSymbolsForFile(chunks, 'src/a.ts', identity)).toEqual([]);
  });

  it('returns empty when imported symbols and exports do not intersect (#526)', () => {
    const chunks = [
      chunk('src/b.ts', {
        importedSymbols: { 'src/a.ts': ['fnA'] },
        exports: ['fnB'],
      }),
    ];
    expect(findReExportedSymbolsForFile(chunks, 'src/a.ts', identity)).toEqual([]);
  });

  it('returns the intersecting symbols for a genuine re-export', () => {
    const chunks = [
      chunk('src/b.ts', {
        importedSymbols: { 'src/a.ts': ['fnA', 'fnB'] },
        exports: ['fnA', 'fnC'],
      }),
    ];
    expect(findReExportedSymbolsForFile(chunks, 'src/a.ts', identity)).toEqual(['fnA']);
  });

  it('treats a "*" wildcard import as re-exporting all of the file\'s exports', () => {
    const chunks = [
      chunk('src/b.ts', {
        importedSymbols: { 'src/a.ts': ['*'] },
        exports: ['fnA', 'fnB'],
      }),
    ];
    expect(findReExportedSymbolsForFile(chunks, 'src/a.ts', identity)).toEqual(['fnA', 'fnB']);
  });

  it('treats a "* as ns" namespace import as re-exporting all of the file\'s exports', () => {
    const chunks = [
      chunk('src/b.ts', {
        importedSymbols: { 'src/a.ts': ['* as ns'] },
        exports: ['ns'],
      }),
    ];
    expect(findReExportedSymbolsForFile(chunks, 'src/a.ts', identity)).toEqual(['ns']);
  });

  describe('whole-module-import basename hub (#884)', () => {
    it('does not falsely credit a Swift whole-module bare import as re-exporting from a same-basename source', () => {
      // SwiftImportExtractor.processImportSymbols records a bare `import
      // Alamofire` as importedSymbols: { Alamofire: ['Alamofire'] }. Without
      // the guard, collectImportedSymbolsFromSource would match "Alamofire"
      // against sourcePath "Source/Alamofire" via basename coincidence, and
      // if the file also happens to export a symbol literally named
      // "Alamofire", it would be falsely reported as re-exporting it.
      const chunks = [
        chunk('Source/Core/Session.swift', {
          importedSymbols: { Alamofire: ['Alamofire'] },
          exports: ['Alamofire'],
        }),
      ];
      expect(findReExportedSymbolsForFile(chunks, 'Source/Alamofire', identity)).toEqual([]);
    });

    it('still finds a real re-export via the identical one-leading-segment shape for a non-whole-module language', () => {
      const chunks = [
        chunk('src/reexport.rs', {
          importedSymbols: { auth: ['auth'] },
          exports: ['auth'],
        }),
      ];
      expect(findReExportedSymbolsForFile(chunks, 'src/auth', identity)).toEqual(['auth']);
    });
  });
});

describe('chunkImportsFrom', () => {
  const identity = (path: string): string => path;

  function makeChunk(
    file: string,
    options: { imports?: string[]; importedSymbols?: Record<string, string[]> } = {},
  ): CodeChunk {
    return {
      content: '',
      metadata: {
        file,
        startLine: 1,
        endLine: 10,
        type: 'function',
        language: 'typescript',
        imports: options.imports,
        importedSymbols: options.importedSymbols,
      } as ChunkMetadata,
    };
  }

  describe('whole-module-import basename hub (#884)', () => {
    it('does not report a Swift whole-module bare import as importing a same-basename target (raw imports array)', () => {
      const chunk = makeChunk('Tests/SessionTests.swift', { imports: ['Alamofire'] });
      expect(chunkImportsFrom(chunk, 'Source/Alamofire', identity)).toBe(false);
    });

    it('does not report a Swift whole-module bare import as importing a same-basename target (importedSymbols keys)', () => {
      const chunk = makeChunk('Tests/SessionTests.swift', {
        importedSymbols: { Alamofire: ['Alamofire'] },
      });
      expect(chunkImportsFrom(chunk, 'Source/Alamofire', identity)).toBe(false);
    });

    it('still reports the identical shape for a non-whole-module language (Rust auth -> src/auth.rs)', () => {
      const chunk = makeChunk('tests/auth_test.rs', { imports: ['auth'] });
      expect(chunkImportsFrom(chunk, 'src/auth', identity)).toBe(true);
    });

    it('still reports a real import from a Swift file when it is not the bare whole-module case', () => {
      const chunk = makeChunk('Tests/SessionTests.swift', { imports: ['./Networking/Session'] });
      expect(chunkImportsFrom(chunk, 'Source/Networking/Session', identity)).toBe(true);
    });
  });
});

describe('Rust mod-derived edges end-to-end (#1021 regression)', () => {
  // Both fixtures below are issue #1021's own reproductions, parsed through
  // the REAL Rust extractor (`chunkByAST`) and run through the same
  // `analyzeDependencies`/`findDependentChunks` engine `get_dependents` uses
  // -- not a hand-built `imports: [...]` array -- so this exercises the
  // full extraction-to-matching pipeline, not just one layer of it. Neither
  // shape (a `mod dir;` with several files, or a leaf file owning a
  // subdirectory) previously existed as a regression fixture anywhere in the
  // repo, which is why two rounds of real-world validation (#1000/#1008,
  // #1016/#1020) missed both bugs.
  const workspaceRoot = '/test/workspace';

  it('fixture 1: `mod thing;` (src/main.rs) fabricates edges to every file under thing/, not just the real ones', () => {
    const chunks = [
      ...chunkByAST('src/main.rs', 'mod thing;\n\nfn main() {\n    thing::declared_fn();\n}\n'),
      ...chunkByAST('src/thing/mod.rs', 'pub fn declared_fn() -> u32 { 1 }\npub mod sibling;\n'),
      ...chunkByAST('src/thing/sibling.rs', 'pub fn sibling_fn() -> u32 { 2 }\n'),
      ...chunkByAST('src/thing/undeclared.rs', 'pub fn nobody_declares_me() -> u32 { 3 }\n'),
    ];

    expect(
      analyzeDependencies('src/thing/mod.rs', chunks, workspaceRoot).dependents.map(
        d => d.filepath,
      ),
    ).toEqual(['src/main.rs']);

    expect(
      analyzeDependencies('src/thing/sibling.rs', chunks, workspaceRoot).dependents.map(
        d => d.filepath,
      ),
    ).toEqual(['src/thing/mod.rs']);

    expect(
      analyzeDependencies('src/thing/undeclared.rs', chunks, workspaceRoot).dependents,
    ).toEqual([]);
  });

  it('fixture 2: a leaf file owning a submodule subdirectory (src/engine.rs -> mod helpers;) fabricates a self-edge', () => {
    const chunks = [
      ...chunkByAST('src/lib.rs', 'pub mod engine;\n'),
      ...chunkByAST('src/engine.rs', 'mod helpers;\n\npub fn run() -> u32 { helpers::help() }\n'),
      ...chunkByAST('src/engine/helpers.rs', 'pub fn help() -> u32 { 7 }\n'),
    ];

    expect(
      analyzeDependencies('src/engine.rs', chunks, workspaceRoot).dependents.map(d => d.filepath),
    ).toEqual(['src/lib.rs']);

    expect(
      analyzeDependencies('src/engine/helpers.rs', chunks, workspaceRoot).dependents.map(
        d => d.filepath,
      ),
    ).toEqual(['src/engine.rs']);
  });
});

describe('bare crate-relative `use` edges end-to-end (#1028 regression)', () => {
  // #1028: `matchesFile`'s Strategy 4 (`matchesPHPNamespace`) was applied
  // unconditionally to every language, not just PHP. Its bare-single-
  // component branch is case-INSENSITIVE and allows up to one leading
  // directory segment (added by #883 for an unrelated Swift/Go/Ruby fix) --
  // on Rust, this let a bare `use crate::{Error, StdError}` specifier
  // (the import extractor's "first wins" grouped-use handling, mirroring
  // Go's own precedent) case-insensitively self-match its own file. Real
  // `dtolnay/anyhow` repro, parsed through the REAL Rust extractor
  // (`chunkByAST`) exactly like the #1021 fixtures above, not a hand-built
  // `imports: [...]` array.
  const workspaceRoot = '/test/workspace';

  it('fixture 1 (self-edge): a file whose own re-exported type name case-insensitively matches its own basename must not become its own dependent', () => {
    // Mirrors anyhow's real src/error.rs: `pub(crate) use crate::{Error,
    // StdError};` extracts the bare "Error" specifier (first-wins), which
    // case-insensitively collides with this file's own basename ("error").
    const chunks = chunkByAST(
      'src/error.rs',
      'pub(crate) use crate::{Error, StdError};\n\npub(crate) struct ErrorImpl<E = ()> {\n    x: E,\n}\n',
    );

    expect(analyzeDependencies('src/error.rs', chunks, workspaceRoot).dependents).toEqual([]);
  });

  it('fixture 2 (different-files false positive): a bare specifier must not fabricate an edge to an unrelated file that merely shares its basename case-insensitively', () => {
    // src/other.rs's bare `Config` specifier names the type declared in
    // src/lib.rs -- src/config.rs is a completely unrelated file that
    // happens to share "config" as its basename. Before #1028, Strategy 4's
    // case-insensitive, up-to-one-leading-segment leniency fabricated an
    // edge from src/other.rs to src/config.rs anyway (the same class of bug
    // as the self-edge above, just between two DIFFERENT files) -- proving
    // a self-edge guard alone would not have been sufficient.
    const chunks = [
      ...chunkByAST('src/lib.rs', 'pub struct Config {\n    pub debug: bool,\n}\n'),
      ...chunkByAST(
        'src/other.rs',
        'use crate::Config;\n\npub fn make() -> Config {\n    Config { debug: false }\n}\n',
      ),
      ...chunkByAST('src/config.rs', 'pub fn helper() -> u32 {\n    1\n}\n'),
    ];

    expect(analyzeDependencies('src/config.rs', chunks, workspaceRoot).dependents).toEqual([]);
  });

  it('verified boundary: a same-shaped self-reference one directory deeper was never affected (control, unchanged by this fix)', () => {
    // Issue #1028's own verified boundary: a file directly under ONE
    // top-level directory is the exact trigger shape (targetComponents.length
    // <= 2). One level deeper, `matchesPHPNamespace`'s bare-import guard
    // already rejected the match before this fix (4 target components), so
    // this fixture pins that this control path stays correct, not that this
    // fix changed it.
    const chunks = chunkByAST(
      'src/deep/nested/error.rs',
      'pub(crate) use crate::Error;\n\npub(crate) struct ErrorImpl;\n',
    );

    expect(
      analyzeDependencies('src/deep/nested/error.rs', chunks, workspaceRoot).dependents,
    ).toEqual([]);
  });

  it("#883's own repro stays fixed end-to-end (Swift bare system-framework import must not match an unrelated same-named file)", () => {
    // #883 fixed this exact shape directly in `matchesPHPNamespace` (the
    // bare-import ≤2-target-component guard this fix now additionally gates
    // by language) -- confirms #1028 didn't reopen it for the language #883
    // was originally protecting.
    const chunks = [
      ...chunkByAST('Source/Features/Combine.swift', 'struct Combine {\n}\n'),
      ...chunkByAST(
        'Tests/CombineTests.swift',
        'import Combine\n\nclass CombineTests {\n    func testIt() {}\n}\n',
      ),
    ];

    // Swift's whole-module import guard (#884) already suppresses this bare
    // `import Combine` from ever reaching `matchesFile` for a per-file
    // relationship -- the honest #869 "not determinable" outcome, not a
    // match. Either way, it must not resolve to the unrelated file.
    expect(
      analyzeDependencies('Source/Features/Combine.swift', chunks, workspaceRoot).dependents,
    ).toEqual([]);
  });

  it("PHP's own namespace matching is completely unaffected end-to-end (the language Strategy 4 is a real semantic for)", () => {
    const chunks = [
      ...chunkByAST(
        'Controller.php',
        '<?php\nnamespace App;\nuse App\\Models\\User;\n\nclass Controller {\n    function index() { return new User(); }\n}\n',
      ),
      ...chunkByAST('app/Models/User.php', '<?php\nnamespace App\\Models;\n\nclass User {\n}\n'),
    ];

    expect(
      analyzeDependencies('app/Models/User.php', chunks, workspaceRoot).dependents.map(
        d => d.filepath,
      ),
    ).toEqual(['Controller.php']);
  });
});
