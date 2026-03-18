import { describe, it, expect } from 'vitest';
import { buildDependencyGraph, resolveImportPath } from '../src/dependency-graph.js';
import { createTestChunk } from '../src/test-helpers.js';

// ---------------------------------------------------------------------------
// resolveImportPath
// ---------------------------------------------------------------------------

describe('resolveImportPath', () => {
  const fileSet = new Set([
    'src/utils/validate.ts',
    'src/utils/format.ts',
    'src/services/auth.ts',
    'src/lib/index.ts',
    'src/helpers.js',
  ]);

  it('resolves relative import with extension match', () => {
    expect(resolveImportPath('./validate', 'src/utils/format.ts', fileSet)).toBe(
      'src/utils/validate.ts',
    );
  });

  it('resolves relative import with .js -> .ts remap', () => {
    expect(resolveImportPath('./validate.js', 'src/utils/format.ts', fileSet)).toBe(
      'src/utils/validate.ts',
    );
  });

  it('resolves parent directory import', () => {
    expect(resolveImportPath('../services/auth', 'src/utils/format.ts', fileSet)).toBe(
      'src/services/auth.ts',
    );
  });

  it('resolves directory with index file', () => {
    expect(resolveImportPath('../lib', 'src/utils/format.ts', fileSet)).toBe('src/lib/index.ts');
  });

  it('returns null for non-relative (bare) imports', () => {
    expect(resolveImportPath('lodash', 'src/utils/format.ts', fileSet)).toBeNull();
  });

  it('returns null for unresolvable import', () => {
    expect(resolveImportPath('./nonexistent', 'src/utils/format.ts', fileSet)).toBeNull();
  });

  it('resolves exact match (file already has extension)', () => {
    expect(resolveImportPath('../helpers.js', 'src/services/auth.ts', fileSet)).toBe(
      'src/helpers.js',
    );
  });
});

// ---------------------------------------------------------------------------
// buildDependencyGraph
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
