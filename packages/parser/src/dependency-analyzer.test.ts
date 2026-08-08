import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import {
  analyzeDependencies,
  findDependents,
  findReExportedSymbolsForFile,
  chunkImportsFrom,
  hasTestImporterFromChunks,
  hasTestImporterBruteForce,
  COMPLEXITY_THRESHOLDS,
} from './dependency-analyzer.js';
import { chunkByAST } from './ast/chunker.js';
import { clearGoModuleCache } from './go-module.js';
import { clearRustCrateMapCache } from './rust-crate-map.js';
import { clearRustCrateExportCache } from './rust-crate-exports.js';
import type { CodeChunk, ChunkMetadata } from './types.js';
import type { RecoveryIndexes } from './dependent-count-index.js';

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

  describe('#1044 re-export BFS is independent of chunk scan order', () => {
    it('finds a dependent reachable through only one of several depth-1 re-export candidates, regardless of which candidate the BFS visits first', () => {
      // target ← deadend (genuinely re-exports target)
      // target ← livechain (genuinely re-exports target)
      // bridge imports BOTH deadend and livechain, but only genuinely
      // re-exports from livechain (its own `exports` intersects livechain's
      // re-exported symbol, not deadend's).
      // bridge ← consumer (imports ONLY bridge — not target/deadend/
      // livechain directly).
      //
      // consumer is discoverable ONLY if the BFS recognizes bridge as a
      // re-export-chain continuer of livechain. Pre-fix, a single shared
      // `visited` set gated both "reported as a dependent" and "queued for
      // its own re-export exploration": whichever of deadend/livechain the
      // BFS processed FIRST consumed bridge's slot in that set. If deadend
      // went first, bridge was reported (correctly) but marked visited
      // before the livechain check ever ran, so bridge was never enqueued
      // for further exploration and consumer was silently dropped.
      // `reExporterPaths`' traversal order comes from iterating a `Map`
      // built by inserting chunks in the order they were scanned — exactly
      // what real indexing's concurrent, unordered file scan does not hold
      // constant across runs of the same, unmodified tree (#1044). Feeding
      // the identical chunk set in two different array orders (only
      // deadend/livechain's relative position swaps) reproduces that same
      // order-dependence deterministically, in-process.
      const target = createChunk('src/target.ts', [], undefined, {
        exports: ['targetSymbol'],
      });
      const deadend = createChunk('src/deadend.ts', ['src/target.ts'], undefined, {
        exports: ['targetSymbol'],
        importedSymbols: { './target': ['targetSymbol'] },
      });
      const livechain = createChunk('src/livechain.ts', ['src/target.ts'], undefined, {
        exports: ['targetSymbol'],
        importedSymbols: { './target': ['targetSymbol'] },
      });
      const bridge = createChunk(
        'src/bridge.ts',
        ['src/deadend.ts', 'src/livechain.ts'],
        undefined,
        {
          // Only 'liveSymbol' is re-exported: 'deadOnlySymbol' is imported
          // from deadend but never appears in bridge's own exports, so
          // bridge is NOT a re-exporter of deadend (a dead end for the
          // chain), while it IS a genuine re-exporter of livechain.
          exports: ['liveSymbol'],
          importedSymbols: {
            './deadend': ['deadOnlySymbol'],
            './livechain': ['liveSymbol'],
          },
        },
      );
      const consumer = createChunk('src/consumer.ts', ['src/bridge.ts'], undefined, {
        importedSymbols: { './bridge': ['liveSymbol'] },
      });

      const orderA = [target, deadend, livechain, bridge, consumer];
      const orderB = [target, livechain, deadend, bridge, consumer];

      const resultA = analyzeDependencies('src/target.ts', orderA, workspaceRoot);
      const resultB = analyzeDependencies('src/target.ts', orderB, workspaceRoot);

      const pathsA = resultA.dependents.map(d => d.filepath).sort();
      const pathsB = resultB.dependents.map(d => d.filepath).sort();

      expect(pathsA).toContain('src/consumer.ts');
      expect(pathsB).toEqual(pathsA);
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

describe('findDependents (Go root-package export-lookup recovery, #1039)', () => {
  const MODULE_PREFIX = 'github.com/go-chi/chi/v5';
  let workspaceRoot: string;

  function noopLog(): void {
    // Intentionally empty.
  }

  function createGoChunk(
    file: string,
    opts: { imports?: string[]; exports?: string[]; callSites?: string[] } = {},
  ): CodeChunk {
    return {
      content: opts.callSites?.map(s => `${s}()`).join('\n') ?? '',
      metadata: {
        file,
        startLine: 1,
        endLine: 10,
        type: 'function',
        language: 'go',
        imports: opts.imports,
        exports: opts.exports,
        callSites: opts.callSites?.map((symbol, i) => ({ symbol, line: i + 1 })),
      } as ChunkMetadata,
    };
  }

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-dep-analyzer-go-'));
    await fs.writeFile(path.join(workspaceRoot, 'go.mod'), `module ${MODULE_PREFIX}\n\ngo 1.21\n`);
  });

  afterEach(async () => {
    clearGoModuleCache();
    await fs.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
  });

  it('recovers real dependents for a root-package file via export lookup when the import graph found none (the #1039 chi repro)', () => {
    const chunks: CodeChunk[] = [
      createGoChunk('context.go', { exports: ['RouteContext', 'NewRouteContext'] }),
      createGoChunk('middleware/clean_path.go', {
        imports: [MODULE_PREFIX],
        callSites: ['RouteContext'],
      }),
      createGoChunk('middleware/get_head.go', {
        imports: [MODULE_PREFIX],
        callSites: ['RouteContext', 'NewRouteContext'],
      }),
    ];

    const result = findDependents(chunks, 'context.go', noopLog, workspaceRoot);

    expect(result.dependents.map(d => d.filepath).sort()).toEqual([
      'middleware/clean_path.go',
      'middleware/get_head.go',
    ]);
    expect(result.dependents.every(d => d.confidence === 'inferred')).toBe(true);
    expect(result.dependentAttributionPartial).toBe(true);
    // #1018: every recovered dependent names the mechanism that found it, so a
    // consumer's prose can describe Go's fallback instead of assuming C#'s.
    expect(result.dependents.every(d => d.inferredVia === 'go-root-package-export')).toBe(true);
  });

  it('pairs confidence and inferredVia on every dependent, in both directions (#1018)', () => {
    // The pair is written by `inferredDependent()` and nowhere else, so neither
    // half can appear without the other. Asserting BOTH directions is the
    // point: a `confidence: 'inferred'` with no mechanism sends a consumer back
    // to guessing (the #1039 defect), and an `inferredVia` on an
    // import-verified dependent would mark a real import edge as recovered.
    const chunks: CodeChunk[] = [
      createGoChunk('context.go', { exports: ['RouteContext'] }),
      createGoChunk('middleware/clean_path.go', {
        imports: [MODULE_PREFIX],
        callSites: ['RouteContext'],
      }),
    ];

    const recovered = findDependents(chunks, 'context.go', noopLog, workspaceRoot);
    expect(recovered.dependents.length).toBeGreaterThan(0);
    for (const d of recovered.dependents) {
      expect(d.confidence === 'inferred').toBe(d.inferredVia !== undefined);
    }

    // An ordinary import-verified dependent carries neither field.
    const verified = findDependents(
      [
        createGoChunk('sub/helper.go', { exports: ['Helper'] }),
        createGoChunk('sub/caller.go', { imports: [`${MODULE_PREFIX}/sub`] }),
      ],
      'sub/helper.go',
      noopLog,
      workspaceRoot,
    );
    for (const d of verified.dependents) {
      expect(d.confidence).toBeUndefined();
      expect(d.inferredVia).toBeUndefined();
    }
  });

  it('reuses a caller-supplied recoveryIndexes bag across multiple findDependents calls in one batch (#1101)', () => {
    // The exact shape `lien api-delta`'s `enrichDeltas` needs: one bag built
    // before the loop, threaded into every `findDependents` call inside it.
    // Asserting object identity (not just "same answer") is the point --
    // the fix is specifically that `buildGoRootPackageIndex` runs at most
    // ONCE for the whole batch, not once per call.
    const chunks: CodeChunk[] = [
      createGoChunk('context.go', { exports: ['RouteContext', 'NewRouteContext'] }),
      createGoChunk('middleware/clean_path.go', {
        imports: [MODULE_PREFIX],
        callSites: ['RouteContext'],
      }),
    ];
    const recoveryIndexes: RecoveryIndexes = {};

    const first = findDependents(
      chunks,
      'context.go',
      noopLog,
      workspaceRoot,
      undefined,
      1,
      500,
      false,
      recoveryIndexes,
    );
    expect(first.dependents.map(d => d.filepath)).toEqual(['middleware/clean_path.go']);
    const builtIndex = recoveryIndexes.go;
    expect(builtIndex).toBeDefined();

    const second = findDependents(
      chunks,
      'context.go',
      noopLog,
      workspaceRoot,
      undefined,
      1,
      500,
      false,
      recoveryIndexes,
    );
    // Same object reference reused -- proof the second call never rebuilt it.
    expect(recoveryIndexes.go).toBe(builtIndex);
    expect(second.dependents.map(d => d.filepath)).toEqual(['middleware/clean_path.go']);
  });

  it('produces identical results whether or not a recoveryIndexes bag is threaded through (batching only caches, never changes the answer)', () => {
    const chunks: CodeChunk[] = [
      createGoChunk('context.go', { exports: ['RouteContext', 'NewRouteContext'] }),
      createGoChunk('middleware/clean_path.go', {
        imports: [MODULE_PREFIX],
        callSites: ['RouteContext'],
      }),
      createGoChunk('middleware/get_head.go', {
        imports: [MODULE_PREFIX],
        callSites: ['RouteContext', 'NewRouteContext'],
      }),
    ];

    const withoutBag = findDependents(chunks, 'context.go', noopLog, workspaceRoot);
    const sharedBag: RecoveryIndexes = {};
    const withBag = findDependents(
      chunks,
      'context.go',
      noopLog,
      workspaceRoot,
      undefined,
      1,
      500,
      false,
      sharedBag,
    );

    expect(withBag.dependents).toEqual(withoutBag.dependents);
    expect(withBag.dependentAttributionPartial).toBe(withoutBag.dependentAttributionPartial);
  });

  it('never builds the Go root-package index for a non-root-level Go file, even when a shared recoveryIndexes bag is supplied (preserves the single-shot short-circuit)', () => {
    // `enrichWithGoRootPackageDependents` must check `isRootLevelGoFile`
    // BEFORE touching `ctx.recoveryIndexes.go` -- otherwise a single MCP
    // query for a zero-dependent, non-root-level Go file would start paying
    // the corpus-wide index build it never paid before #1101.
    const chunks: CodeChunk[] = [
      createGoChunk('sub/helper.go', { exports: ['Helper'] }),
      createGoChunk('sub/unrelated.go', {}),
    ];
    const recoveryIndexes: RecoveryIndexes = {};

    const result = findDependents(
      chunks,
      'sub/helper.go',
      noopLog,
      workspaceRoot,
      undefined,
      1,
      500,
      false,
      recoveryIndexes,
    );

    expect(result.dependents).toEqual([]);
    expect(recoveryIndexes.go).toBeUndefined();
  });

  it('does NOT fabricate a false hub: two unrelated root files get disjoint dependents (the #1056 failure shape, checked explicitly)', () => {
    const chunks: CodeChunk[] = [
      createGoChunk('context.go', { exports: ['RouteContext'] }),
      createGoChunk('chi.go', { exports: ['NewRouter'] }),
      createGoChunk('middleware/clean_path.go', {
        imports: [MODULE_PREFIX],
        callSites: ['RouteContext'],
      }),
      createGoChunk('middleware/profiler.go', {
        imports: [MODULE_PREFIX],
        callSites: ['NewRouter'],
      }),
    ];

    const contextDeps = findDependents(chunks, 'context.go', noopLog, workspaceRoot).dependents.map(
      d => d.filepath,
    );
    const chiDeps = findDependents(chunks, 'chi.go', noopLog, workspaceRoot).dependents.map(
      d => d.filepath,
    );

    expect(contextDeps).toEqual(['middleware/clean_path.go']);
    expect(chiDeps).toEqual(['middleware/profiler.go']);
    expect(contextDeps).not.toEqual(chiDeps);
  });

  it("never guesses when a root export name collides across two root files (chi's own ServeHTTP, declared by both chain.go and mux.go)", () => {
    const chunks: CodeChunk[] = [
      createGoChunk('chain.go', { exports: ['ServeHTTP'] }),
      createGoChunk('mux.go', { exports: ['ServeHTTP'] }),
      createGoChunk('middleware/whatever.go', {
        imports: [MODULE_PREFIX],
        callSites: ['ServeHTTP'],
      }),
    ];

    expect(findDependents(chunks, 'chain.go', noopLog, workspaceRoot).dependents).toEqual([]);
    expect(findDependents(chunks, 'mux.go', noopLog, workspaceRoot).dependents).toEqual([]);
  });

  it('does not recover anything for a single-segment, non-distinctive export name (the Use/Get/Post false-positive risk)', () => {
    const chunks: CodeChunk[] = [
      createGoChunk('mux.go', { exports: ['Use', 'Get', 'Post'] }),
      createGoChunk('unrelated/builder.go', {
        imports: [MODULE_PREFIX],
        callSites: ['Use'],
      }),
    ];

    expect(findDependents(chunks, 'mux.go', noopLog, workspaceRoot).dependents).toEqual([]);
  });

  it('does not run the fallback when the import graph already found real dependents', () => {
    const chunks: CodeChunk[] = [
      createGoChunk('context.go', { exports: ['RouteContext'] }),
      // A real, direct import edge already resolves this one.
      createGoChunk('direct.go', { imports: ['context'] }),
      createGoChunk('middleware/clean_path.go', {
        imports: [MODULE_PREFIX],
        callSites: ['RouteContext'],
      }),
    ];

    const result = findDependents(chunks, 'context.go', noopLog, workspaceRoot);
    expect(result.dependentAttributionPartial).toBeUndefined();
  });

  it('does not run the fallback for a SYMBOL-scoped query', () => {
    const chunks: CodeChunk[] = [
      createGoChunk('context.go', { exports: ['RouteContext'] }),
      createGoChunk('middleware/clean_path.go', {
        imports: [MODULE_PREFIX],
        callSites: ['RouteContext'],
      }),
    ];

    const result = findDependents(chunks, 'context.go', noopLog, workspaceRoot, 'RouteContext');
    expect(result.dependentAttributionPartial).toBeUndefined();
  });

  it('does not run the fallback for a non-Go file', () => {
    const chunks: CodeChunk[] = [
      {
        content: '',
        metadata: {
          file: 'src/context.ts',
          startLine: 1,
          endLine: 10,
          type: 'function',
          language: 'typescript',
          exports: ['RouteContext'],
        },
      },
      createGoChunk('middleware/clean_path.go', {
        imports: [MODULE_PREFIX],
        callSites: ['RouteContext'],
      }),
    ];

    const result = findDependents(chunks, 'src/context.ts', noopLog, workspaceRoot);
    expect(result.dependentAttributionPartial).toBeUndefined();
  });
});

describe('bare crate-root `use` edges end-to-end (#1056 regression)', () => {
  // The real serde/serde_derive repro: `use serde_derive::Deserialize;` (a
  // cross-crate import naming only the crate + a symbol, no submodule path)
  // resolved to the crate's bare `src/` directory, which -- because
  // `crateDir` for a WORKSPACE MEMBER crate is a multi-segment path
  // (`serde_derive/src`, not the single-segment `src` a non-workspace
  // project's own crate gets) -- fuzzy-matched every file the crate
  // contains via `matchesFile`'s Go-style package-directory leniency.
  // Confirmed on a real clone: two unrelated files (`serde_derive/src/de.rs`,
  // `serde_derive/src/dummy.rs`) returned an IDENTICAL 144-file dependent
  // list. This needs a REAL Cargo workspace on disk (`resolveRustCrateMap`
  // reads `Cargo.toml` from the filesystem, not from synthetic chunks), so
  // -- unlike #1021/#1028's in-memory fixtures above -- this writes actual
  // files to a temp directory and parses them via `chunkByAST`'s
  // `workspaceRoot` option.
  //
  // Uses `findDependents` (not `analyzeDependencies`, used by the fixtures
  // above): `get_dependents` -- this bug's actual symptom -- is a thin
  // wrapper over `findDependents`, and only `findDependents`'s import index
  // (`addChunkToImportIndex`) indexes `chunk.metadata.importedSymbols` keys
  // alongside the raw `imports` array; `analyzeDependencies`'s own index
  // (`buildImportIndex`, used for complexity-report risk analysis) only
  // reads `imports` and would not exercise this fix at all.
  function noopLog(): void {
    // Intentionally empty -- this suite only cares about resolved counts.
  }

  let testDir: string;

  beforeEach(() => {
    testDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'lien-test-dep-analyzer-rust-1056-'));
  });

  afterEach(() => {
    clearRustCrateMapCache();
    clearRustCrateExportCache();
    fsSync.rmSync(testDir, { recursive: true, force: true });
  });

  /** Parse `content` as `relPath` within `testDir`'s Cargo workspace (writes it to disk first — `resolveRustCrateMap` needs a real `Cargo.toml` to read). */
  function chunkInWorkspace(relPath: string, content: string) {
    const abs = path.join(testDir, relPath);
    fsSync.mkdirSync(path.dirname(abs), { recursive: true });
    fsSync.writeFileSync(abs, content);
    return chunkByAST(relPath, content, { workspaceRoot: testDir });
  }

  function setUpWorkspace(): void {
    fsSync.writeFileSync(
      path.join(testDir, 'Cargo.toml'),
      '[workspace]\nmembers = ["main_crate", "lib_macro"]\n',
    );
    fsSync.mkdirSync(path.join(testDir, 'main_crate'), { recursive: true });
    fsSync.writeFileSync(
      path.join(testDir, 'main_crate/Cargo.toml'),
      '[package]\nname = "main_crate"\nversion = "0.1.0"\n',
    );
    fsSync.mkdirSync(path.join(testDir, 'lib_macro'), { recursive: true });
    fsSync.writeFileSync(
      path.join(testDir, 'lib_macro/Cargo.toml'),
      '[package]\nname = "lib_macro"\nversion = "0.1.0"\n',
    );
  }

  it('DISTINCTNESS: two unrelated files in the same crate do not share a fabricated crate-wide dependent list', () => {
    setUpWorkspace();

    const chunks = [
      // lib_macro's own crate root: `Symbol` is a proc-macro-derive name
      // declared directly here, exactly like serde_derive's real shape.
      ...chunkInWorkspace(
        'lib_macro/src/lib.rs',
        [
          'mod helper_a;',
          'mod helper_b;',
          '',
          '#[proc_macro_derive(Symbol)]',
          'pub fn derive_symbol(input: TokenStream) -> TokenStream {',
          '    unimplemented!()',
          '}',
        ].join('\n'),
      ),
      // Two UNRELATED files inside lib_macro -- neither declares or
      // re-exports `Symbol`, and they have nothing to do with each other.
      ...chunkInWorkspace('lib_macro/src/helper_a.rs', 'pub fn a_helper() -> u32 { 1 }\n'),
      ...chunkInWorkspace('lib_macro/src/helper_b.rs', 'pub fn b_helper() -> u32 { 2 }\n'),
      // main_crate consumes lib_macro by its published name (the ordinary
      // shape for a workspace member consuming another member's public API).
      ...chunkInWorkspace(
        'main_crate/src/lib.rs',
        'use lib_macro::Symbol;\n\n#[derive(Symbol)]\npub struct Thing;\n',
      ),
    ];

    const depsA = findDependents(
      chunks,
      'lib_macro/src/helper_a.rs',
      noopLog,
      testDir,
    ).dependents.map(d => d.filepath);
    const depsB = findDependents(
      chunks,
      'lib_macro/src/helper_b.rs',
      noopLog,
      testDir,
    ).dependents.map(d => d.filepath);
    const depsLib = findDependents(chunks, 'lib_macro/src/lib.rs', noopLog, testDir).dependents.map(
      d => d.filepath,
    );

    // Each helper's only REAL dependent is `lib.rs` itself (via its own
    // `mod helper_a;`/`mod helper_b;` declaration) -- neither actually
    // declares or re-exports `Symbol`. The core #1056 bug shape: before the
    // fix, BOTH helpers additionally fabricated `main_crate/src/lib.rs` as a
    // dependent too, via the bare crate-wide directory match.
    expect(depsA).toEqual(['lib_macro/src/lib.rs']);
    expect(depsB).toEqual(['lib_macro/src/lib.rs']);
    // The ONE real edge for lib.rs itself: main_crate consumes what
    // lib_macro's OWN root file declares.
    expect(depsLib).toEqual(['main_crate/src/lib.rs']);
  });

  it('still resolves the real edge when the bare crate-root symbol truly is a top-level pub item', () => {
    setUpWorkspace();

    const chunks = [
      ...chunkInWorkspace('lib_macro/src/lib.rs', 'pub fn helper() -> u32 {\n    42\n}\n'),
      ...chunkInWorkspace(
        'main_crate/src/lib.rs',
        'use lib_macro::helper;\n\npub fn run() -> u32 {\n    helper()\n}\n',
      ),
    ];

    expect(
      findDependents(chunks, 'lib_macro/src/lib.rs', noopLog, testDir).dependents.map(
        d => d.filepath,
      ),
    ).toEqual(['main_crate/src/lib.rs']);
  });

  it('emits nothing (honest gap) rather than fabricating when the symbol cannot be found in the crate root file', () => {
    setUpWorkspace();

    const chunks = [
      ...chunkInWorkspace('lib_macro/src/lib.rs', 'mod helper_a;\n'),
      ...chunkInWorkspace('lib_macro/src/helper_a.rs', 'pub fn a_helper() -> u32 { 1 }\n'),
      // `a_helper` is real, but only reachable via `helper_a::a_helper()`,
      // not re-exported from the crate root -- this v1 export lookup
      // deliberately doesn't trace that chain (see rust-crate-exports.ts).
      ...chunkInWorkspace(
        'main_crate/src/lib.rs',
        'use lib_macro::a_helper;\n\npub fn run() -> u32 {\n    a_helper()\n}\n',
      ),
    ];

    // lib.rs has no dependents of its own (nothing imports IT bare); the
    // real `mod helper_a;` edge is the only relationship in this fixture,
    // and main_crate's unresolvable `a_helper` import must not fabricate a
    // second one onto either file.
    expect(findDependents(chunks, 'lib_macro/src/lib.rs', noopLog, testDir).dependents).toEqual([]);
    expect(
      findDependents(chunks, 'lib_macro/src/helper_a.rs', noopLog, testDir).dependents.map(
        d => d.filepath,
      ),
    ).toEqual(['lib_macro/src/lib.rs']);
  });
});

