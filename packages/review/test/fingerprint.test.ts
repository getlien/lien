import { describe, it, expect } from 'vitest';
import type { CodeChunk } from '@liendev/parser';
import { computeFingerprint, serializeFingerprint } from '../src/fingerprint.js';

function makeChunk(
  overrides: Partial<CodeChunk['metadata']> & { content?: string } = {},
): CodeChunk {
  const { content = '', ...meta } = overrides;
  return {
    content,
    metadata: {
      file: 'test.ts',
      startLine: 1,
      endLine: 10,
      type: 'function',
      language: 'typescript',
      ...meta,
    },
  };
}

describe('computeFingerprint', () => {
  describe('edge cases', () => {
    it('returns defaults for empty chunks', () => {
      const fp = computeFingerprint([]);
      expect(fp.paradigm.dominantStyle).toBe('mixed');
      expect(fp.paradigm.ratio).toBe(0.5);
      expect(fp.totalChunks).toBe(0);
      expect(fp.languages).toEqual({});
      expect(fp.asyncPattern).toBe('sync');
    });
  });

  describe('paradigm', () => {
    it('detects pure functional codebase', () => {
      const chunks = Array.from({ length: 10 }, (_, i) =>
        makeChunk({ symbolName: `fn${i}`, symbolType: 'function' }),
      );
      const fp = computeFingerprint(chunks);
      expect(fp.paradigm.ratio).toBe(1.0);
      expect(fp.paradigm.dominantStyle).toBe('functional');
      expect(fp.paradigm.functionCount).toBe(10);
    });

    it('detects pure OOP codebase', () => {
      const chunks = [
        makeChunk({ symbolName: 'UserService', symbolType: 'class' }),
        makeChunk({ symbolName: 'AuthService', symbolType: 'class' }),
        ...Array.from({ length: 8 }, (_, i) =>
          makeChunk({ symbolName: `method${i}`, symbolType: 'method' }),
        ),
      ];
      const fp = computeFingerprint(chunks);
      expect(fp.paradigm.ratio).toBe(0.0);
      expect(fp.paradigm.dominantStyle).toBe('oop');
    });

    it('detects mixed paradigm', () => {
      const chunks = [
        ...Array.from({ length: 5 }, (_, i) =>
          makeChunk({ symbolName: `fn${i}`, symbolType: 'function' }),
        ),
        ...Array.from({ length: 3 }, (_, i) =>
          makeChunk({ symbolName: `method${i}`, symbolType: 'method' }),
        ),
        makeChunk({ symbolName: 'ClassA', symbolType: 'class' }),
        makeChunk({ symbolName: 'ClassB', symbolType: 'class' }),
      ];
      const fp = computeFingerprint(chunks);
      expect(fp.paradigm.ratio).toBe(0.5);
      expect(fp.paradigm.dominantStyle).toBe('mixed');
    });

    it('returns mixed when no symbolTypes present', () => {
      const chunks = [makeChunk({ type: 'block' }), makeChunk({ type: 'block' })];
      const fp = computeFingerprint(chunks);
      expect(fp.paradigm.ratio).toBe(0.5);
      expect(fp.paradigm.dominantStyle).toBe('mixed');
    });
  });

  describe('naming', () => {
    it('detects camelCase functions', () => {
      const chunks = ['handleAuth', 'processData', 'validateEmail'].map(name =>
        makeChunk({ symbolName: name, symbolType: 'function' }),
      );
      const fp = computeFingerprint(chunks);
      expect(fp.naming.functions).toBe('camelCase');
    });

    it('detects snake_case functions', () => {
      const chunks = ['handle_auth', 'process_data', 'validate_email'].map(name =>
        makeChunk({ symbolName: name, symbolType: 'function' }),
      );
      const fp = computeFingerprint(chunks);
      expect(fp.naming.functions).toBe('snake_case');
    });

    it('detects PascalCase classes', () => {
      const chunks = ['AuthService', 'UserController'].map(name =>
        makeChunk({ symbolName: name, symbolType: 'class' }),
      );
      const fp = computeFingerprint(chunks);
      expect(fp.naming.classes).toBe('PascalCase');
    });

    it('returns mixed when no majority', () => {
      const chunks = [
        makeChunk({ symbolName: 'handleAuth', symbolType: 'function' }),
        makeChunk({ symbolName: 'processData', symbolType: 'function' }),
        makeChunk({ symbolName: 'handle_auth', symbolType: 'function' }),
        makeChunk({ symbolName: 'process_data', symbolType: 'function' }),
      ];
      const fp = computeFingerprint(chunks);
      expect(fp.naming.functions).toBe('mixed');
    });

    it('skips short names', () => {
      const chunks = [
        makeChunk({ symbolName: 'handleAuth', symbolType: 'function' }),
        makeChunk({ symbolName: 'processData', symbolType: 'function' }),
        makeChunk({ symbolName: 'validateEmail', symbolType: 'function' }),
        makeChunk({ symbolName: 'x', symbolType: 'function' }),
        makeChunk({ symbolName: '_', symbolType: 'function' }),
      ];
      const fp = computeFingerprint(chunks);
      expect(fp.naming.functions).toBe('camelCase');
    });

    it('skips SCREAMING_SNAKE constants', () => {
      const chunks = [
        makeChunk({ symbolName: 'handleAuth', symbolType: 'function' }),
        makeChunk({ symbolName: 'processData', symbolType: 'function' }),
        makeChunk({ symbolName: 'MAX_RETRIES', symbolType: 'function' }),
        makeChunk({ symbolName: 'DEFAULT_PORT', symbolType: 'function' }),
      ];
      const fp = computeFingerprint(chunks);
      expect(fp.naming.functions).toBe('camelCase');
    });

    it('builds correct summary for different conventions', () => {
      const chunks = [
        makeChunk({ symbolName: 'handleAuth', symbolType: 'function' }),
        makeChunk({ symbolName: 'processData', symbolType: 'function' }),
        makeChunk({ symbolName: 'validateEmail', symbolType: 'function' }),
        makeChunk({ symbolName: 'AuthService', symbolType: 'class' }),
        makeChunk({ symbolName: 'UserController', symbolType: 'class' }),
      ];
      const fp = computeFingerprint(chunks);
      expect(fp.naming.summary).toBe('camelCase functions, PascalCase classes');
    });

    it('builds summary for same convention', () => {
      const chunks = [
        makeChunk({ symbolName: 'handle_auth', symbolType: 'function' }),
        makeChunk({ symbolName: 'process_data', symbolType: 'function' }),
        makeChunk({ symbolName: 'auth_service', symbolType: 'class' }),
        makeChunk({ symbolName: 'user_controller', symbolType: 'class' }),
      ];
      const fp = computeFingerprint(chunks);
      expect(fp.naming.summary).toBe('snake_case functions and classes');
    });
  });

  describe('module structure', () => {
    it('detects barrel file by name', () => {
      const chunks = [
        makeChunk({
          file: 'src/index.ts',
          exports: ['foo', 'bar'],
          importedSymbols: { './foo': ['foo'] },
        }),
      ];
      const fp = computeFingerprint(chunks);
      expect(fp.moduleStructure.barrelFileCount).toBe(1);
    });

    it('detects barrel file by re-export', () => {
      const chunks = [
        makeChunk({
          file: 'src/validators.ts',
          exports: ['validateEmail', 'validatePhone'],
          importedSymbols: { './email': ['validateEmail'] },
        }),
      ];
      const fp = computeFingerprint(chunks);
      expect(fp.moduleStructure.barrelFileCount).toBe(1);
    });

    it('does not count barrel for index file with no exports', () => {
      const chunks = [
        makeChunk({
          file: 'src/index.ts',
          imports: ['./foo'],
        }),
      ];
      const fp = computeFingerprint(chunks);
      expect(fp.moduleStructure.barrelFileCount).toBe(0);
    });

    it('computes flat import depth', () => {
      const chunks = [makeChunk({ imports: ['./utils', './config', './types'] })];
      const fp = computeFingerprint(chunks);
      expect(fp.moduleStructure.averageImportDepth).toBe(1.0);
      expect(fp.moduleStructure.structure).toBe('flat');
    });

    it('computes nested import depth', () => {
      const chunks = [
        makeChunk({ imports: ['../../../core/models/user', '../../services/auth/handler'] }),
      ];
      const fp = computeFingerprint(chunks);
      expect(fp.moduleStructure.averageImportDepth).toBeGreaterThan(3.0);
      expect(fp.moduleStructure.structure).toBe('nested');
    });

    it('skips package imports for depth', () => {
      const chunks = [makeChunk({ imports: ['express', 'lodash', './local'] })];
      const fp = computeFingerprint(chunks);
      expect(fp.moduleStructure.averageImportDepth).toBe(1.0);
    });

    it('returns flat when no imports', () => {
      const chunks = [makeChunk({})];
      const fp = computeFingerprint(chunks);
      expect(fp.moduleStructure.averageImportDepth).toBe(0);
      expect(fp.moduleStructure.structure).toBe('flat');
    });
  });

  describe('async patterns', () => {
    it('detects async/await dominant', () => {
      const chunks = [
        ...Array.from({ length: 8 }, (_, i) =>
          makeChunk({
            symbolName: `fn${i}`,
            symbolType: 'function',
            signature: `async function fn${i}()`,
          }),
        ),
        makeChunk({
          symbolName: 'syncFn1',
          symbolType: 'function',
          signature: 'function syncFn1()',
        }),
        makeChunk({
          symbolName: 'syncFn2',
          symbolType: 'function',
          signature: 'function syncFn2()',
        }),
      ];
      const fp = computeFingerprint(chunks);
      expect(fp.asyncPattern).toBe('async/await');
    });

    it('detects sync codebase', () => {
      const chunks = Array.from({ length: 10 }, (_, i) =>
        makeChunk({
          symbolName: `fn${i}`,
          symbolType: 'function',
          signature: `function fn${i}()`,
        }),
      );
      const fp = computeFingerprint(chunks);
      expect(fp.asyncPattern).toBe('sync');
    });

    it('detects promise pattern', () => {
      const chunks = [
        makeChunk({
          symbolName: 'fetchData',
          symbolType: 'function',
          signature: 'function fetchData(): Promise<void>',
        }),
        makeChunk({
          symbolName: 'loadUser',
          symbolType: 'function',
          signature: 'function loadUser(): Promise<User>',
        }),
        makeChunk({
          symbolName: 'syncFn',
          symbolType: 'function',
          signature: 'function syncFn()',
        }),
      ];
      const fp = computeFingerprint(chunks);
      expect(fp.asyncPattern).toBe('promises');
    });

    it('returns mixed for diverse async patterns', () => {
      const chunks = [
        makeChunk({
          symbolName: 'fn1',
          symbolType: 'function',
          signature: 'async function fn1()',
        }),
        makeChunk({
          symbolName: 'fn2',
          symbolType: 'function',
          signature: 'function fn2(): Promise<void>',
        }),
        makeChunk({
          symbolName: 'fn3',
          symbolType: 'function',
          signature: 'function fn3(callback, done)',
          content: 'function fn3(callback, done) { callback(); }',
        }),
      ];
      const fp = computeFingerprint(chunks);
      expect(fp.asyncPattern).toBe('mixed');
    });
  });

  describe('languages', () => {
    it('computes language distribution', () => {
      const chunks = [
        ...Array.from({ length: 8 }, () => makeChunk({ language: 'typescript' })),
        ...Array.from({ length: 2 }, () => makeChunk({ language: 'python' })),
      ];
      const fp = computeFingerprint(chunks);
      expect(fp.languages).toEqual({ typescript: 80, python: 20 });
    });

    it('single language at 100%', () => {
      const chunks = Array.from({ length: 5 }, () => makeChunk({ language: 'typescript' }));
      const fp = computeFingerprint(chunks);
      expect(fp.languages).toEqual({ typescript: 100 });
    });

    it('small percentages are at least 1%', () => {
      const chunks = [
        ...Array.from({ length: 199 }, () => makeChunk({ language: 'typescript' })),
        makeChunk({ language: 'python' }),
      ];
      const fp = computeFingerprint(chunks);
      expect(fp.languages.python).toBe(1);
    });
  });
});

