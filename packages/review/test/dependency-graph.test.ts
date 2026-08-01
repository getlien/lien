import { describe, it, expect } from 'vitest';
import { buildDependencyGraph } from '../src/dependency-graph.js';
import { createTestChunk } from '../src/test-helpers.js';

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