/**
 * #1075: `uncoveredProductionDependents` asks "does any test file import this?"
 * once per production dependent. It used to answer by re-scanning the WHOLE
 * import index each time -- O(dependents x every indexed import), measured at
 * 95% of a 166-second `get_dependents` call on a 6,356-file C# corpus. It now
 * resolves against a test-file-only projection of that index, built once.
 *
 * That makes the projection a pruning OPTIMIZATION, and this is the property
 * that keeps it from quietly becoming a second import-matching dialect: for the
 * same chunk set, the pruned predicate and the unpruned whole-index scan must
 * agree for EVERY file. Without it, dropping a real test importer would just
 * inflate `uncoveredProductionDependents` into a plausible-looking larger
 * number -- an invented "untested dependents" signal, which is the exact
 * failure direction #1014 warns about.
 *
 * Mirrors `dependent-count-index.test.ts`'s brute-force equivalence block, and
 * verified out-of-band the same way: exhaustively over every file of the eleven
 * real corpora the CLI E2E matrix names, plus serilog and OrchardCore.
 */
describe('test-importer index is exact (brute-force equivalence, #1075)', () => {
  const ROOT = '/workspace';

  function chunk(
    file: string,
    options: {
      imports?: string[];
      importedSymbols?: Record<string, string[]>;
      language?: string;
      startLine?: number;
    } = {},
  ): CodeChunk {
    return {
      content: '// body',
      metadata: {
        file,
        startLine: options.startLine ?? 1,
        endLine: (options.startLine ?? 1) + 9,
        type: 'function',
        language: options.language ?? 'typescript',
        imports: options.imports ?? [],
        importedSymbols: options.importedSymbols,
      } as ChunkMetadata,
    };
  }

  /**
   * Test importers in each language's real specifier shape, as the index
   * actually stores it after extraction-time resolution -- same sourcing
   * discipline as `dependent-count-index.test.ts`'s fixture.
   */
  const corpora: Record<string, CodeChunk[]> = {
    'multi-language test importers': [
      // TypeScript: a relative spec from a co-located .test.ts.
      chunk('src/utils/logger.ts'),
      chunk('src/app.ts', { imports: ['./utils/logger'] }),
      chunk('src/app.test.ts', { imports: ['./app'] }),
      // ...and a production file with NO test importer at all.
      chunk('src/orphan.ts'),
      chunk('src/uses-orphan.ts', { imports: ['./orphan'] }),

      // Python: dotted module from a tests/ directory.
      chunk('src/flask/app.py', { language: 'python' }),
      chunk('tests/test_app.py', { language: 'python', imports: ['src.flask.app'] }),

      // Go: an external test file importing the package directory.
      chunk('internal/bytesconv/bytesconv.go', { language: 'go' }),
      chunk('router_test.go', { language: 'go', imports: ['internal/bytesconv'] }),

      // PHP: PSR-4 namespace from a capitalized Tests/ directory (#925).
      chunk('app/Models/Order.php', { language: 'php' }),
      chunk('Tests/OrderTest.php', { language: 'php', imports: ['App\\Models\\Order'] }),

      // Java: an already-source-root-resolved path from src/test (#1046).
      chunk('src/main/java/com/example/Widget.java', { language: 'java' }),
      chunk('src/test/java/com/example/WidgetTest.java', {
        language: 'java',
        imports: ['src/main/java/com/example/Widget.java'],
      }),

      // Ruby: a bare multi-segment require from spec/ (#887 -- names ONE file).
      chunk('lib/rack/protection.rb', { language: 'ruby' }),
      chunk('lib/rack/protection/base.rb', { language: 'ruby' }),
      chunk('spec/protection_spec.rb', { language: 'ruby', imports: ['rack/protection'] }),

      // Swift: a whole-module import from XCTest -- deliberately unresolvable
      // per file (#884), so the .swift source must come back uncovered.
      chunk('Sources/App/Feature.swift', { language: 'swift' }),
      chunk('Tests/AppTests/FeatureTests.swift', { language: 'swift', imports: ['App'] }),

      // C#: a dotted namespace from a *Tests.cs file. `matchesFile` genuinely
      // can't resolve this shape (the #930 type-reference tier exists for it),
      // so this is a negative the two implementations must agree on.
      chunk('src/Serilog.Core/Enrichers.cs', { language: 'csharp' }),
      chunk('test/Serilog.Tests/EnricherTests.cs', {
        language: 'csharp',
        imports: ['Serilog.Core.Enrichers'],
      }),
    ],

    // Where the 15x dedup happens: one test file chunked many times, each chunk
    // replicating the file's whole import list.
    'a test file with many chunks sharing one import list': [
      chunk('src/target.ts'),
      chunk('src/other.ts'),
      ...[1, 11, 21, 31, 41].map(startLine =>
        chunk('src/target.test.ts', { imports: ['./target', './other'], startLine }),
      ),
    ],

    // Only the direct-bucket branch fires: the stored specifier normalizes to
    // exactly the target key, so neither implementation runs a fuzzy match.
    'exact-key direct bucket only': [
      chunk('src/deep/nested/thing.ts'),
      chunk('src/deep/nested/thing.test.ts', { imports: ['src/deep/nested/thing.ts'] }),
    ],

    // importedSymbols-only importer (no `imports` entry) -- the second half of
    // what `addChunkToImportIndex` feeds the index.
    'test importer via importedSymbols only': [
      chunk('src/service.ts'),
      chunk('src/service.spec.ts', { importedSymbols: { './service': ['Service'] } }),
    ],

    // Near-miss names that must NOT resolve: a boundary bug in either
    // implementation would light these up.
    'boundary near-misses': [
      chunk('src/logger.ts'),
      chunk('src/logger-utils.ts'),
      chunk('src/logger-utils.test.ts', { imports: ['./logger-utils'] }),
      chunk('src/contest.ts', { imports: ['./logger'] }),
    ],

    // A test file that is itself imported by another test file.
    'test importing test': [
      chunk('test/helpers/factory.ts'),
      chunk('test/user.test.ts', { imports: ['./helpers/factory'] }),
    ],

    // Degenerate metadata: empty file string, empty specifier.
    'degenerate metadata': [
      chunk('', { imports: [''] }),
      chunk('src/real.ts'),
      chunk('src/real.test.ts', { imports: ['./real'] }),
    ],
  };

  for (const [name, chunks] of Object.entries(corpora)) {
    it(`agrees with the unpruned whole-index scan for every file: ${name}`, () => {
      const files = [...new Set(chunks.map(c => c.metadata.file))];
      const verdicts = files.map(file => {
        const pruned = hasTestImporterFromChunks(chunks, file, ROOT);
        expect(pruned, `${name} -> ${file}`).toBe(hasTestImporterBruteForce(chunks, file, ROOT));
        return pruned;
      });
      // A corpus where nothing has a test importer would make the equivalence
      // above vacuously true, so require each fixture to exercise both answers.
      expect(verdicts, `${name} produced no covered file`).toContain(true);
      expect(verdicts, `${name} produced no uncovered file`).toContain(false);
    });
  }

  it('counts uncovered production dependents from the projected index', () => {
    const chunks = [
      chunk('src/target.ts'),
      // Covered: has a test importer of its own.
      chunk('src/covered.ts', { imports: ['./target'] }),
      chunk('src/covered.test.ts', { imports: ['./covered'] }),
      // Uncovered: production dependent with no test importer.
      chunk('src/uncovered.ts', { imports: ['./target'] }),
      // A test file that depends on the target directly is not a *production*
      // dependent at all, so it never enters the count.
      chunk('src/target.test.ts', { imports: ['./target'] }),
    ];

    const result = findDependents(chunks, 'src/target.ts', () => {}, ROOT);

    expect(result.dependents.map(d => d.filepath).sort()).toEqual([
      'src/covered.ts',
      'src/target.test.ts',
      'src/uncovered.ts',
    ]);
    expect(result.productionDependentCount).toBe(2);
    expect(result.uncoveredProductionDependents).toBe(1);
  });

  it('returns zero without building the projection when every dependent is a test file', () => {
    const chunks = [chunk('src/target.ts'), chunk('src/target.test.ts', { imports: ['./target'] })];
    const result = findDependents(chunks, 'src/target.ts', () => {}, ROOT);
    expect(result.productionDependentCount).toBe(0);
    expect(result.uncoveredProductionDependents).toBe(0);
  });
});