describe('serializeFingerprint', () => {
  it('produces expected format', () => {
    const fp = computeFingerprint([
      ...Array.from({ length: 8 }, (_, i) =>
        makeChunk({
          symbolName: `fn${i}`,
          symbolType: 'function',
          signature: `async function fn${i}()`,
          language: 'typescript',
        }),
      ),
      makeChunk({ symbolName: 'UserService', symbolType: 'class', language: 'typescript' }),
      makeChunk({ symbolName: 'handler', symbolType: 'method', language: 'typescript' }),
    ]);
    const output = serializeFingerprint(fp);
    expect(output).toContain('## Codebase Fingerprint');
    expect(output).toContain('Paradigm:');
    expect(output).toContain('Naming:');
    expect(output).toContain('Modules:');
    expect(output).toContain('Languages:');
  });

  it('omits async line when sync', () => {
    const fp = computeFingerprint([
      makeChunk({ symbolName: 'fn1', symbolType: 'function', signature: 'function fn1()' }),
    ]);
    const output = serializeFingerprint(fp);
    expect(output).not.toContain('Async:');
  });

  it('includes async line when not sync', () => {
    const fp = computeFingerprint([
      makeChunk({
        symbolName: 'fn1',
        symbolType: 'function',
        signature: 'async function fn1()',
      }),
    ]);
    const output = serializeFingerprint(fp);
    expect(output).toContain('Async: async/await');
  });

  it('languages sorted by percentage descending', () => {
    const fp = computeFingerprint([
      ...Array.from({ length: 7 }, () => makeChunk({ language: 'typescript' })),
      ...Array.from({ length: 3 }, () => makeChunk({ language: 'python' })),
    ]);
    const output = serializeFingerprint(fp);
    const langLine = output.split('\n').find(l => l.includes('Languages:'))!;
    const tsPos = langLine.indexOf('typescript');
    const pyPos = langLine.indexOf('python');
    expect(tsPos).toBeLessThan(pyPos);
  });
});
