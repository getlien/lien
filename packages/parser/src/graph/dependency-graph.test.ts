import { describe, it, expect, vi } from 'vitest';
import {
  buildDependencyGraph,
  isPreciseProvenance,
  isImportOnlyEvidenceTier,
} from './dependency-graph.js';
import type { EdgeProvenance } from './dependency-graph.js';
import type { CodeChunk } from '../types.js';
import { findDependents } from '../dependency-analyzer.js';
import * as jvmSignals from '../jvm-same-package-signals.js';

/**
 * Create a minimal CodeChunk for testing.
 *
 * Local copy of review's `test-helpers.ts` factory of the same name — kept
 * as a small non-exported duplicate here rather than importing across the
 * package boundary, since this test moved into parser (#994-adjacent lift)
 * while that shared review-only test helper stays in `@liendev/review`
 * (still used by 3 other review test files).
 */
function createTestChunk(overrides?: Partial<CodeChunk>): CodeChunk {
  const { metadata: metadataOverrides, ...rest } = overrides ?? {};
  return {
    content: 'function test() { return true; }',
    metadata: {
      file: 'test.ts',
      startLine: 1,
      endLine: 1,
      type: 'function',
      symbolName: 'test',
      language: 'typescript',
      ...metadataOverrides,
    },
    ...rest,
  } as CodeChunk;
}

// ---------------------------------------------------------------------------
// buildDependencyGraph
//
// Import resolution itself (formerly this module's own `resolveImportPath`,
// JS/TS-only with a hardcoded 6-extension list) is now @liendev/parser's
// `importMatchesTarget` — see `packages/parser/src/utils/path-matching.test.ts`
// for that primitive's own coverage (133 cases across every AST-supported
// language). The tests below stay at `buildDependencyGraph`'s level: do the
// caller-graph edges come out right end-to-end, not the path-matching detail.
// ---------------------------------------------------------------------------

describe('buildDependencyGraph', () => {
  it('returns empty callers for empty chunks', () => {
    const graph = buildDependencyGraph([]);
    expect(graph.getCallers('any.ts', 'foo')).toEqual([]);
  });

  it('finds callers via import + callSite', () => {
    const definitionChunk = createTestChunk({
      metadata: {
        file: 'src/utils/validate.ts',
        startLine: 1,
        endLine: 10,
        type: 'function',
        symbolName: 'validateEmail',
        language: 'typescript',
        exports: ['validateEmail'],
      },
    });

    const callerChunk = createTestChunk({
      content: 'function register(email) { validateEmail(email); }',
      metadata: {
        file: 'src/services/auth.ts',
        startLine: 5,
        endLine: 15,
        type: 'function',
        symbolName: 'register',
        language: 'typescript',
        importedSymbols: { '../utils/validate': ['validateEmail'] },
        callSites: [{ symbol: 'validateEmail', line: 8 }],
      },
    });

    const graph = buildDependencyGraph([definitionChunk, callerChunk]);
    const callers = graph.getCallers('src/utils/validate.ts', 'validateEmail');

    expect(callers).toHaveLength(1);
    expect(callers[0].caller.filepath).toBe('src/services/auth.ts');
    expect(callers[0].caller.symbolName).toBe('register');
    expect(callers[0].callSiteLine).toBe(8);
    expect(callers[0].provenance).toBe('import-verified');
  });

  it('finds same-file callers (no import needed)', () => {
    const helperChunk = createTestChunk({
      metadata: {
        file: 'src/utils.ts',
        startLine: 1,
        endLine: 5,
        type: 'function',
        symbolName: 'helper',
        language: 'typescript',
        exports: ['helper', 'main'],
      },
    });

    const mainChunk = createTestChunk({
      content: 'function main() { helper(); }',
      metadata: {
        file: 'src/utils.ts',
        startLine: 7,
        endLine: 12,
        type: 'function',
        symbolName: 'main',
        language: 'typescript',
        exports: ['helper', 'main'],
        callSites: [{ symbol: 'helper', line: 9 }],
      },
    });

    const graph = buildDependencyGraph([helperChunk, mainChunk]);
    const callers = graph.getCallers('src/utils.ts', 'helper');

    expect(callers).toHaveLength(1);
    expect(callers[0].caller.symbolName).toBe('main');
    expect(callers[0].callSiteLine).toBe(9);
    expect(callers[0].provenance).toBe('same-file');
  });

  it('finds multiple callers from different files', () => {
    const definition = createTestChunk({
      metadata: {
        file: 'src/lib/format.ts',
        startLine: 1,
        endLine: 5,
        type: 'function',
        symbolName: 'formatDate',
        language: 'typescript',
        exports: ['formatDate'],
      },
    });

    const caller1 = createTestChunk({
      metadata: {
        file: 'src/views/dashboard.ts',
        startLine: 1,
        endLine: 10,
        type: 'function',
        symbolName: 'renderDashboard',
        language: 'typescript',
        importedSymbols: { '../lib/format': ['formatDate'] },
        callSites: [{ symbol: 'formatDate', line: 5 }],
      },
    });

    const caller2 = createTestChunk({
      metadata: {
        file: 'src/views/report.ts',
        startLine: 1,
        endLine: 10,
        type: 'function',
        symbolName: 'renderReport',
        language: 'typescript',
        importedSymbols: { '../lib/format': ['formatDate'] },
        callSites: [{ symbol: 'formatDate', line: 3 }],
      },
    });

    const graph = buildDependencyGraph([definition, caller1, caller2]);
    const callers = graph.getCallers('src/lib/format.ts', 'formatDate');

    expect(callers).toHaveLength(2);
    const callerNames = callers.map(c => c.caller.symbolName).sort();
    expect(callerNames).toEqual(['renderDashboard', 'renderReport']);
  });

  it('handles chunks without callSites or exports gracefully', () => {
    const chunk = createTestChunk({
      metadata: {
        file: 'src/types.ts',
        startLine: 1,
        endLine: 5,
        type: 'block',
        language: 'typescript',
      },
    });

    const graph = buildDependencyGraph([chunk]);
    expect(graph.getCallers('src/types.ts', 'anything')).toEqual([]);
  });

  it('disambiguates same symbol name from different files via import', () => {
    const validate1 = createTestChunk({
      metadata: {
        file: 'src/validators/email.ts',
        startLine: 1,
        endLine: 5,
        type: 'function',
        symbolName: 'validate',
        language: 'typescript',
        exports: ['validate'],
      },
    });

    const validate2 = createTestChunk({
      metadata: {
        file: 'src/validators/phone.ts',
        startLine: 1,
        endLine: 5,
        type: 'function',
        symbolName: 'validate',
        language: 'typescript',
        exports: ['validate'],
      },
    });

    const caller = createTestChunk({
      metadata: {
        file: 'src/services/user.ts',
        startLine: 1,
        endLine: 10,
        type: 'function',
        symbolName: 'createUser',
        language: 'typescript',
        importedSymbols: { '../validators/email': ['validate'] },
        callSites: [{ symbol: 'validate', line: 5 }],
      },
    });

    const graph = buildDependencyGraph([validate1, validate2, caller]);

    // Should only appear as caller of email.ts validate, not phone.ts
    const emailCallers = graph.getCallers('src/validators/email.ts', 'validate');
    expect(emailCallers).toHaveLength(1);

    const phoneCallers = graph.getCallers('src/validators/phone.ts', 'validate');
    expect(phoneCallers).toHaveLength(0);
  });

  it('resolves .js extension import to .ts file', () => {
    const definition = createTestChunk({
      metadata: {
        file: 'src/utils/helpers.ts',
        startLine: 1,
        endLine: 5,
        type: 'function',
        symbolName: 'doStuff',
        language: 'typescript',
        exports: ['doStuff'],
      },
    });

    const caller = createTestChunk({
      metadata: {
        file: 'src/index.ts',
        startLine: 1,
        endLine: 10,
        type: 'function',
        symbolName: 'main',
        language: 'typescript',
        importedSymbols: { './utils/helpers.js': ['doStuff'] },
        callSites: [{ symbol: 'doStuff', line: 3 }],
      },
    });

    const graph = buildDependencyGraph([definition, caller]);
    const callers = graph.getCallers('src/utils/helpers.ts', 'doStuff');

    expect(callers).toHaveLength(1);
    expect(callers[0].caller.symbolName).toBe('main');
  });
});

// ---------------------------------------------------------------------------
// Cross-package symbol-name fallback
// ---------------------------------------------------------------------------

