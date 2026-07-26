import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  detectPythonSrcLayoutRoot,
  resolvePythonSrcLayoutImport,
  clearPythonSrcLayoutCache,
} from './python-src-layout.js';

describe('detectPythonSrcLayoutRoot', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-python-src-layout-'));
  });

  afterEach(async () => {
    clearPythonSrcLayoutCache();
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  async function writeFile(relPath: string, content: string): Promise<void> {
    const abs = path.join(testDir, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }

  it('returns undefined when there is no src/ directory at all', () => {
    expect(detectPythonSrcLayoutRoot(testDir)).toBeUndefined();
  });

  it('detects src layout (Flask shape: src/<package>/__init__.py)', async () => {
    await writeFile('src/flask/__init__.py', 'from .app import Flask as Flask\n');
    expect(detectPythonSrcLayoutRoot(testDir)).toBe('src');
  });

  it('returns undefined when src/ exists but has no real Python package inside', async () => {
    // e.g. a JS/TS monorepo's unrelated top-level src/ directory.
    await writeFile('src/index.ts', 'export {};\n');
    expect(detectPythonSrcLayoutRoot(testDir)).toBeUndefined();
  });

  it('returns undefined when src/ contains only loose .py files, no package directory', async () => {
    await writeFile('src/script.py', 'print("hi")\n');
    expect(detectPythonSrcLayoutRoot(testDir)).toBeUndefined();
  });

  it('caches the detected root per workspace root', async () => {
    await writeFile('src/flask/__init__.py', '');
    const first = detectPythonSrcLayoutRoot(testDir);
    // Removing the package after the first call should not change the
    // cached result within the same process -- mirrors resolveGoModulePrefix's
    // caching contract.
    await fs.rm(path.join(testDir, 'src'), { recursive: true, force: true });
    const second = detectPythonSrcLayoutRoot(testDir);

    expect(second).toBe(first);
    expect(second).toBe('src');
  });
});

describe('resolvePythonSrcLayoutImport', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-python-src-layout-resolve-'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  async function writeFile(relPath: string, content: string): Promise<void> {
    const abs = path.join(testDir, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }

  it('is a no-op when srcLayoutRoot is undefined', () => {
    expect(resolvePythonSrcLayoutImport('flask', undefined, testDir)).toBe('flask');
  });

  it('is a no-op when workspaceRoot is undefined', () => {
    expect(resolvePythonSrcLayoutImport('flask', 'src', undefined)).toBe('flask');
  });

  it('prepends the src-layout root to a bare package import that exists on disk (#901 repro)', async () => {
    await writeFile('src/flask/__init__.py', 'from .app import Flask as Flask\n');
    expect(resolvePythonSrcLayoutImport('flask', 'src', testDir)).toBe('src/flask');
  });

  it('prepends the src-layout root to a dotted absolute import that exists on disk, converting dots to slashes', async () => {
    await writeFile('src/flask/globals.py', '');
    await writeFile('src/flask/json/tag.py', '');
    expect(resolvePythonSrcLayoutImport('flask.globals', 'src', testDir)).toBe('src/flask/globals');
    expect(resolvePythonSrcLayoutImport('flask.json.tag', 'src', testDir)).toBe(
      'src/flask/json/tag',
    );
  });

  it('matches a package directory (__init__.py) as well as a direct module file', async () => {
    await writeFile('src/flask/json/__init__.py', '');
    expect(resolvePythonSrcLayoutImport('flask.json', 'src', testDir)).toBe('src/flask/json');
  });

  it('leaves the specifier unchanged when the candidate path does not exist on disk (celery repro)', async () => {
    // examples/celery/make_celery.py's `import task_app` resolves against
    // its OWN nested src/task_app/, not the outer workspace root's src/ --
    // here there is no src/task_app anywhere, so this must stay a no-op
    // rather than fabricate "src/task_app".
    await writeFile('src/flask/__init__.py', '');
    expect(resolvePythonSrcLayoutImport('task_app', 'src', testDir)).toBe('task_app');
  });

  it('leaves a dotted import unchanged when only a PARTIAL prefix exists on disk', async () => {
    // e.g. examples/tutorial's own `flaskr.db` must not be misresolved as
    // "src/flaskr/db" just because *some* unrelated src/ exists at the
    // workspace root -- src/flaskr itself must not exist either.
    await writeFile('src/flask/__init__.py', '');
    expect(resolvePythonSrcLayoutImport('flaskr.db', 'src', testDir)).toBe('flaskr.db');
  });

  it('leaves an already-resolved relative-import path unchanged (no double-prefixing)', async () => {
    // A relative import (`.globals`) is resolved against the importer's own
    // path in an earlier pipeline step (ast/symbols.ts's step 1), landing
    // under src/ already -- this step must not re-prefix it.
    await writeFile('src/flask/globals.py', '');
    expect(resolvePythonSrcLayoutImport('src/flask/globals', 'src', testDir)).toBe(
      'src/flask/globals',
    );
  });

  it('leaves an unresolved leading-dot specifier unchanged (defensive; should not reach this step)', () => {
    expect(resolvePythonSrcLayoutImport('.globals', 'src', testDir)).toBe('.globals');
  });
});