/**
 * #1097: `checkDependentAttributionIncomplete` used to guard on `symbol ||
 * ...`, unconditionally skipping its whole blind-spot determination for
 * every symbol-scoped query -- exactly the shape of `get_dependents({filepath,
 * symbol})` and every `lien api-delta` check. A real, non-type-declaration
 * exported symbol with zero import-graph-visible dependents in one of
 * `hasDependentAttributionBlindSpot`'s languages (C#, Java, Kotlin, Swift)
 * came back with no caveat at all, even though the identical file's
 * file-level query correctly carried `dependentAttributionIncomplete`.
 */
describe('dependentAttributionIncomplete widening to symbol-scoped queries (#1097)', () => {
  const workspaceRoot = '/test/workspace';

  function createChunk(
    file: string,
    options: {
      exports?: string[];
      imports?: string[];
      importedSymbols?: Record<string, string[]>;
      symbolName?: string;
      symbolType?: 'function' | 'method' | 'class' | 'interface';
      content?: string;
    } = {},
  ): CodeChunk {
    return {
      content: options.content ?? 'test content',
      metadata: {
        file,
        startLine: 1,
        endLine: 10,
        type: 'function',
        language: 'typescript',
        imports: options.imports,
        exports: options.exports,
        importedSymbols: options.importedSymbols,
        symbolName: options.symbolName,
        symbolType: options.symbolType,
      } as ChunkMetadata,
    };
  }

  it('flags a zero-dependent Java SYMBOL query for a method with no candidate importers at all', () => {
    const chunks = [createChunk('Logger.java', { exports: ['Logger'] })];

    const result = findDependents(chunks, 'Logger.java', () => {}, workspaceRoot, 'logInfo');

    expect(result.dependents).toHaveLength(0);
    expect(result.symbolAttributionDegraded).toBeUndefined();
    expect(result.dependentAttributionIncomplete).toBe(true);
  });

  it('flags a zero-dependent Kotlin SYMBOL query on a plain (non-type) exported symbol', () => {
    const chunks = [createChunk('Util.kt', { exports: ['formatName'] })];

    const result = findDependents(chunks, 'Util.kt', () => {}, workspaceRoot, 'formatName');

    expect(result.dependents).toHaveLength(0);
    expect(result.dependentAttributionIncomplete).toBe(true);
  });

  it('flags a zero-dependent Swift SYMBOL query on a plain (non-type) exported symbol', () => {
    const chunks = [createChunk('Util.swift', { exports: ['formatName'] })];

    const result = findDependents(chunks, 'Util.swift', () => {}, workspaceRoot, 'formatName');

    expect(result.dependents).toHaveLength(0);
    expect(result.dependentAttributionIncomplete).toBe(true);
  });

  it('does not double-caveat a type-declaration SYMBOL query (typeSymbolAttributionIncomplete already explains the same zero)', () => {
    const chunks = [
      createChunk('Alignment.cs', {
        exports: ['Alignment'],
        symbolName: 'Alignment',
        symbolType: 'class',
        content: 'public class Alignment { }',
      }),
    ];

    const result = findDependents(chunks, 'Alignment.cs', () => {}, workspaceRoot, 'Alignment');

    expect(result.dependents).toHaveLength(0);
    expect(result.typeSymbolAttributionIncomplete).toBe(true);
    expect(result.dependentAttributionIncomplete).toBeUndefined();
  });

  it('does not flag a SYMBOL query with real dependents (dependentCount !== 0 already guards it)', () => {
    const chunks = [
      createChunk('Logger.java', { exports: ['Logger'] }),
      createChunk('Consumer.java', {
        imports: ['Logger.java'],
        importedSymbols: { 'Logger.java': ['Logger'] },
      }),
    ];

    const result = findDependents(chunks, 'Logger.java', () => {}, workspaceRoot, 'Logger');

    expect(result.dependents.length).toBeGreaterThan(0);
    expect(result.dependentAttributionIncomplete).toBeUndefined();
  });

  // Controls: the identical symbol-query shape in a NON-blind-spot language
  // must NOT start getting a spurious caveat -- #1014's whole point is that
  // an over-firing caveat gets trained out as noise and is worse than none.
  it('does NOT widen to a TypeScript SYMBOL query (control)', () => {
    const chunks = [createChunk('src/util.ts', { exports: ['formatName'] })];

    const result = findDependents(chunks, 'src/util.ts', () => {}, workspaceRoot, 'formatName');

    expect(result.dependents).toHaveLength(0);
    expect(result.dependentAttributionIncomplete).toBeUndefined();
  });

  it('does NOT widen to a Python SYMBOL query (control)', () => {
    const chunks = [createChunk('src/util.py', { exports: ['format_name'] })];

    const result = findDependents(chunks, 'src/util.py', () => {}, workspaceRoot, 'format_name');

    expect(result.dependents).toHaveLength(0);
    expect(result.dependentAttributionIncomplete).toBeUndefined();
  });

  it('does NOT widen to a Go SYMBOL query (deliberate exclusion, same as the file-level widening)', () => {
    const chunks = [createChunk('pkg/thing.go', { exports: ['Thing'] })];

    const result = findDependents(chunks, 'pkg/thing.go', () => {}, workspaceRoot, 'Thing');

    expect(result.dependents).toHaveLength(0);
    expect(result.dependentAttributionIncomplete).toBeUndefined();
  });
});