describe('buildDependencyGraph — cross-package fallback', () => {
  it('resolves TypeScript package import (@liendev/review)', () => {
    const definition = createTestChunk({
      metadata: {
        file: 'packages/review/src/analysis.ts',
        startLine: 1,
        endLine: 10,
        type: 'function',
        symbolName: 'filterAnalyzableFiles',
        language: 'typescript',
        exports: ['filterAnalyzableFiles'],
      },
    });

    const caller = createTestChunk({
      metadata: {
        file: 'packages/action/src/index.ts',
        startLine: 50,
        endLine: 80,
        type: 'function',
        symbolName: 'handlePRReview',
        language: 'typescript',
        importedSymbols: { '@liendev/review': ['filterAnalyzableFiles'] },
        callSites: [{ symbol: 'filterAnalyzableFiles', line: 65 }],
      },
    });

    const graph = buildDependencyGraph([definition, caller]);
    const callers = graph.getCallers('packages/review/src/analysis.ts', 'filterAnalyzableFiles');

    expect(callers).toHaveLength(1);
    expect(callers[0].caller.symbolName).toBe('handlePRReview');
    expect(callers[0].caller.filepath).toBe('packages/action/src/index.ts');
  });

  it('resolves PHP namespace import (use App\\Services\\...)', () => {
    const definition = createTestChunk({
      metadata: {
        file: 'app/Services/RepoConfigService.php',
        startLine: 10,
        endLine: 30,
        type: 'function',
        symbolName: 'getRunnerConfig',
        language: 'php',
        exports: ['getRunnerConfig'],
      },
    });

    const caller = createTestChunk({
      metadata: {
        file: 'app/Jobs/ProcessPullRequestWebhook.php',
        startLine: 40,
        endLine: 60,
        type: 'function',
        symbolName: 'handle',
        language: 'php',
        importedSymbols: { 'App\\Services\\RepoConfigService': ['getRunnerConfig'] },
        callSites: [{ symbol: 'getRunnerConfig', line: 50 }],
      },
    });

    const graph = buildDependencyGraph([definition, caller]);
    const callers = graph.getCallers('app/Services/RepoConfigService.php', 'getRunnerConfig');

    expect(callers).toHaveLength(1);
    expect(callers[0].caller.symbolName).toBe('handle');
  });

  it('resolves Python absolute import (from package.module import ...)', () => {
    const definition = createTestChunk({
      metadata: {
        file: 'src/utils/validator.py',
        startLine: 1,
        endLine: 10,
        type: 'function',
        symbolName: 'validate_email',
        language: 'python',
        exports: ['validate_email'],
      },
    });

    const caller = createTestChunk({
      metadata: {
        file: 'src/services/auth.py',
        startLine: 5,
        endLine: 20,
        type: 'function',
        symbolName: 'register_user',
        language: 'python',
        importedSymbols: { 'utils.validator': ['validate_email'] },
        callSites: [{ symbol: 'validate_email', line: 10 }],
      },
    });

    const graph = buildDependencyGraph([definition, caller]);
    const callers = graph.getCallers('src/utils/validator.py', 'validate_email');

    expect(callers).toHaveLength(1);
    expect(callers[0].caller.symbolName).toBe('register_user');
  });

  it('resolves Rust crate import (use crate::module::symbol)', () => {
    const definition = createTestChunk({
      metadata: {
        file: 'src/utils/validate.rs',
        startLine: 1,
        endLine: 10,
        type: 'function',
        symbolName: 'validate_input',
        language: 'rust',
        exports: ['validate_input'],
      },
    });

    const caller = createTestChunk({
      metadata: {
        file: 'src/handlers/api.rs',
        startLine: 10,
        endLine: 30,
        type: 'function',
        symbolName: 'handle_request',
        language: 'rust',
        importedSymbols: { 'crate::utils::validate': ['validate_input'] },
        callSites: [{ symbol: 'validate_input', line: 20 }],
      },
    });

    const graph = buildDependencyGraph([definition, caller]);
    const callers = graph.getCallers('src/utils/validate.rs', 'validate_input');

    expect(callers).toHaveLength(1);
    expect(callers[0].caller.symbolName).toBe('handle_request');
  });

  it('links to all exporting files when symbol is re-exported (barrel files)', () => {
    const def1 = createTestChunk({
      metadata: {
        file: 'src/utils/format.ts',
        startLine: 1,
        endLine: 5,
        type: 'function',
        symbolName: 'format',
        language: 'typescript',
        exports: ['format'],
      },
    });

    const def2 = createTestChunk({
      metadata: {
        file: 'src/helpers/format.ts',
        startLine: 1,
        endLine: 5,
        type: 'function',
        symbolName: 'format',
        language: 'typescript',
        exports: ['format'],
      },
    });

    const caller = createTestChunk({
      metadata: {
        file: 'src/app.ts',
        startLine: 1,
        endLine: 10,
        type: 'function',
        symbolName: 'main',
        language: 'typescript',
        importedSymbols: { 'some-package': ['format'] },
        callSites: [{ symbol: 'format', line: 5 }],
      },
    });

    const graph = buildDependencyGraph([def1, def2, caller]);
    const utilsCallers = graph.getCallers('src/utils/format.ts', 'format');
    const helpersCallers = graph.getCallers('src/helpers/format.ts', 'format');
    expect(utilsCallers).toHaveLength(1);
    expect(helpersCallers).toHaveLength(1);
    expect(utilsCallers[0].provenance).toBe('symbol-name-match');
    expect(helpersCallers[0].provenance).toBe('symbol-name-match');
  });

  it('resolves OOP method call through class import (step 3b)', () => {
    const methodChunk = createTestChunk({
      metadata: {
        file: 'app/Models/Order.php',
        startLine: 10,
        endLine: 20,
        type: 'function',
        symbolName: 'findById',
        symbolType: 'method',
        language: 'php',
        exports: ['Order'],
      },
    });

    const callerChunk = createTestChunk({
      content: 'function findOrder($id) { return Order::findById($id); }',
      metadata: {
        file: 'app/Repositories/OrderRepository.php',
        startLine: 1,
        endLine: 10,
        type: 'function',
        symbolName: 'findOrder',
        language: 'php',
        importedSymbols: { 'App\\Models\\Order': ['Order'] },
        callSites: [{ symbol: 'findById', line: 5 }],
      },
    });

    const graph = buildDependencyGraph([methodChunk, callerChunk]);
    const callers = graph.getCallers('app/Models/Order.php', 'findById');

    expect(callers).toHaveLength(1);
    expect(callers[0].caller.filepath).toBe('app/Repositories/OrderRepository.php');
    expect(callers[0].caller.symbolName).toBe('findOrder');
    expect(callers[0].callSiteLine).toBe(5);
    expect(callers[0].provenance).toBe('oop-method-import');
  });

  it('resolves same-namespace method call for PHP (step 3c)', () => {
    const methodChunk = createTestChunk({
      metadata: {
        file: 'app/Services/PaymentService.php',
        startLine: 1,
        endLine: 10,
        type: 'function',
        symbolName: 'charge',
        symbolType: 'method',
        language: 'php',
        exports: ['PaymentService'],
      },
    });

    const callerChunk = createTestChunk({
      content: 'function processOrder() { $this->paymentService->charge(); }',
      metadata: {
        file: 'app/Services/OrderService.php',
        startLine: 1,
        endLine: 10,
        type: 'function',
        symbolName: 'processOrder',
        language: 'php',
        callSites: [{ symbol: 'charge', line: 10 }],
      },
    });

    const graph = buildDependencyGraph([methodChunk, callerChunk]);
    const callers = graph.getCallers('app/Services/PaymentService.php', 'charge');

    expect(callers).toHaveLength(1);
    expect(callers[0].caller.filepath).toBe('app/Services/OrderService.php');
    expect(callers[0].caller.symbolName).toBe('processOrder');
    expect(callers[0].provenance).toBe('namespace-inferred');
  });

  it('does NOT apply same-namespace fallback for TypeScript (step 3c)', () => {
    const methodChunk = createTestChunk({
      metadata: {
        file: 'src/services/payment.ts',
        startLine: 1,
        endLine: 10,
        type: 'function',
        symbolName: 'charge',
        symbolType: 'method',
        language: 'typescript',
        exports: ['PaymentService'],
      },
    });

    const callerChunk = createTestChunk({
      content: 'function processOrder() { charge(); }',
      metadata: {
        file: 'src/services/order.ts',
        startLine: 1,
        endLine: 10,
        type: 'function',
        symbolName: 'processOrder',
        language: 'typescript',
        callSites: [{ symbol: 'charge', line: 10 }],
      },
    });

    const graph = buildDependencyGraph([methodChunk, callerChunk]);
    const callers = graph.getCallers('src/services/payment.ts', 'charge');

    // TypeScript requires explicit imports — no same-namespace fallback
    expect(callers).toHaveLength(0);
  });

  it('does NOT link when symbol is not imported from any package', () => {
    const definition = createTestChunk({
      metadata: {
        file: 'src/utils.ts',
        startLine: 1,
        endLine: 5,
        type: 'function',
        symbolName: 'helper',
        language: 'typescript',
        exports: ['helper'],
      },
    });

    const caller = createTestChunk({
      metadata: {
        file: 'src/other.ts',
        startLine: 1,
        endLine: 10,
        type: 'function',
        symbolName: 'doStuff',
        language: 'typescript',
        callSites: [{ symbol: 'helper', line: 5 }],
      },
    });

    const graph = buildDependencyGraph([definition, caller]);
    expect(graph.getCallers('src/utils.ts', 'helper')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getCallersTransitive
// ---------------------------------------------------------------------------

describe('getCallersTransitive', () => {
  /**
   * Two-level chain: seed <- bLevel1 <- cLevel2
   * `bLevel1` directly calls the seed; `cLevel2` calls `bLevel1`.
   */
  function buildTwoLevelChain() {
    const seed = createTestChunk({
      metadata: {
        file: 'src/seed.ts',
        startLine: 1,
        endLine: 5,
        type: 'function',
        symbolName: 'seed',
        language: 'typescript',
        exports: ['seed'],
      },
    });

    const bLevel1 = createTestChunk({
      metadata: {
        file: 'src/b.ts',
        startLine: 1,
        endLine: 10,
        type: 'function',
        symbolName: 'bLevel1',
        language: 'typescript',
        exports: ['bLevel1'],
        importedSymbols: { './seed': ['seed'] },
        callSites: [{ symbol: 'seed', line: 5 }],
      },
    });

    const cLevel2 = createTestChunk({
      metadata: {
        file: 'src/c.ts',
        startLine: 1,
        endLine: 10,
        type: 'function',
        symbolName: 'cLevel2',
        language: 'typescript',
        exports: ['cLevel2'],
        importedSymbols: { './b': ['bLevel1'] },
        callSites: [{ symbol: 'bLevel1', line: 5 }],
      },
    });

    return { seed, bLevel1, cLevel2 };
  }

  it('walks two hops outward and labels each caller with its shortest hop', () => {
    const { seed, bLevel1, cLevel2 } = buildTwoLevelChain();
    const graph = buildDependencyGraph([seed, bLevel1, cLevel2]);

    const result = graph.getCallersTransitive('src/seed.ts', 'seed', { depth: 2 });

    expect(result.callers).toHaveLength(2);
    const b = result.callers.find(e => e.caller.symbolName === 'bLevel1');
    const c = result.callers.find(e => e.caller.symbolName === 'cLevel2');
    expect(b?.hops).toBe(1);
    expect(b?.viaSymbol).toBe('seed');
    expect(c?.hops).toBe(2);
    expect(c?.viaSymbol).toBe('bLevel1');
    expect(result.truncated).toBe(false);
  });

  it('depth=1 matches the one-hop getCallers set', () => {
    const { seed, bLevel1, cLevel2 } = buildTwoLevelChain();
    const graph = buildDependencyGraph([seed, bLevel1, cLevel2]);

    const oneHop = graph.getCallers('src/seed.ts', 'seed');
    const transitive = graph.getCallersTransitive('src/seed.ts', 'seed', { depth: 1 });

    expect(transitive.callers).toHaveLength(oneHop.length);
    expect(transitive.callers.map(e => e.caller.symbolName).sort()).toEqual(
      oneHop.map(e => e.caller.symbolName).sort(),
    );
    expect(transitive.callers.every(e => e.hops === 1)).toBe(true);
  });

  it('terminates cleanly when a cycle is present', () => {
    // a <-> b mutual recursion at the symbol level
    const a = createTestChunk({
      metadata: {
        file: 'src/a.ts',
        startLine: 1,
        endLine: 10,
        type: 'function',
        symbolName: 'a',
        language: 'typescript',
        exports: ['a'],
        importedSymbols: { './b': ['b'] },
        callSites: [{ symbol: 'b', line: 5 }],
      },
    });
    const b = createTestChunk({
      metadata: {
        file: 'src/b.ts',
        startLine: 1,
        endLine: 10,
        type: 'function',
        symbolName: 'b',
        language: 'typescript',
        exports: ['b'],
        importedSymbols: { './a': ['a'] },
        callSites: [{ symbol: 'a', line: 5 }],
      },
    });
    const graph = buildDependencyGraph([a, b]);

    const result = graph.getCallersTransitive('src/a.ts', 'a', { depth: 5 });

    // Only b is emitted; the seed a must never appear as its own caller.
    expect(result.callers).toHaveLength(1);
    expect(result.callers[0].caller.symbolName).toBe('b');
    expect(result.callers[0].hops).toBe(1);
  });

  it('deduplicates callers that reach the seed via multiple paths', () => {
    // Diamond: a calls seed, a calls b, b calls seed. "a" has two paths to seed.
    const seed = createTestChunk({
      metadata: {
        file: 'src/seed.ts',
        startLine: 1,
        endLine: 5,
        type: 'function',
        symbolName: 'seed',
        language: 'typescript',
        exports: ['seed'],
      },
    });
    const b = createTestChunk({
      metadata: {
        file: 'src/b.ts',
        startLine: 1,
        endLine: 10,
        type: 'function',
        symbolName: 'b',
        language: 'typescript',
        exports: ['b'],
        importedSymbols: { './seed': ['seed'] },
        callSites: [{ symbol: 'seed', line: 5 }],
      },
    });
    const a = createTestChunk({
      metadata: {
        file: 'src/a.ts',
        startLine: 1,
        endLine: 10,
        type: 'function',
        symbolName: 'a',
        language: 'typescript',
        exports: ['a'],
        importedSymbols: { './seed': ['seed'], './b': ['b'] },
        callSites: [
          { symbol: 'seed', line: 5 },
          { symbol: 'b', line: 6 },
        ],
      },
    });

    const graph = buildDependencyGraph([seed, b, a]);
    const result = graph.getCallersTransitive('src/seed.ts', 'seed', { depth: 3 });

    // a and b are both callers. a must appear only once, at its shortest hop (1).
    const aEdges = result.callers.filter(e => e.caller.symbolName === 'a');
    expect(aEdges).toHaveLength(1);
    expect(aEdges[0].hops).toBe(1);
    expect(result.callers).toHaveLength(2);
  });

  it('truncates when maxNodes is exceeded', () => {
    const seed = createTestChunk({
      metadata: {
        file: 'src/seed.ts',
        startLine: 1,
        endLine: 5,
        type: 'function',
        symbolName: 'seed',
        language: 'typescript',
        exports: ['seed'],
      },
    });
    const callers = Array.from({ length: 5 }, (_, i) =>
      createTestChunk({
        metadata: {
          file: `src/caller${i}.ts`,
          startLine: 1,
          endLine: 10,
          type: 'function',
          symbolName: `caller${i}`,
          language: 'typescript',
          importedSymbols: { './seed': ['seed'] },
          callSites: [{ symbol: 'seed', line: 5 }],
        },
      }),
    );

    const graph = buildDependencyGraph([seed, ...callers]);
    const result = graph.getCallersTransitive('src/seed.ts', 'seed', {
      depth: 2,
      maxNodes: 2,
    });

    expect(result.callers).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it('returns an empty result for depth < 1 or maxNodes < 1', () => {
    const { seed, bLevel1 } = buildTwoLevelChain();
    const graph = buildDependencyGraph([seed, bLevel1]);

    const zeroDepth = graph.getCallersTransitive('src/seed.ts', 'seed', { depth: 0 });
    expect(zeroDepth.callers).toEqual([]);
    expect(zeroDepth.visitedSymbols).toBe(0);

    const zeroNodes = graph.getCallersTransitive('src/seed.ts', 'seed', { maxNodes: 0 });
    expect(zeroNodes.callers).toEqual([]);
  });

  it('returns an empty result for an unknown seed', () => {
    const graph = buildDependencyGraph([]);
    const result = graph.getCallersTransitive('nonexistent.ts', 'noSuchSymbol', { depth: 2 });
    expect(result.callers).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Import-only fallback (#994 Phase 5) — a class-shaped seed with real,
// verified dependents that never literally call it by name (e.g. a
// constructor-injected property, never `new PricingService()` or any other
// call site named `PricingService`). Mirrors the real PHP `PricingService`
// case measured in `pr1003-php-pricingservice-guard.blast-radius.ts`.
// ---------------------------------------------------------------------------

describe('buildDependencyGraph — import-only fallback', () => {
  it('recovers a dependent whose import is verified but no call site names the class', () => {
    const classChunk = createTestChunk({
      metadata: {
        file: 'app/Services/PricingService.php',
        startLine: 1,
        endLine: 50,
        type: 'class',
        symbolName: 'PricingService',
        symbolType: 'class',
        language: 'php',
        exports: ['PricingService'],
      },
    });

    // Constructor-injected property — genuinely depends on PricingService,
    // but only ever calls its METHODS, never a call site literally named
    // 'PricingService'.
    const callerChunk = createTestChunk({
      content:
        'function formatTotal($total) { return $this->pricingService->formatPrice($total); }',
      metadata: {
        file: 'app/Http/Controllers/ProductController.php',
        startLine: 1,
        endLine: 30,
        type: 'class',
        symbolName: 'ProductController',
        symbolType: 'class',
        language: 'php',
        exports: ['ProductController'],
        importedSymbols: { 'App\\Services\\PricingService': ['PricingService'] },
        callSites: [{ symbol: 'formatPrice', line: 10 }],
      },
    });

    const graph = buildDependencyGraph([classChunk, callerChunk]);
    const callers = graph.getCallers('app/Services/PricingService.php', 'PricingService');

    expect(callers).toHaveLength(1);
    expect(callers[0].caller.filepath).toBe('app/Http/Controllers/ProductController.php');
    expect(callers[0].caller.symbolName).toBe('ProductController');
    expect(callers[0].provenance).toBe('import-only');
  });

  it('does not fabricate an edge when no chunk in the file verifiably imports the class', () => {
    const classChunk = createTestChunk({
      metadata: {
        file: 'app/Services/PricingService.php',
        startLine: 1,
        endLine: 50,
        type: 'class',
        symbolName: 'PricingService',
        symbolType: 'class',
        language: 'php',
        exports: ['PricingService'],
      },
    });

    const unrelatedChunk = createTestChunk({
      metadata: {
        file: 'app/Http/Controllers/UnrelatedController.php',
        startLine: 1,
        endLine: 10,
        type: 'class',
        symbolName: 'UnrelatedController',
        symbolType: 'class',
        language: 'php',
        exports: ['UnrelatedController'],
      },
    });

    const graph = buildDependencyGraph([classChunk, unrelatedChunk]);
    expect(graph.getCallers('app/Services/PricingService.php', 'PricingService')).toHaveLength(0);
  });

  it('deduplicates to one edge per importing FILE, not one per chunk', () => {
    // importedSymbols is deliberately duplicated onto every chunk in a file
    // (see chunker.ts's own doc comment on createChunk) — a multi-method
    // class must still produce exactly one import-only dependent per file.
    const classChunk = createTestChunk({
      metadata: {
        file: 'app/Services/PricingService.php',
        startLine: 1,
        endLine: 50,
        type: 'class',
        symbolName: 'PricingService',
        symbolType: 'class',
        language: 'php',
        exports: ['PricingService'],
      },
    });

    const sharedImport = { 'App\\Services\\PricingService': ['PricingService'] };
    const callerClassChunk = createTestChunk({
      metadata: {
        file: 'app/Http/Controllers/ProductController.php',
        startLine: 1,
        endLine: 40,
        type: 'class',
        symbolName: 'ProductController',
        symbolType: 'class',
        language: 'php',
        exports: ['ProductController'],
        importedSymbols: sharedImport,
      },
    });
    const method1 = createTestChunk({
      content: 'function show() { return $this->pricingService->formatPrice(1); }',
      metadata: {
        file: 'app/Http/Controllers/ProductController.php',
        startLine: 10,
        endLine: 15,
        type: 'function',
        symbolName: 'show',
        symbolType: 'method',
        parentClass: 'ProductController',
        language: 'php',
        importedSymbols: sharedImport,
        callSites: [{ symbol: 'formatPrice', line: 12 }],
      },
    });
    const method2 = createTestChunk({
      content: 'function index() { return $this->pricingService->calculateOrderTotal([]); }',
      metadata: {
        file: 'app/Http/Controllers/ProductController.php',
        startLine: 20,
        endLine: 25,
        type: 'function',
        symbolName: 'index',
        symbolType: 'method',
        parentClass: 'ProductController',
        language: 'php',
        importedSymbols: sharedImport,
        callSites: [{ symbol: 'calculateOrderTotal', line: 22 }],
      },
    });

    const graph = buildDependencyGraph([classChunk, callerClassChunk, method1, method2]);
    const callers = graph.getCallers('app/Services/PricingService.php', 'PricingService');

    expect(callers).toHaveLength(1);
    expect(callers[0].caller.filepath).toBe('app/Http/Controllers/ProductController.php');
  });
});

// ---------------------------------------------------------------------------
// Require-only fallback (#1013) — Ruby's `require_relative` names a FILE,
// never a symbol, so `chunk.metadata.importedSymbols`'s GUESSED lowercase
// basename (e.g. './logger' -> 'logger') never matches the file's REAL
// declared export ('Logger', PascalCase by convention) -- neither the
// call-site tier nor the import-only fallback (both keyed on
// `importedSymbols`) can ever resolve it. This fallback matches
// `chunk.metadata.imports` (the SAME raw path, with no symbol guess
// attached) directly against the target file.
// ---------------------------------------------------------------------------

describe('buildDependencyGraph — require-only fallback (#1013)', () => {
  it('recovers a Ruby dependent via require_relative when importedSymbols carries a guessed name that never matches the real export', () => {
    const classChunk = createTestChunk({
      content: 'class Logger\nend',
      metadata: {
        file: 'lib/logger.rb',
        startLine: 1,
        endLine: 2,
        type: 'class',
        symbolName: 'Logger',
        symbolType: 'class',
        language: 'ruby',
        exports: ['Logger'],
      },
    });

    // `require_relative './logger'` -- imports carries the raw path;
    // importedSymbols carries the SAME path but keyed to the guessed
    // lowercase basename 'logger', which never matches the real export
    // 'Logger' in exportIndex. No call site names 'Logger' either (Ruby
    // rarely calls a logger class by its own name).
    const callerChunk = createTestChunk({
      content: "require_relative './logger'\nLogger.new.info('hi')",
      metadata: {
        file: 'lib/app.rb',
        startLine: 1,
        endLine: 2,
        type: 'class',
        symbolName: 'App',
        symbolType: 'class',
        language: 'ruby',
        exports: ['App'],
        imports: ['./logger'],
        importedSymbols: { './logger': ['logger'] },
      },
    });

    const graph = buildDependencyGraph([classChunk, callerChunk]);
    const callers = graph.getCallers('lib/logger.rb', 'Logger');

    expect(callers).toHaveLength(1);
    expect(callers[0].caller.filepath).toBe('lib/app.rb');
    expect(callers[0].caller.symbolName).toBe('App');
    expect(callers[0].provenance).toBe('require-only');
  });

  it('does not fabricate an edge when no file requires the target at all', () => {
    const classChunk = createTestChunk({
      metadata: {
        file: 'lib/logger.rb',
        startLine: 1,
        endLine: 2,
        type: 'class',
        symbolName: 'Logger',
        symbolType: 'class',
        language: 'ruby',
        exports: ['Logger'],
      },
    });
    const unrelatedChunk = createTestChunk({
      metadata: {
        file: 'lib/unrelated.rb',
        startLine: 1,
        endLine: 2,
        type: 'class',
        symbolName: 'Unrelated',
        symbolType: 'class',
        language: 'ruby',
        exports: ['Unrelated'],
      },
    });

    const graph = buildDependencyGraph([classChunk, unrelatedChunk]);
    expect(graph.getCallers('lib/logger.rb', 'Logger')).toHaveLength(0);
  });

  it('is a LAST resort: does not override a real call-site edge for the same key', () => {
    // Same shape as the recovery test above, but this time a real call site
    // DOES name the symbol directly -- the ordinary import-verified tier
    // must win, never the require-only fallback.
    const classChunk = createTestChunk({
      metadata: {
        file: 'lib/logger.rb',
        startLine: 1,
        endLine: 2,
        type: 'class',
        symbolName: 'Logger',
        symbolType: 'class',
        language: 'ruby',
        exports: ['Logger'],
      },
    });
    const callerChunk = createTestChunk({
      content: "require_relative './logger'\nLogger()",
      metadata: {
        file: 'lib/app.rb',
        startLine: 1,
        endLine: 2,
        type: 'class',
        symbolName: 'App',
        symbolType: 'class',
        language: 'ruby',
        exports: ['App'],
        imports: ['./logger'],
        importedSymbols: { './logger': ['Logger'] },
        callSites: [{ symbol: 'Logger', line: 2 }],
      },
    });

    const graph = buildDependencyGraph([classChunk, callerChunk]);
    const callers = graph.getCallers('lib/logger.rb', 'Logger');

    expect(callers).toHaveLength(1);
    expect(callers[0].provenance).toBe('import-verified');
  });

  it('continues a transitive walk through TWO require-only edges (cross-directory, so the same-directory namespace fallback cannot accidentally cover for it)', () => {
    // Each pair of files lives in a DIFFERENT directory specifically so
    // `addSameNamespaceEdges`'s same-directory fallback (tier 3c) cannot
    // accidentally resolve the edge instead -- the only path available at
    // either hop is the require-only fallback this test exists to prove.
    const loggerChunk = createTestChunk({
      metadata: {
        file: 'lib/logger.rb',
        startLine: 1,
        endLine: 2,
        type: 'class',
        symbolName: 'Logger',
        symbolType: 'class',
        language: 'ruby',
        exports: ['Logger'],
      },
    });
    const mainChunk = createTestChunk({
      content: "require_relative '../lib/logger'\nLogger.new.info('hi')",
      metadata: {
        file: 'app/main.rb',
        startLine: 1,
        endLine: 2,
        type: 'class',
        symbolName: 'Main',
        symbolType: 'class',
        language: 'ruby',
        exports: ['Main'],
        imports: ['../lib/logger'],
        importedSymbols: { '../lib/logger': ['logger'] },
      },
    });
    const consumerChunk = createTestChunk({
      content: "require_relative '../app/main'\nMain.new.run",
      metadata: {
        file: 'cli/run.rb',
        startLine: 1,
        endLine: 2,
        type: 'class',
        symbolName: 'Run',
        symbolType: 'class',
        language: 'ruby',
        exports: ['Run'],
        imports: ['../app/main'],
        importedSymbols: { '../app/main': ['main'] },
      },
    });

    const graph = buildDependencyGraph([loggerChunk, mainChunk, consumerChunk]);
    const transitive = graph.getCallersTransitive('lib/logger.rb', 'Logger', { depth: 2 });

    expect(transitive.truncated).toBe(false);
    const mainEdge = transitive.callers.find(c => c.caller.filepath === 'app/main.rb');
    expect(mainEdge?.provenance).toBe('require-only');
    expect(mainEdge?.hops).toBe(1);
    expect(mainEdge?.caller.symbolName).toBe('Main');

    // cli/run.rb requires app/main.rb (cross-directory, same broken-guess
    // shape) -- reachable only because hop 1's frontier correctly carries
    // 'Main' forward as the next node to query.
    const consumerEdge = transitive.callers.find(c => c.caller.filepath === 'cli/run.rb');
    expect(consumerEdge).toBeDefined();
    expect(consumerEdge?.hops).toBe(2);
    expect(consumerEdge?.provenance).toBe('require-only');
  });
});

// ---------------------------------------------------------------------------
// C# same-namespace gating fix (#994 Phase 5) — `addSameNamespaceEdges`'s
// crude same-directory heuristic must NOT apply to C#, which has a REAL
// namespace/enclosing-access model (`findCSharpTypeReferenceDependents`).
// The old denylist (`!['typescript','javascript'].includes(lang)`) let C#
// fall through to same-directory matching despite the comment naming only
// PHP/Python/Rust as the intended targets.
// ---------------------------------------------------------------------------

describe('buildDependencyGraph — C# namespace gating fix', () => {
  it('does NOT apply the same-directory fallback for C# (unlike PHP)', () => {
    const methodChunk = createTestChunk({
      metadata: {
        file: 'App/Services/PaymentService.cs',
        startLine: 1,
        endLine: 10,
        type: 'function',
        symbolName: 'Charge',
        symbolType: 'method',
        language: 'csharp',
        exports: ['PaymentService'],
      },
    });

    // Same directory as PaymentService.cs, calls a method with the same
    // name, but with NO verified import — the pre-Phase-5 behavior would
    // have matched this via the same-directory heuristic.
    const callerChunk = createTestChunk({
      content: 'void ProcessOrder() { paymentService.Charge(); }',
      metadata: {
        file: 'App/Services/OrderService.cs',
        startLine: 1,
        endLine: 10,
        type: 'function',
        symbolName: 'ProcessOrder',
        language: 'csharp',
        callSites: [{ symbol: 'Charge', line: 10 }],
      },
    });

    const graph = buildDependencyGraph([methodChunk, callerChunk]);
    const callers = graph.getCallers('App/Services/PaymentService.cs', 'Charge');

    expect(callers).toHaveLength(0);
  });

  it('recovers a C# dependent via the #930/#971 type-reference fallback instead', () => {
    // A globally-unique type name with NO import and NO call site at all —
    // only recoverable via findCSharpTypeReferenceDependents's word-boundary
    // text match (see that module's own test suite for its full behavior;
    // this test only checks that dependency-graph.ts wires it in correctly).
    const declChunk = createTestChunk({
      content: 'namespace App.Services;\n\npublic class PricingService { }',
      metadata: {
        file: 'App/Services/PricingService.cs',
        startLine: 1,
        endLine: 3,
        type: 'class',
        symbolName: 'PricingService',
        symbolType: 'class',
        language: 'csharp',
        exports: ['PricingService'],
      },
    });

    const usageChunk = createTestChunk({
      content: 'namespace App.Services;\n\nPricingService.Apply(order);',
      metadata: {
        file: 'App/Services/OrderService.cs',
        startLine: 1,
        endLine: 3,
        type: 'function',
        symbolName: 'Process',
        symbolType: 'method',
        language: 'csharp',
      },
    });

    const graph = buildDependencyGraph([declChunk, usageChunk]);
    const callers = graph.getCallers('App/Services/PricingService.cs', 'PricingService');

    expect(callers).toHaveLength(1);
    expect(callers[0].caller.filepath).toBe('App/Services/OrderService.cs');
    expect(callers[0].provenance).toBe('namespace-inferred');
  });
});

// ---------------------------------------------------------------------------
// Barrel transitive-walk regression (post-#1011) — a pure re-export barrel
// (no chunk of its own carries a real symbol name) used to dead-end
// `getCallersTransitive`: the frontier re-queried
// `getCallers(barrel, '(module-level)')`, a key nothing is ever indexed
// under, so every real consumer reachable only through the barrel silently
// vanished at hop 2. Fails on the pre-fix `dependency-graph.ts` (confirmed:
// reverting the `frontierSymbol` plumbing reproduces a truncated 1-caller
// walk that never reaches `consumerChunk`).
// ---------------------------------------------------------------------------

describe('buildDependencyGraph — barrel transitive-walk regression (post-#1011)', () => {
  it('reaches a real consumer through a pure re-export barrel via getCallersTransitive', () => {
    const implChunk = createTestChunk({
      metadata: {
        file: 'src/impl.ts',
        startLine: 1,
        endLine: 5,
        type: 'function',
        symbolName: 'doWork',
        symbolType: 'function',
        language: 'typescript',
        exports: ['doWork'],
      },
    });

    // A pure re-export barrel: no chunk of its own carries a real symbol
    // name, so `pickRepresentativeChunk` returns undefined and the caller
    // identity is the `NO_REPRESENTATIVE_SYMBOL` sentinel — exactly the
    // shape that dead-ended the BFS pre-fix.
    const barrelChunk = createTestChunk({
      content: "export { doWork } from './impl.js';",
      metadata: {
        file: 'src/index.ts',
        startLine: 1,
        endLine: 1,
        type: 'block',
        symbolName: undefined,
        symbolType: undefined,
        language: 'typescript',
        exports: ['doWork'],
        importedSymbols: { './impl.js': ['doWork'] },
      },
    });

    const consumerChunk = createTestChunk({
      content: "import { doWork } from './index.js';\nfunction run() { doWork(); }",
      metadata: {
        file: 'src/consumer.ts',
        startLine: 1,
        endLine: 5,
        type: 'function',
        symbolName: 'run',
        symbolType: 'function',
        language: 'typescript',
        exports: ['run'],
        importedSymbols: { './index.js': ['doWork'] },
        callSites: [{ symbol: 'doWork', line: 2 }],
      },
    });

    const graph = buildDependencyGraph([implChunk, barrelChunk, consumerChunk]);

    // Direct getCallers on the impl file: only the barrel's import-only
    // pass-through edge (no one calls impl.ts's doWork directly).
    const direct = graph.getCallers('src/impl.ts', 'doWork');
    expect(direct).toHaveLength(1);
    expect(direct[0].caller.filepath).toBe('src/index.ts');
    expect(direct[0].caller.symbolName).toBe('(module-level)');
    expect(direct[0].provenance).toBe('import-only');

    // The transitive walk must continue THROUGH the barrel and reach the
    // real consumer at hop 2 — this is exactly what #1011 broke: the BFS
    // frontier re-queried getCallers(barrel, '(module-level)'), a key
    // nothing is indexed under, and dead-ended instead of continuing via
    // 'doWork'.
    const transitive = graph.getCallersTransitive('src/impl.ts', 'doWork', { depth: 2 });
    expect(transitive.truncated).toBe(false);
    const consumerEdge = transitive.callers.find(c => c.caller.filepath === 'src/consumer.ts');
    expect(consumerEdge).toBeDefined();
    expect(consumerEdge?.hops).toBe(2);
    expect(consumerEdge?.caller.symbolName).toBe('run');
    expect(consumerEdge?.provenance).toBe('import-verified');

    // The barrel itself must NOT be credited as if it calls doWork — its
    // display identity stays the honest '(module-level)' placeholder (the
    // false-attribution shape #1011 removed must not come back).
    const barrelEdge = transitive.callers.find(c => c.caller.filepath === 'src/index.ts');
    expect(barrelEdge?.caller.symbolName).toBe('(module-level)');
  });

  it('does not infinite-loop when a consumer is reached through a chain of two barrels (cycle-adjacent guard)', () => {
    const implChunk = createTestChunk({
      metadata: {
        file: 'src/real.ts',
        startLine: 1,
        endLine: 5,
        type: 'function',
        symbolName: 'compute',
        symbolType: 'function',
        language: 'typescript',
        exports: ['compute'],
      },
    });

    const barrelBChunk = createTestChunk({
      content: "export { compute } from './real.js';",
      metadata: {
        file: 'src/barrel-b.ts',
        startLine: 1,
        endLine: 1,
        type: 'block',
        symbolName: undefined,
        symbolType: undefined,
        language: 'typescript',
        exports: ['compute'],
        importedSymbols: { './real.js': ['compute'] },
      },
    });

    const barrelAChunk = createTestChunk({
      content: "export { compute } from './barrel-b.js';",
      metadata: {
        file: 'src/barrel-a.ts',
        startLine: 1,
        endLine: 1,
        type: 'block',
        symbolName: undefined,
        symbolType: undefined,
        language: 'typescript',
        exports: ['compute'],
        importedSymbols: { './barrel-b.js': ['compute'] },
      },
    });

    const consumerChunk = createTestChunk({
      content: "import { compute } from './barrel-a.js';\nfunction run() { compute(); }",
      metadata: {
        file: 'src/consumer.ts',
        startLine: 1,
        endLine: 5,
        type: 'function',
        symbolName: 'run',
        symbolType: 'function',
        language: 'typescript',
        exports: ['run'],
        importedSymbols: { './barrel-a.js': ['compute'] },
        callSites: [{ symbol: 'compute', line: 2 }],
      },
    });

    const graph = buildDependencyGraph([implChunk, barrelBChunk, barrelAChunk, consumerChunk]);
    const transitive = graph.getCallersTransitive('src/real.ts', 'compute', {
      depth: 3,
      maxNodes: 30,
    });

    expect(transitive.truncated).toBe(false);
    const consumerEdge = transitive.callers.find(c => c.caller.filepath === 'src/consumer.ts');
    expect(consumerEdge).toBeDefined();
    expect(consumerEdge?.hops).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// JVM same-package call-graph tier (#1005 Phase 2, Item 1) — the type-scoped
// twin of Phase 1's file-level `findDependents` recovery (#1100), unioned
// into `getCallers`'s result rather than tried as another early-return
// branch in `resolveBaseTier`'s chain. See `unionJvmSamePackageTier`'s doc
// comment in dependency-graph.ts for the full reasoning; the tests below are
// the acceptance criteria from the design review that preceded this tier.
// ---------------------------------------------------------------------------

describe('buildDependencyGraph — JVM same-package call-graph tier (#1005 Phase 2)', () => {
  it('AC1 per-type scoping: a same-package referrer that only textually references ONE of two sibling top-level types is not misattributed to the other', () => {
    const fooChunk = createTestChunk({
      content: 'package a.b\n\nclass Foo { }',
      metadata: {
        file: 'src/main/kotlin/a/b/FooBar.kt',
        startLine: 1,
        endLine: 3,
        type: 'class',
        symbolName: 'Foo',
        symbolType: 'class',
        language: 'kotlin',
        exports: ['Foo'],
      },
    });
    const barChunk = createTestChunk({
      content: 'package a.b\n\nclass Bar { }',
      metadata: {
        file: 'src/main/kotlin/a/b/FooBar.kt',
        startLine: 5,
        endLine: 7,
        type: 'class',
        symbolName: 'Bar',
        symbolType: 'class',
        language: 'kotlin',
        exports: ['Bar'],
      },
    });
    // References ONLY Foo, textually — no import, no call site.
    const referrerChunk = createTestChunk({
      content: 'package a.b\n\nfun run() { Foo().doSomething() }',
      metadata: {
        file: 'src/main/kotlin/a/b/Ref.kt',
        startLine: 1,
        endLine: 3,
        type: 'function',
        symbolName: 'run',
        symbolType: 'function',
        language: 'kotlin',
      },
    });

    const graph = buildDependencyGraph([fooChunk, barChunk, referrerChunk]);

    const barCallers = graph.getCallers('src/main/kotlin/a/b/FooBar.kt', 'Bar');
    expect(
      barCallers.find(c => c.caller.filepath === 'src/main/kotlin/a/b/Ref.kt'),
    ).toBeUndefined();

    const fooCallers = graph.getCallers('src/main/kotlin/a/b/FooBar.kt', 'Foo');
    const fooRef = fooCallers.find(c => c.caller.filepath === 'src/main/kotlin/a/b/Ref.kt');
    expect(fooRef).toBeDefined();
    expect(fooRef?.provenance).toBe('namespace-inferred');
  });

  it("AC2 provenance pinned: the NEW tier tags its own contribution namespace-inferred, distinct from a blanket check over a result that also carries the pre-existing directory heuristic's namespace-inferred edge", () => {
    const targetChunk = createTestChunk({
      content: 'package a.b;\n\npublic class Target { }',
      metadata: {
        file: 'src/main/java/a/b/Target.java',
        startLine: 1,
        endLine: 3,
        type: 'class',
        symbolName: 'Target',
        symbolType: 'class',
        language: 'java',
        exports: ['Target'],
      },
    });
    // Resolves via the PRE-EXISTING `addSameNamespaceEdges` directory
    // heuristic: same directory as Target, a real call site literally
    // naming 'Target', no import.
    const dirCallerChunk = createTestChunk({
      content: 'package a.b;\n\nclass DirCaller { void run() { new Target(); } }',
      metadata: {
        file: 'src/main/java/a/b/DirCaller.java',
        startLine: 1,
        endLine: 3,
        type: 'class',
        symbolName: 'DirCaller',
        symbolType: 'class',
        language: 'java',
        callSites: [{ symbol: 'Target', line: 3 }],
      },
    });
    // Resolvable ONLY via the NEW per-type tier: same PACKAGE (content-derived),
    // a DIFFERENT directory (so the directory heuristic can't explain it), no
    // import, no call site (so no import-based tier can explain it either).
    const pkgCallerChunk = createTestChunk({
      content: 'package a.b;\n\nclass PkgCaller { private Target target; }',
      metadata: {
        file: 'src/main/java/a/other/PkgCaller.java',
        startLine: 1,
        endLine: 3,
        type: 'class',
        symbolName: 'PkgCaller',
        symbolType: 'class',
        language: 'java',
      },
    });

    const graph = buildDependencyGraph([targetChunk, dirCallerChunk, pkgCallerChunk]);
    const callers = graph.getCallers('src/main/java/a/b/Target.java', 'Target');

    expect(callers).toHaveLength(2);

    const dirEdge = callers.find(c => c.caller.filepath === 'src/main/java/a/b/DirCaller.java');
    expect(dirEdge?.provenance).toBe('namespace-inferred'); // the OLD heuristic's contribution

    // The assertion that actually matters: the NEW tier's OWN edge, isolated
    // from the pre-existing heuristic's edge above (which also happens to be
    // 'namespace-inferred' — a blanket "every edge is namespace-inferred"
    // check would pass even if the new tier tagged its edge wrong, as long
    // as it tagged it SOMETHING that happened to coincide; this checks the
    // specific edge that can only have come from the new tier).
    const pkgEdge = callers.find(c => c.caller.filepath === 'src/main/java/a/other/PkgCaller.java');
    expect(pkgEdge).toBeDefined();
    expect(pkgEdge?.provenance).toBe('namespace-inferred');
    expect(isImportOnlyEvidenceTier(pkgEdge!.provenance)).toBe(false);
  });

  it('AC3 no method/function-seed regression: a same-directory call site to a plain METHOD (not a type reference) still resolves via the retained directory heuristic, unchanged — the new tier structurally cannot touch it (G5)', () => {
    const methodChunk = createTestChunk({
      content: 'package app.services;\n\nclass PaymentService { void charge() { } }',
      metadata: {
        file: 'app/services/PaymentService.java',
        startLine: 1,
        endLine: 10,
        type: 'function',
        symbolName: 'charge',
        symbolType: 'method',
        language: 'java',
        exports: ['PaymentService'],
      },
    });

    const callerChunk = createTestChunk({
      content: 'package app.services;\n\nclass OrderService { void processOrder() { charge(); } }',
      metadata: {
        file: 'app/services/OrderService.java',
        startLine: 1,
        endLine: 10,
        type: 'function',
        symbolName: 'processOrder',
        symbolType: 'method',
        language: 'java',
        callSites: [{ symbol: 'charge', line: 10 }],
      },
    });

    const graph = buildDependencyGraph([methodChunk, callerChunk]);
    const callers = graph.getCallers('app/services/PaymentService.java', 'charge');

    // Exactly what `resolveBaseTier`'s `addSameNamespaceEdges` produced
    // before this tier existed — no additional edge from the new tier,
    // because 'charge' is a method, never one of PaymentService.java's
    // declared top-level class/interface names.
    expect(callers).toHaveLength(1);
    expect(callers[0].caller.filepath).toBe('app/services/OrderService.java');
    expect(callers[0].caller.symbolName).toBe('processOrder');
    expect(callers[0].provenance).toBe('namespace-inferred');
  });

  it('AC4 the import-only union point: getCallers unions the new tier even when resolveBaseTier resolved via the import-only fallback specifically (not just the empty-base or direct-edge cases)', () => {
    // Zero call sites anywhere name 'Target' — every dependent below is
    // recovered through a non-call-site path.
    const targetChunk = createTestChunk({
      content: 'package a.b;\n\npublic class Target { }',
      metadata: {
        file: 'src/main/java/a/b/Target.java',
        startLine: 1,
        endLine: 3,
        type: 'class',
        symbolName: 'Target',
        symbolType: 'class',
        language: 'java',
        exports: ['Target'],
      },
    });
    // Same package, NO import, references Target only via a field
    // declaration (never a call site) -- resolvable ONLY by the new tier.
    const samePackageCaller = createTestChunk({
      content: 'package a.b;\n\nclass SamePackageCaller { private Target target; }',
      metadata: {
        file: 'src/main/java/a/b/SamePackageCaller.java',
        startLine: 1,
        endLine: 3,
        type: 'class',
        symbolName: 'SamePackageCaller',
        symbolType: 'class',
        language: 'java',
      },
    });
    // Different package, a VERIFIED import (already resolved to a slash
    // path — the shape jvm-source-root.ts's #1046 resolution produces, see
    // path-matching.test.ts's "#1046 Java/Kotlin dotted-FQN specifiers"),
    // referenced only via a field declaration, never a call site -- resolves
    // via resolveBaseTier's IMPORT-ONLY fallback specifically.
    const importVerifiedCaller = createTestChunk({
      content:
        'package x.y;\n\nimport a.b.Target;\n\nclass ImportVerifiedCaller { private Target target; }',
      metadata: {
        file: 'src/main/java/x/y/ImportVerifiedCaller.java',
        startLine: 1,
        endLine: 3,
        type: 'class',
        symbolName: 'ImportVerifiedCaller',
        symbolType: 'class',
        language: 'java',
        importedSymbols: { 'src/main/java/a/b/Target': ['Target'] },
      },
    });

    const graph = buildDependencyGraph([targetChunk, samePackageCaller, importVerifiedCaller]);
    const callers = graph.getCallers('src/main/java/a/b/Target.java', 'Target');

    // Confirms the fixture actually exercises resolveBaseTier's import-only
    // branch (not e.g. a direct call-site edge) -- otherwise this test
    // wouldn't discriminate the import-only union point from the trivial
    // empty-base case AC1-AC3 already cover. Reverting the single union
    // point in `getCallers` back to "only union after direct edges" (an
    // earlier, rejected multi-union-point draft) makes THIS assertion fail
    // while AC1/AC2/AC3 above would still pass unchanged.
    const importOnlyEdge = callers.find(
      c => c.caller.filepath === 'src/main/java/x/y/ImportVerifiedCaller.java',
    );
    expect(importOnlyEdge?.provenance).toBe('import-only');

    const samePackageEdge = callers.find(
      c => c.caller.filepath === 'src/main/java/a/b/SamePackageCaller.java',
    );
    expect(samePackageEdge?.provenance).toBe('namespace-inferred');

    expect(callers).toHaveLength(2);
  });

  it('AC5 union predicate correctness: two real call sites in one already-resolved caller file are preserved unchanged, and the new tier does not add a duplicate entry for that same file', () => {
    const targetChunk = createTestChunk({
      content: 'package a.b;\n\npublic class Target { }',
      metadata: {
        file: 'src/main/java/a/b/Target.java',
        startLine: 1,
        endLine: 3,
        type: 'class',
        symbolName: 'Target',
        symbolType: 'class',
        language: 'java',
        exports: ['Target'],
      },
    });
    // Two DISTINCT call sites in the SAME file, both resolving via the
    // pre-existing directory heuristic (same directory, no import) -- this
    // is what a real multi-method caller class looks like in `base`.
    const callerMethodOne = createTestChunk({
      content: 'package a.b;\n\nclass Caller { void methodOne() { Target.doSomething(); } }',
      metadata: {
        file: 'src/main/java/a/b/Caller.java',
        startLine: 1,
        endLine: 3,
        type: 'function',
        symbolName: 'methodOne',
        symbolType: 'method',
        language: 'java',
        callSites: [{ symbol: 'Target', line: 3 }],
      },
    });
    const callerMethodTwo = createTestChunk({
      content: 'package a.b;\n\nclass Caller { void methodTwo() { Target.doSomethingElse(); } }',
      metadata: {
        file: 'src/main/java/a/b/Caller.java',
        startLine: 5,
        endLine: 7,
        type: 'function',
        symbolName: 'methodTwo',
        symbolType: 'method',
        language: 'java',
        callSites: [{ symbol: 'Target', line: 7 }],
      },
    });

    const graph = buildDependencyGraph([targetChunk, callerMethodOne, callerMethodTwo]);
    const callers = graph.getCallers('src/main/java/a/b/Target.java', 'Target');

    // Caller.java is ALSO a valid same-package referrer for the new tier
    // (same package, textually references 'Target') -- so `jvmExtra` WOULD
    // resolve it too, if the filter in `unionJvmSamePackageTier` were
    // missing or wrong. The assertion below is deliberately NOT "no
    // duplicate filepaths" (two real call sites legitimately sharing one
    // filepath is normal and expected, both before and after this change) —
    // it specifically checks that `base`'s two ORIGINAL entries (their real
    // symbolNames and call-site lines) survive untouched, and that no THIRD,
    // jvmExtra-shaped entry (which would carry a different, representative-
    // chunk symbolName/line — see `buildRepresentativeEdge`) was added.
    expect(callers).toHaveLength(2);
    expect(callers.every(c => c.caller.filepath === 'src/main/java/a/b/Caller.java')).toBe(true);
    expect(callers.map(c => c.caller.symbolName).sort()).toEqual(['methodOne', 'methodTwo']);
    expect(callers.map(c => c.callSiteLine).sort((a, b) => a - b)).toEqual([3, 7]);
    expect(callers.every(c => c.provenance === 'namespace-inferred')).toBe(true);
  });

  it('AC6 the inverted-gate divergence is intentional: findDependents (symbol-level) and getCallers legitimately disagree for the identical declared-type symbol', () => {
    const targetChunk = createTestChunk({
      content: 'package a.b;\n\npublic class Target { }',
      metadata: {
        file: 'src/main/java/a/b/Target.java',
        startLine: 1,
        endLine: 3,
        type: 'class',
        symbolName: 'Target',
        symbolType: 'class',
        language: 'java',
        exports: ['Target'],
      },
    });
    // A REAL import-verified caller with a real call site.
    const importCaller = createTestChunk({
      content:
        'package x.y;\n\nimport a.b.Target;\n\nclass ImportCaller { void run() { Target.doSomething(); } }',
      metadata: {
        file: 'src/main/java/x/y/ImportCaller.java',
        startLine: 1,
        endLine: 3,
        type: 'class',
        symbolName: 'ImportCaller',
        symbolType: 'class',
        language: 'java',
        importedSymbols: { 'src/main/java/a/b/Target': ['Target'] },
        callSites: [{ symbol: 'Target', line: 3 }],
      },
    });
    // A same-package caller with NO import, textual reference only.
    const samePkgCaller = createTestChunk({
      content: 'package a.b;\n\nclass SamePkgCaller { private Target target; }',
      metadata: {
        file: 'src/main/java/a/b/SamePkgCaller.java',
        startLine: 1,
        endLine: 3,
        type: 'class',
        symbolName: 'SamePkgCaller',
        symbolType: 'class',
        language: 'java',
      },
    });

    const chunks = [targetChunk, importCaller, samePkgCaller];
    const graph = buildDependencyGraph(chunks);

    // getCallers (this PR's new tier) finds BOTH: the import-verified caller
    // via the ordinary chain, AND the same-package caller via the new tier
    // (fires unconditionally for a JVM type-symbol query, regardless of
    // whether the base tier already found something).
    const callers = graph.getCallers('src/main/java/a/b/Target.java', 'Target');
    expect(callers.map(c => c.caller.filepath).sort()).toEqual([
      'src/main/java/a/b/SamePkgCaller.java',
      'src/main/java/x/y/ImportCaller.java',
    ]);

    // findDependents (Phase 1's file-level JVM recovery, `dependency-analyzer.ts`)
    // finds ONLY the import-verified caller here — its JVM same-package
    // recovery (`enrichWithJvmSamePackageDependents`) is gated to fire ONLY
    // when `symbol` is undefined AND the import graph found LITERALLY ZERO
    // dependents; neither holds here (a `symbol` was passed, AND the import
    // graph already found `importCaller`), so it never runs and
    // `samePkgCaller` is never recovered at the findDependents layer.
    //
    // This is a DELIBERATE, disclosed divergence, not a bug: the two
    // mechanisms' firing conditions are exact inverses of each other by
    // design (findDependents' recovery only fires on a zero-result miss;
    // getCallers' new tier fires unconditionally for any JVM type symbol) —
    // see dependency-analyzer.ts's `enrichWithJvmSamePackageDependents` doc
    // comment and the "What does NOT change" section of #1005 Phase 2's
    // design. A future reader must not "fix" this as an inconsistency.
    const result = findDependents(
      chunks,
      'src/main/java/a/b/Target.java',
      () => {
        // Intentionally empty -- no log assertions in this test.
      },
      '',
      'Target',
    );
    expect(result.dependents.map(d => d.filepath)).toEqual(['src/main/java/x/y/ImportCaller.java']);
  });
});

describe('buildDependencyGraph — JVM same-package index built once per build (#1005 Phase 2 §5-f)', () => {
  it('invokes buildJvmSamePackageIndex at most once across many distinct getCallers queries within one buildDependencyGraph call', () => {
    const spy = vi.spyOn(jvmSignals, 'buildJvmSamePackageIndex');
    spy.mockClear();

    const chunks: CodeChunk[] = ['One', 'Two', 'Three'].map(name =>
      createTestChunk({
        content: `package a.b;\n\npublic class ${name} { }`,
        metadata: {
          file: `src/main/java/a/b/${name}.java`,
          startLine: 1,
          endLine: 3,
          type: 'class',
          symbolName: name,
          symbolType: 'class',
          language: 'java',
          exports: [name],
        },
      }),
    );

    const graph = buildDependencyGraph(chunks);

    // Never queried before this point -- the index must be built lazily on
    // the FIRST of these, not eagerly inside buildDependencyGraph itself.
    expect(spy).not.toHaveBeenCalled();

    graph.getCallers('src/main/java/a/b/One.java', 'One');
    graph.getCallers('src/main/java/a/b/Two.java', 'Two');
    graph.getCallers('src/main/java/a/b/Three.java', 'Three');
    graph.getCallers('src/main/java/a/b/One.java', 'One'); // repeat query

    // Built once, then REUSED for every subsequent query in this same
    // buildDependencyGraph call -- never rebuilt per filepath, per call, or
    // even on a repeat query for the same filepath. Mirrors #1101's
    // RecoveryIndexes discipline for findDependents.
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  it('never builds the JVM index at all for a non-JVM query, even across a build that also contains JVM chunks', () => {
    const spy = vi.spyOn(jvmSignals, 'buildJvmSamePackageIndex');
    spy.mockClear();

    const jvmChunk = createTestChunk({
      content: 'package a.b;\n\npublic class Target { }',
      metadata: {
        file: 'src/main/java/a/b/Target.java',
        startLine: 1,
        endLine: 3,
        type: 'class',
        symbolName: 'Target',
        symbolType: 'class',
        language: 'java',
        exports: ['Target'],
      },
    });
    const tsChunk = createTestChunk({
      metadata: {
        file: 'src/utils/validate.ts',
        startLine: 1,
        endLine: 5,
        type: 'function',
        symbolName: 'validateEmail',
        symbolType: 'function',
        language: 'typescript',
        exports: ['validateEmail'],
      },
    });

    const graph = buildDependencyGraph([jvmChunk, tsChunk]);
    graph.getCallers('src/utils/validate.ts', 'validateEmail');

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// isPreciseProvenance — the "verified vs. inferred" boundary consumed by
// blast-radius-render.ts's Confidence column. `import-only` is precise: the
// import IS verified for this exact symbol (see resolveOneChunkImports), it
// just lacks a literal call site. `require-only` stays imprecise despite
// also being a guarded, resolved import: it only confirms a FILE-level
// relationship, never that this specific symbol is the one depended on.
// ---------------------------------------------------------------------------
describe('isPreciseProvenance', () => {
  it.each<[EdgeProvenance, boolean]>([
    ['same-file', true],
    ['import-verified', true],
    ['import-only', true],
    ['require-only', false],
    ['symbol-name-match', false],
    ['oop-method-import', false],
    ['namespace-inferred', false],
  ])('%s -> %s', (provenance, expected) => {
    expect(isPreciseProvenance(provenance)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Subset property (#1015 fix direction 2) — the safety guarantee
// `get-dependents.ts`'s `importedBy` evidence field relies on: every file the
// graph can name as a caller via a SAFE tier (`isImportOnlyEvidenceTier`,
// exported above next to `isPreciseProvenance` so this test and the CLI
// handler share ONE definition -- a test-local mirror couldn't detect the
// predicate it's checking drifting out from under it) is already present in
// `findDependents`'s own `dependents` list. Both mechanisms ultimately
// verify an import specifier against the SAME guarded `importMatchesTarget`
// primitive, but the graph additionally requires the resolved file to
// appear in its own `exportIndex` under the exact symbol name -- a strictly
// narrower (never wider) condition than `findDependents`'s
// `fileImportsSymbolFromAny`. That asymmetry is what makes the graph's
// precise-tier output always a SUBSET, never a superset: this test proves
// it end-to-end instead of just asserting it. (The CLI handler additionally
// enforces the subset by construction -- an explicit intersection against
// `analysis.dependents`, not just this shared predicate -- see
// `computeImportOnlyEvidence` in `get-dependents.ts`.)
// ---------------------------------------------------------------------------
describe('buildDependencyGraph <-> findDependents subset property (#1015 fix direction 2)', () => {
  // Alias kept local to this describe block purely for brevity at call
  // sites below; same function, no re-implementation.
  const isSafeEvidenceTier = isImportOnlyEvidenceTier;

  function noopLog(): void {
    // Intentionally empty.
  }

  // NOTE: within `resolveBaseTier` (the pre-#1005 chain), `getCallers`
  // returns the FIRST non-empty tier for a given `file::symbol` key
  // (`callerEdges` -- which is where `import-verified` AND
  // `symbol-name-match` both land, since both are written during the same
  // build pass -- then `importOnlyEdges`, then the C# fallback, then
  // require-only, last). That means `import-only` and a real call-site edge
  // for the identical key can never BOTH appear in one `resolveBaseTier`
  // result (`buildImportOnlyEdges` explicitly skips any key already covered
  // by a real edge -- see its own doc comment), and likewise `require-only`
  // never appears when a stronger tier already resolved the same key. Each
  // tier is therefore exercised in its OWN minimal fixture below rather than
  // one combined scenario -- forcing two BASE tiers into a single
  // `getCallers` call would just prove which one wins the priority order,
  // not the subset property this describe block exists to check.
  //
  // #1005 Phase 2 makes this UNION -- not "first non-empty wins" -- true one
  // level up: `getCallers` itself unions `resolveBaseTier`'s result with the
  // JVM same-package tier (`resolveJvmSamePackageTier`), so a `namespace-inferred`
  // JVM edge and an `import-verified` base edge for the SAME key legitimately
  // can both appear in one `getCallers` result now -- see the
  // "buildDependencyGraph — JVM same-package call-graph tier (#1005 Phase 2)"
  // describe block below for that behavior, which is intentional, not a bug.

  it('import-only: the recovered caller file is already present in dependents (PHP PricingService shape)', () => {
    const classChunk = createTestChunk({
      metadata: {
        file: 'app/Services/PricingService.php',
        startLine: 1,
        endLine: 50,
        type: 'class',
        symbolName: 'PricingService',
        symbolType: 'class',
        language: 'php',
        exports: ['PricingService'],
      },
    });

    // import-only: constructor-injected property, never calls a site
    // literally named 'PricingService'.
    const importOnlyCaller = createTestChunk({
      content:
        'function formatTotal($total) { return $this->pricingService->formatPrice($total); }',
      metadata: {
        file: 'app/Http/Controllers/ProductController.php',
        startLine: 1,
        endLine: 30,
        type: 'class',
        symbolName: 'ProductController',
        symbolType: 'class',
        language: 'php',
        exports: ['ProductController'],
        importedSymbols: { 'App\\Services\\PricingService': ['PricingService'] },
        callSites: [{ symbol: 'formatPrice', line: 10 }],
      },
    });

    const chunks: CodeChunk[] = [classChunk, importOnlyCaller];

    const graph = buildDependencyGraph(chunks);
    const rawCallers = graph.getCallers('app/Services/PricingService.php', 'PricingService');
    expect(rawCallers.map(c => c.provenance)).toEqual(['import-only']);

    const graphFiles = rawCallers
      .filter(edge => isSafeEvidenceTier(edge.provenance))
      .map(edge => edge.caller.filepath);
    expect(graphFiles).toEqual(['app/Http/Controllers/ProductController.php']);

    const result = findDependents(
      chunks,
      'app/Services/PricingService.php',
      noopLog,
      '',
      'PricingService',
    );
    const dependentFiles = new Set(result.dependents.map(d => d.filepath));
    for (const file of graphFiles) {
      expect(dependentFiles.has(file)).toBe(true);
    }
  });

  it('import-verified: the recovered caller file is already present in dependents', () => {
    const classChunk = createTestChunk({
      metadata: {
        file: 'app/Services/PricingService.php',
        startLine: 1,
        endLine: 50,
        type: 'class',
        symbolName: 'PricingService',
        symbolType: 'class',
        language: 'php',
        exports: ['PricingService'],
      },
    });

    // import-verified: a real call site names the class directly (`new
    // PricingService(...)`, tracked as a callSite on the constructing chunk).
    const importVerifiedCaller = createTestChunk({
      content: 'function make() { return new PricingService(); }',
      metadata: {
        file: 'app/Factories/PricingServiceFactory.php',
        startLine: 1,
        endLine: 10,
        type: 'class',
        symbolName: 'PricingServiceFactory',
        symbolType: 'class',
        language: 'php',
        exports: ['PricingServiceFactory'],
        importedSymbols: { 'App\\Services\\PricingService': ['PricingService'] },
        callSites: [{ symbol: 'PricingService', line: 2 }],
      },
    });

    const chunks: CodeChunk[] = [classChunk, importVerifiedCaller];

    const graph = buildDependencyGraph(chunks);
    const rawCallers = graph.getCallers('app/Services/PricingService.php', 'PricingService');
    expect(rawCallers.map(c => c.provenance)).toEqual(['import-verified']);

    const graphFiles = rawCallers
      .filter(edge => isSafeEvidenceTier(edge.provenance))
      .map(edge => edge.caller.filepath);
    expect(graphFiles).toEqual(['app/Factories/PricingServiceFactory.php']);

    const result = findDependents(
      chunks,
      'app/Services/PricingService.php',
      noopLog,
      '',
      'PricingService',
    );
    const dependentFiles = new Set(result.dependents.map(d => d.filepath));
    for (const file of graphFiles) {
      expect(dependentFiles.has(file)).toBe(true);
    }
  });

  it('excludes a require-only edge, even when it is the ONLY thing the graph found for the seed', () => {
    const classChunk = createTestChunk({
      metadata: {
        file: 'src/models/order.rb',
        startLine: 1,
        endLine: 20,
        type: 'class',
        symbolName: 'Order',
        symbolType: 'class',
        language: 'ruby',
        exports: ['Order'],
      },
    });

    // require-only: names the FILE, never the symbol (Ruby's require_relative).
    const requireOnlyCaller = createTestChunk({
      content: 'class Checkout; end',
      metadata: {
        file: 'src/checkout.rb',
        startLine: 1,
        endLine: 10,
        type: 'class',
        symbolName: 'Checkout',
        language: 'ruby',
        exports: ['Checkout'],
        imports: ['./models/order'],
        // Ruby's real extractor guesses a lowercase symbol name from the
        // require path (see dependency-graph.ts's require-only module doc);
        // that guess never matches the real export 'Order'.
        importedSymbols: { './models/order': ['order'] },
      },
    });

    const graph = buildDependencyGraph([classChunk, requireOnlyCaller]);
    const rawCallers = graph.getCallers('src/models/order.rb', 'Order');

    // Confirms the fixture actually produced the tier this test exists to
    // exclude -- otherwise the assertion below would pass vacuously.
    expect(rawCallers.map(c => c.provenance)).toEqual(['require-only']);

    const graphFiles = rawCallers
      .filter(edge => isSafeEvidenceTier(edge.provenance))
      .map(edge => edge.caller.filepath);
    expect(graphFiles).toEqual([]);
  });

  it('excludes a symbol-name-match edge, even when it is the ONLY thing the graph found for the seed', () => {
    const classChunk = createTestChunk({
      metadata: {
        file: 'src/models/order.rb',
        startLine: 1,
        endLine: 20,
        type: 'class',
        symbolName: 'Order',
        symbolType: 'class',
        language: 'ruby',
        exports: ['Order'],
      },
    });

    // symbol-name-match: a same-named symbol imported from a non-relative
    // package specifier that verifiably resolves to NEITHER real file --
    // unverified against a specific file, so it can only ever resolve via
    // this weakest cross-package tier.
    const symbolNameMatchCaller = createTestChunk({
      content: 'class ReportBuilder { def run; Order.new; end; end',
      metadata: {
        file: 'src/report_builder.rb',
        startLine: 1,
        endLine: 10,
        type: 'class',
        symbolName: 'ReportBuilder',
        language: 'ruby',
        exports: ['ReportBuilder'],
        importedSymbols: { totally_unrelated_gem: ['Order'] },
        callSites: [{ symbol: 'Order', line: 5 }],
      },
    });

    const graph = buildDependencyGraph([classChunk, symbolNameMatchCaller]);
    const rawCallers = graph.getCallers('src/models/order.rb', 'Order');

    // Confirms the fixture actually produced the tier this test exists to
    // exclude -- otherwise the assertion below would pass vacuously.
    expect(rawCallers.map(c => c.provenance)).toEqual(['symbol-name-match']);

    const graphFiles = rawCallers
      .filter(edge => isSafeEvidenceTier(edge.provenance))
      .map(edge => edge.caller.filepath);
    expect(graphFiles).toEqual([]);
  });
});
