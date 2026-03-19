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
        file: 'packages/runner/src/handlers/pr-review.ts',
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
    expect(callers[0].caller.filepath).toBe('packages/runner/src/handlers/pr-review.ts');
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

  it('does NOT link when symbol is exported by multiple files (ambiguous)', () => {
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
    expect(graph.getCallers('src/utils/format.ts', 'format')).toHaveLength(0);
    expect(graph.getCallers('src/helpers/format.ts', 'format')).toHaveLength(0);
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
