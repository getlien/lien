import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { chunkByAST, shouldUseAST } from './chunker.js';
import { clearWorkspacePackageCache } from '../workspace-packages.js';
import { clearPsr4Cache } from '../php-psr4.js';
import { clearGoModuleCache } from '../go-module.js';
import { clearPythonSrcLayoutCache } from '../python-src-layout.js';
import { clearRustCrateMapCache } from '../rust-crate-map.js';

describe('AST Chunker', () => {
  describe('shouldUseAST', () => {
    it('should return true for TypeScript files', () => {
      expect(shouldUseAST('test.ts')).toBe(true);
      expect(shouldUseAST('test.tsx')).toBe(true);
    });

    it('should return true for JavaScript files', () => {
      expect(shouldUseAST('test.js')).toBe(true);
      expect(shouldUseAST('test.jsx')).toBe(true);
      expect(shouldUseAST('test.mjs')).toBe(true);
      expect(shouldUseAST('test.cjs')).toBe(true);
    });

    it('should return true for PHP files', () => {
      expect(shouldUseAST('test.php')).toBe(true);
      expect(shouldUseAST('Controller.php')).toBe(true);
    });

    it('should return true for Python files', () => {
      expect(shouldUseAST('test.py')).toBe(true);
      expect(shouldUseAST('script.py')).toBe(true);
    });

    it('should return true for Ruby files', () => {
      expect(shouldUseAST('test.rb')).toBe(true);
      expect(shouldUseAST('app/models/user.rb')).toBe(true);
    });

    it('should return false for unsupported files', () => {
      expect(shouldUseAST('test.scala')).toBe(false);
      expect(shouldUseAST('test.txt')).toBe(false);
    });
  });

  describe('chunkByAST', () => {
    it('should chunk a simple function', () => {
      const content = `
function hello() {
  console.log("Hello world");
  return true;
}
      `.trim();

      const chunks = chunkByAST('test.ts', content);

      expect(chunks.length).toBeGreaterThan(0);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'hello');

      expect(funcChunk).toBeDefined();
      expect(funcChunk?.metadata.symbolType).toBe('function');
      expect(funcChunk?.metadata.type).toBe('function');
      expect(funcChunk?.content).toContain('console.log');
    });

    it('should chunk a class with methods', () => {
      const content = `
class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }

  subtract(a: number, b: number): number {
    return a - b;
  }
}
      `.trim();

      const chunks = chunkByAST('test.ts', content);

      // Should have a class chunk and chunks for each method
      const classChunk = chunks.find(c => c.metadata.symbolName === 'Calculator');
      const addMethod = chunks.find(c => c.metadata.symbolName === 'add');
      const subtractMethod = chunks.find(c => c.metadata.symbolName === 'subtract');

      expect(classChunk).toBeDefined();
      expect(classChunk?.metadata.symbolType).toBe('class');
      expect(classChunk?.metadata.type).toBe('class');

      expect(addMethod).toBeDefined();
      expect(addMethod?.metadata.symbolType).toBe('method');
      expect(addMethod?.metadata.parentClass).toBe('Calculator');

      expect(subtractMethod).toBeDefined();
      expect(subtractMethod?.metadata.symbolType).toBe('method');
      expect(subtractMethod?.metadata.parentClass).toBe('Calculator');

      // Should have 1 class chunk + 2 method chunks
      expect(chunks.length).toBe(3);
    });

    it('should extract function metadata', () => {
      const content = `
function validateEmail(email: string): boolean {
  if (!email) return false;
  if (!email.includes('@')) return false;
  return true;
}
      `.trim();

      const chunks = chunkByAST('test.ts', content);
      const chunk = chunks.find(c => c.metadata.symbolName === 'validateEmail');

      expect(chunk).toBeDefined();
      expect(chunk?.metadata.symbolName).toBe('validateEmail');
      expect(chunk?.metadata.symbolType).toBe('function');
      expect(chunk?.metadata.complexity).toBeGreaterThan(1); // Has if statements
      expect(chunk?.metadata.parameters).toBeDefined();
      expect(chunk?.metadata.signature).toContain('validateEmail');
    });

    it('should handle arrow functions', () => {
      const content = `
const greet = (name: string) => {
  return \`Hello, \${name}!\`;
};
      `.trim();

      const chunks = chunkByAST('test.ts', content);

      // Arrow functions should be detected
      expect(chunks.length).toBeGreaterThan(0);
      const arrowChunk = chunks.find(c => c.metadata.symbolName === 'greet');
      expect(arrowChunk).toBeDefined();
    });

    it('should handle interfaces', () => {
      const content = `
interface User {
  id: number;
  name: string;
  email: string;
}
      `.trim();

      const chunks = chunkByAST('test.ts', content);
      const interfaceChunk = chunks.find(c => c.metadata.symbolName === 'User');

      expect(interfaceChunk).toBeDefined();
      expect(interfaceChunk?.metadata.symbolType).toBe('interface');
    });

    it('should extract imports and resolve relative specifiers against the file path', () => {
      const content = `
import { foo } from './foo';
import { bar } from '../lib/bar';

function test() {
  return foo() + bar();
}
      `.trim();

      const chunks = chunkByAST('src/consumer/test.ts', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'test');

      expect(funcChunk?.metadata.imports).toBeDefined();
      // './foo' relative to 'src/consumer/test.ts' → 'src/consumer/foo'
      // '../lib/bar' → 'src/lib/bar'
      expect(funcChunk?.metadata.imports).toContain('src/consumer/foo');
      expect(funcChunk?.metadata.imports).toContain('src/lib/bar');

      // Same resolution must apply to importedSymbols keys — dependency
      // analysis matches symbol-level via this map, not just `imports`.
      expect(funcChunk?.metadata.importedSymbols).toMatchObject({
        'src/consumer/foo': ['foo'],
        'src/lib/bar': ['bar'],
      });
    });

    it('does NOT resolve Rust self::/super:: via the generic JS/TS-style relative-import join (#525 scope)', () => {
      // Rust is deliberately excluded from `RESOLVE_RELATIVE_IMPORTS` (see
      // that set's doc comment in ast/chunker.ts) because a naive filesystem-
      // style ".." join of the extractor's `../utils/helper` storage
      // convention would ascend past the importer's own directory when the
      // importer is a "leaf" file (crates/app/src/foo.rs isn't a mod.rs, so
      // its own directory already IS its parent module's location — see
      // `resolveRustRelativeModulePath`'s doc comment). Rust instead resolves
      // self::/super:: via its OWN module-aware mechanism (#928, threaded
      // through `rustImporterFile`), which for this exact leaf-file shape
      // correctly stays in the SAME directory rather than ascending.
      const rustContent = `
use super::utils::helper;

pub fn run() {
    helper();
}
      `.trim();

      const chunks = chunkByAST('crates/app/src/foo.rs', rustContent);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'run');

      expect(funcChunk?.metadata.imports).toBeDefined();
      // Resolved precisely to the real sibling path (#928) -- NOT the old
      // directory-less "../utils/helper" storage convention, and NOT the
      // naive (wrong, ascends one level too far) generic join a JS/TS-style
      // resolver would have produced.
      expect(funcChunk?.metadata.imports).toContain('crates/app/src/utils/helper');
      expect(funcChunk?.metadata.imports).not.toContain('../utils/helper');
      expect(funcChunk?.metadata.imports).not.toContain('crates/app/utils/helper');
    });

    it('resolves Rust self:: from a mod.rs to a sibling in the SAME directory (#928)', () => {
      const rustContent = `
pub use self::copy::copy;

pub fn run() {
    copy();
}
      `.trim();

      const chunks = chunkByAST('tokio/src/fs/mod.rs', rustContent);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'run');

      expect(funcChunk?.metadata.imports).toContain('tokio/src/fs/copy/copy');
    });

    describe('cross-package workspace imports', () => {
      let testDir: string;

      beforeEach(async () => {
        testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-chunker-workspace-'));
      });

      afterEach(async () => {
        clearWorkspacePackageCache();
        await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
      });

      async function writeJson(relPath: string, data: unknown): Promise<void> {
        const abs = path.join(testDir, relPath);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, JSON.stringify(data, null, 2));
      }

      async function writeFile(relPath: string, content = ''): Promise<void> {
        const abs = path.join(testDir, relPath);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, content);
      }

      it('resolves a bare workspace-package import to the package source entry (monorepo fixture)', async () => {
        // Reproduces the dogfooding gap: a consumer package imports a symbol
        // from a sibling workspace package by its package specifier, not a
        // relative path.
        await writeJson('package.json', { name: 'root', workspaces: ['packages/*'] });
        await writeJson('packages/parser/package.json', {
          name: '@liendev/parser',
          main: './dist/index.js',
        });
        await writeFile(
          'packages/parser/src/index.ts',
          "export { computeComplexityDelta } from './insights/complexity-delta.js';",
        );

        const content = `
import { computeComplexityDelta } from '@liendev/parser';

function run() {
  return computeComplexityDelta();
}
        `.trim();

        const chunks = chunkByAST('packages/cli/src/delta-cmd.ts', content, {
          workspaceRoot: testDir,
        });
        const funcChunk = chunks.find(c => c.metadata.symbolName === 'run');

        expect(funcChunk?.metadata.imports).toContain('packages/parser/src/index.ts');
        expect(funcChunk?.metadata.importedSymbols).toMatchObject({
          'packages/parser/src/index.ts': ['computeComplexityDelta'],
        });
      });

      it('leaves external package specifiers untouched even when workspaceRoot is set', async () => {
        await writeJson('package.json', { name: 'root', workspaces: ['packages/*'] });
        await writeJson('packages/parser/package.json', { name: '@liendev/parser' });
        await writeFile('packages/parser/src/index.ts', 'export const x = 1;');

        const content = `
import chalk from 'chalk';

function run() {
  return chalk.red('x');
}
        `.trim();

        const chunks = chunkByAST('packages/cli/src/delta-cmd.ts', content, {
          workspaceRoot: testDir,
        });
        const funcChunk = chunks.find(c => c.metadata.symbolName === 'run');

        expect(funcChunk?.metadata.imports).toContain('chalk');
      });

      it('leaves imports unresolved for a non-workspace repo (no workspaces field)', async () => {
        await writeJson('package.json', { name: 'standalone-app' });

        const content = `
import { computeComplexityDelta } from '@liendev/parser';

function run() {
  return computeComplexityDelta();
}
        `.trim();

        const chunks = chunkByAST('src/delta-cmd.ts', content, { workspaceRoot: testDir });
        const funcChunk = chunks.find(c => c.metadata.symbolName === 'run');

        // No workspaces field → resolveWorkspacePackageEntries returns an
        // empty map → zero behavior change from the pre-fix raw specifier.
        expect(funcChunk?.metadata.imports).toContain('@liendev/parser');
      });

      it('is a no-op when workspaceRoot is omitted (existing callers unaffected)', () => {
        const content = `
import { computeComplexityDelta } from '@liendev/parser';

function run() {
  return computeComplexityDelta();
}
        `.trim();

        const chunks = chunkByAST('packages/cli/src/delta-cmd.ts', content);
        const funcChunk = chunks.find(c => c.metadata.symbolName === 'run');

        expect(funcChunk?.metadata.imports).toContain('@liendev/parser');
      });
    });

    describe('manifest-root mapping (PHP PSR-4, Go module) — #867', () => {
      let testDir: string;

      beforeEach(async () => {
        testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-chunker-manifest-roots-'));
      });

      afterEach(async () => {
        clearPsr4Cache();
        clearGoModuleCache();
        await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
      });

      async function writeJson(relPath: string, data: unknown): Promise<void> {
        const abs = path.join(testDir, relPath);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, JSON.stringify(data, null, 2));
      }

      async function writeFile(relPath: string, content: string): Promise<void> {
        const abs = path.join(testDir, relPath);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, content);
      }

      it('resolves a PHP PSR-4 namespaced import to its real source path (guzzle repro)', async () => {
        await writeJson('composer.json', {
          name: 'guzzlehttp/guzzle',
          autoload: { 'psr-4': { 'GuzzleHttp\\': 'src/' } },
        });

        const content = `<?php
use GuzzleHttp\\Cookie\\SetCookie;
use PHPUnit\\Framework\\TestCase;

class SetCookieTest {
  public function testFoo() {
    return new SetCookie();
  }
}
?>`;

        const chunks = chunkByAST('tests/Cookie/SetCookieTest.php', content, {
          workspaceRoot: testDir,
        });
        const methodChunk = chunks.find(c => c.metadata.symbolName === 'testFoo');

        expect(methodChunk?.metadata.imports).toContain('src/Cookie/SetCookie');
        // No registered PSR-4 prefix for PHPUnit → passes through unresolved.
        expect(methodChunk?.metadata.imports).toContain('PHPUnit\\Framework\\TestCase');
      });

      it('leaves PHP imports unresolved when there is no composer.json (zero behavior change)', () => {
        const content = `<?php
use GuzzleHttp\\Cookie\\SetCookie;

class SetCookieTest {
  public function testFoo() {
    return new SetCookie();
  }
}
?>`;

        const chunks = chunkByAST('tests/Cookie/SetCookieTest.php', content, {
          workspaceRoot: testDir,
        });
        const methodChunk = chunks.find(c => c.metadata.symbolName === 'testFoo');

        expect(methodChunk?.metadata.imports).toContain('GuzzleHttp\\Cookie\\SetCookie');
      });

      it('resolves a Go module-prefixed import to its repo-relative path (gin repro)', async () => {
        await writeFile('go.mod', 'module github.com/gin-gonic/gin\n\ngo 1.21\n');

        const content = `package binding_test

import (
	"testing"

	"github.com/gin-gonic/gin/binding"
)

func TestMode(t *testing.T) {
	binding.Validator = nil
}
`;

        const chunks = chunkByAST('mode_test.go', content, { workspaceRoot: testDir });
        const funcChunk = chunks.find(c => c.metadata.symbolName === 'TestMode');

        expect(funcChunk?.metadata.imports).toContain('binding');
        expect(funcChunk?.metadata.imports).not.toContain('github.com/gin-gonic/gin/binding');
      });

      it('leaves Go imports unresolved when there is no go.mod (zero behavior change)', () => {
        const content = `package binding_test

import "github.com/gin-gonic/gin/binding"

func TestMode(t *testing.T) {
	binding.Validator = nil
}
`;

        const chunks = chunkByAST('mode_test.go', content, { workspaceRoot: testDir });
        const funcChunk = chunks.find(c => c.metadata.symbolName === 'TestMode');

        expect(funcChunk?.metadata.imports).toContain('github.com/gin-gonic/gin/binding');
      });

      it('is a no-op for PHP/Go when workspaceRoot is omitted (existing callers unaffected)', () => {
        const phpContent = `<?php
use GuzzleHttp\\Cookie\\SetCookie;

class SetCookieTest {
  public function testFoo() {
    return new SetCookie();
  }
}
?>`;
        const phpChunks = chunkByAST('tests/Cookie/SetCookieTest.php', phpContent);
        const phpMethodChunk = phpChunks.find(c => c.metadata.symbolName === 'testFoo');
        expect(phpMethodChunk?.metadata.imports).toContain('GuzzleHttp\\Cookie\\SetCookie');

        const goContent = `package binding_test

import "github.com/gin-gonic/gin/binding"

func TestMode(t *testing.T) {
	binding.Validator = nil
}
`;
        const goChunks = chunkByAST('mode_test.go', goContent);
        const goFuncChunk = goChunks.find(c => c.metadata.symbolName === 'TestMode');
        expect(goFuncChunk?.metadata.imports).toContain('github.com/gin-gonic/gin/binding');
      });
    });

    describe('Python relative imports and src-layout bare imports — #901, #904', () => {
      let testDir: string;

      beforeEach(async () => {
        testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-chunker-python-roots-'));
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

      it("resolves a relative import against the importing file's own directory (flask.app -> .globals repro, #904)", async () => {
        await writeFile('src/flask/__init__.py', 'from .app import Flask as Flask\n');

        const content = `from .globals import g

def do_something():
    return g
`;
        const chunks = chunkByAST('src/flask/app.py', content, { workspaceRoot: testDir });
        const funcChunk = chunks.find(c => c.metadata.symbolName === 'do_something');

        expect(funcChunk?.metadata.imports).toContain('src/flask/globals');
      });

      it('resolves a two-dot relative import up one package level (sansio/app.py -> ..globals)', async () => {
        await writeFile('src/flask/__init__.py', 'from .app import Flask as Flask\n');

        const content = `from ..globals import request

def do_something():
    return request
`;
        const chunks = chunkByAST('src/flask/sansio/app.py', content, { workspaceRoot: testDir });
        const funcChunk = chunks.find(c => c.metadata.symbolName === 'do_something');

        expect(funcChunk?.metadata.imports).toContain('src/flask/globals');
      });

      it('still fully resolves a Python relative import when workspaceRoot is omitted (resolution keys off filepath, not workspaceRoot)', () => {
        const content = `from .globals import g

def do_something():
    return g
`;
        const chunks = chunkByAST('src/flask/app.py', content);
        const funcChunk = chunks.find(c => c.metadata.symbolName === 'do_something');

        // No filepath threaded through without workspaceRoot in this test
        // helper's call shape either way -- chunkByAST always has its own
        // filepath, so relative resolution still fires. This case documents
        // that resolution depends only on chunkByAST's own filepath argument,
        // not on workspaceRoot -- workspaceRoot is only needed for the
        // src-layout *bare*-import case below.
        expect(funcChunk?.metadata.imports).toContain('src/flask/globals');
      });

      it('resolves a bare package import to its src-layout root (flask repro, #901)', async () => {
        await writeFile('src/flask/__init__.py', 'from .app import Flask as Flask\n');

        const content = `import flask

def make_app():
    return flask.Flask(__name__)
`;
        const chunks = chunkByAST('tests/test_config.py', content, { workspaceRoot: testDir });
        const funcChunk = chunks.find(c => c.metadata.symbolName === 'make_app');

        expect(funcChunk?.metadata.imports).toContain('src/flask');
      });

      it('leaves a bare package import unresolved when the project is not src-layout (zero behavior change)', () => {
        const content = `import flask

def make_app():
    return flask.Flask(__name__)
`;
        const chunks = chunkByAST('tests/test_config.py', content, { workspaceRoot: testDir });
        const funcChunk = chunks.find(c => c.metadata.symbolName === 'make_app');

        expect(funcChunk?.metadata.imports).toContain('flask');
      });

      it('leaves a bare package import unresolved when workspaceRoot is omitted (existing callers unaffected)', () => {
        const content = `import flask

def make_app():
    return flask.Flask(__name__)
`;
        const chunks = chunkByAST('tests/test_config.py', content);
        const funcChunk = chunks.find(c => c.metadata.symbolName === 'make_app');

        expect(funcChunk?.metadata.imports).toContain('flask');
      });
    });

    describe('manifest-root mapping (Rust Cargo workspace) — #903', () => {
      let testDir: string;

      beforeEach(async () => {
        testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-chunker-rust-crate-map-'));
      });

      afterEach(async () => {
        clearRustCrateMapCache();
        await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
      });

      async function writeFile(relPath: string, content: string): Promise<void> {
        const abs = path.join(testDir, relPath);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, content);
      }

      async function writeTokioWorkspace(): Promise<void> {
        await writeFile('Cargo.toml', '[workspace]\nmembers = [\n  "tokio",\n  "tokio-util",\n]\n');
        await writeFile('tokio/Cargo.toml', '[package]\nname = "tokio"\nversion = "1.0.0"\n');
        await writeFile(
          'tokio-util/Cargo.toml',
          '[package]\nname = "tokio-util"\nversion = "0.7.0"\n',
        );
      }

      it('resolves a sibling workspace-crate import from an integration test (tokio-util repro from #903)', async () => {
        await writeTokioWorkspace();

        const content = `use tokio_util::codec::Framed;

#[test]
fn framed_codec_roundtrips() {
    assert!(true);
}
`;

        const chunks = chunkByAST('tokio/tests/codec.rs', content, { workspaceRoot: testDir });
        const funcChunk = chunks.find(c => c.metadata.symbolName === 'framed_codec_roundtrips');

        expect(funcChunk?.metadata.imports).toContain('tokio-util/src/codec/Framed');
      });

      it('leaves a genuinely external crate import unresolved even with a workspace crate map present', async () => {
        await writeTokioWorkspace();

        const content = `use futures::stream::StreamExt;

#[test]
fn uses_futures() {
    assert!(true);
}
`;

        const chunks = chunkByAST('tokio/tests/stream.rs', content, { workspaceRoot: testDir });
        const funcChunk = chunks.find(c => c.metadata.symbolName === 'uses_futures');

        // No workspace member named "futures" — must stay dropped, exactly as
        // it was before this fix (no guessing, #868 precedent).
        expect(funcChunk?.metadata.imports).toEqual([]);
      });

      it('leaves Rust imports dropped when there is no Cargo.toml (zero behavior change)', () => {
        const content = `use tokio_util::codec::Framed;

#[test]
fn framed_codec_roundtrips() {
    assert!(true);
}
`;

        const chunks = chunkByAST('tokio/tests/codec.rs', content, { workspaceRoot: testDir });
        const funcChunk = chunks.find(c => c.metadata.symbolName === 'framed_codec_roundtrips');

        expect(funcChunk?.metadata.imports).toEqual([]);
      });

      it('is a no-op for Rust when workspaceRoot is omitted (existing callers unaffected)', () => {
        const content = `use tokio_util::codec::Framed;

#[test]
fn framed_codec_roundtrips() {
    assert!(true);
}
`;

        const chunks = chunkByAST('tokio/tests/codec.rs', content);
        const funcChunk = chunks.find(c => c.metadata.symbolName === 'framed_codec_roundtrips');

        expect(funcChunk?.metadata.imports).toEqual([]);
      });

      it('still resolves plain crate::-relative imports the same way alongside a populated crate map', async () => {
        await writeTokioWorkspace();

        const content = `use crate::runtime::Handle;

fn get_handle() -> Handle {
    todo!()
}
`;

        const chunks = chunkByAST('tokio/src/lib.rs', content, { workspaceRoot: testDir });
        const funcChunk = chunks.find(c => c.metadata.symbolName === 'get_handle');

        expect(funcChunk?.metadata.imports).toContain('runtime/Handle');
      });
    });

    describe('PHP FQCN-reference scanning composed with PSR-4 (#878)', () => {
      let testDir: string;

      beforeEach(async () => {
        testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-chunker-fqcn-refs-'));
      });

      afterEach(async () => {
        clearPsr4Cache();
        await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
      });

      it('resolves a fully-qualified reference through the PSR-4 map, with no `use` import present', async () => {
        await fs.mkdir(testDir, { recursive: true });
        await fs.writeFile(
          path.join(testDir, 'composer.json'),
          JSON.stringify({ autoload: { 'psr-4': { 'GuzzleHttp\\': 'src/' } } }, null, 2),
        );

        // Deliberately no `use GuzzleHttp\RetryMiddleware;` -- the whole point
        // of #878 is that this reference has none.
        const content = `<?php
use PHPUnit\\Framework\\TestCase;

class RetryMiddlewareTest extends TestCase {
  public function testRetry() {
    $x = new \\GuzzleHttp\\RetryMiddleware($decider, $handler);
  }
}
?>`;

        const chunks = chunkByAST('tests/RetryMiddlewareTest.php', content, {
          workspaceRoot: testDir,
        });
        const methodChunk = chunks.find(c => c.metadata.symbolName === 'testRetry');

        expect(methodChunk?.metadata.imports).toContain('src/RetryMiddleware');
      });

      it('is a no-op for a plain bare `use`-only file (zero behavior change)', () => {
        const content = `<?php
use GuzzleHttp\\Cookie\\SetCookie;

class SetCookieTest {
  public function testFoo() {
    return new SetCookie();
  }
}
?>`;

        const chunks = chunkByAST('tests/Cookie/SetCookieTest.php', content, {
          workspaceRoot: testDir,
        });
        const methodChunk = chunks.find(c => c.metadata.symbolName === 'testFoo');

        expect(methodChunk?.metadata.imports).toEqual(['GuzzleHttp\\Cookie\\SetCookie']);
      });
    });

    describe('PHP require/include static-target resolution (#1009)', () => {
      let testDir: string;

      beforeEach(async () => {
        testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-chunker-php-require-'));
      });

      afterEach(async () => {
        await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
      });

      async function writeFile(relPath: string, content: string): Promise<void> {
        const abs = path.join(testDir, relPath);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, content);
      }

      it('resolves a `__DIR__`-relative require to a real sibling file (Composer autoloader bootstrap repro)', async () => {
        await writeFile('vendor/autoload.php', '<?php\n');

        const content = `<?php
require __DIR__ . '/../vendor/autoload.php';

function bootstrap() {
  return true;
}
`;
        const chunks = chunkByAST('tests/bootstrap.php', content, { workspaceRoot: testDir });
        const funcChunk = chunks.find(c => c.metadata.symbolName === 'bootstrap');

        expect(funcChunk?.metadata.imports).toContain('vendor/autoload.php');
      });

      it('resolves a plain string literal require relative to the containing file (no `__DIR__`)', async () => {
        await writeFile('includes/foo.php', '<?php\n');

        const content = `<?php
require_once 'includes/foo.php';

function bootstrap() {
  return true;
}
`;
        const chunks = chunkByAST('index.php', content, { workspaceRoot: testDir });
        const funcChunk = chunks.find(c => c.metadata.symbolName === 'bootstrap');

        expect(funcChunk?.metadata.imports).toContain('includes/foo.php');
      });

      it('drops a statically-resolvable-looking require whose target does not exist on disk (never fabricate an edge, #928/#1008/#1056)', () => {
        // Regression guard for the existence check itself, not the
        // require/include feature as a whole: `testDir` is empty here (no
        // `vendor/autoload.php` written), so a naive "resolve without
        // checking disk" implementation would wrongly include this edge. The
        // two positive tests above are what actually fails against pre-#1009
        // code (which produced zero require/include edges at all).
        const content = `<?php
require __DIR__ . '/../vendor/autoload.php';

function bootstrap() {
  return true;
}
`;
        const chunks = chunkByAST('tests/bootstrap.php', content, { workspaceRoot: testDir });
        const funcChunk = chunks.find(c => c.metadata.symbolName === 'bootstrap');

        expect(funcChunk?.metadata.imports ?? []).not.toContain('vendor/autoload.php');
      });

      it('drops every require/include target when workspaceRoot is omitted (no way to verify existence)', async () => {
        await writeFile('vendor/autoload.php', '<?php\n');

        const content = `<?php
require __DIR__ . '/../vendor/autoload.php';

function bootstrap() {
  return true;
}
`;
        const chunks = chunkByAST('tests/bootstrap.php', content);
        const funcChunk = chunks.find(c => c.metadata.symbolName === 'bootstrap');

        expect(funcChunk?.metadata.imports ?? []).not.toContain('vendor/autoload.php');
      });

      it('does not resolve a require target that is not statically decidable (variable, constant, function call)', async () => {
        await writeFile('file.php', '<?php\n');

        const content = `<?php
require $someVariable;
require SOME_CONSTANT . '/file.php';
require foo() . '/file.php';

function bootstrap() {
  return true;
}
`;
        const chunks = chunkByAST('index.php', content, { workspaceRoot: testDir });
        const funcChunk = chunks.find(c => c.metadata.symbolName === 'bootstrap');

        expect(funcChunk?.metadata.imports ?? []).toEqual([]);
      });

      it('still leaves a bare `use` import namespace-resolved via PSR-4 alongside a resolved require (composed, #1002/#1009)', async () => {
        await writeFile(
          'composer.json',
          JSON.stringify({ autoload: { 'psr-4': { 'App\\': 'src/' } } }, null, 2),
        );
        await writeFile('src/Config.php', '<?php\n');
        await writeFile('vendor/autoload.php', '<?php\n');

        const content = `<?php
require __DIR__ . '/../vendor/autoload.php';
use App\\Config;

class Bootstrap {
  public function run() {
    return new Config();
  }
}
`;
        const chunks = chunkByAST('app/Bootstrap.php', content, { workspaceRoot: testDir });
        const methodChunk = chunks.find(c => c.metadata.symbolName === 'run');

        expect(methodChunk?.metadata.imports).toContain('vendor/autoload.php');
        expect(methodChunk?.metadata.imports).toContain('src/Config');
      });
    });

    it('should calculate cyclomatic complexity', () => {
      const content = `
function complexFunction(x: number): string {
  if (x > 10) {
    if (x > 20) {
      return "very high";
    }
    return "high";
  } else if (x > 5) {
    return "medium";
  } else {
    return "low";
  }
}
      `.trim();

      const chunks = chunkByAST('test.ts', content);
      const chunk = chunks.find(c => c.metadata.symbolName === 'complexFunction');

      expect(chunk?.metadata.complexity).toBeGreaterThan(3); // Multiple if statements
    });

    it('should handle multiple functions in one file', () => {
      const content = `
function first() {
  return 1;
}

function second() {
  return 2;
}

function third() {
  return 3;
}
      `.trim();

      const chunks = chunkByAST('test.ts', content);

      expect(chunks.length).toBeGreaterThanOrEqual(3);
      expect(chunks.some(c => c.metadata.symbolName === 'first')).toBe(true);
      expect(chunks.some(c => c.metadata.symbolName === 'second')).toBe(true);
      expect(chunks.some(c => c.metadata.symbolName === 'third')).toBe(true);
    });

    it('should handle empty files gracefully', () => {
      const content = '';
      const chunks = chunkByAST('test.ts', content);

      // Empty file should produce no chunks or minimal chunks
      expect(chunks.length).toBeGreaterThanOrEqual(0);
    });

    it('should preserve line numbers correctly', () => {
      const content = `
// Line 1
// Line 2
function test() {
  // Line 4
  return true;
}
      `.trim();

      const chunks = chunkByAST('test.ts', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'test');

      expect(funcChunk).toBeDefined();
      expect(funcChunk!.metadata.startLine).toBeGreaterThan(0);
      expect(funcChunk!.metadata.endLine).toBeGreaterThan(funcChunk!.metadata.startLine);
    });

    it('should handle JavaScript files', () => {
      const content = `
function add(a, b) {
  return a + b;
}
      `.trim();

      const chunks = chunkByAST('test.js', content);
      const chunk = chunks.find(c => c.metadata.symbolName === 'add');

      expect(chunk).toBeDefined();
      expect(chunk?.metadata.language).toBe('javascript');
    });

    it('should handle exported functions', () => {
      const content = `
export function exportedFunc() {
  return "exported";
}

export default function defaultFunc() {
  return "default";
}
      `.trim();

      const chunks = chunkByAST('test.ts', content);

      expect(chunks.some(c => c.metadata.symbolName === 'exportedFunc')).toBe(true);
      expect(chunks.some(c => c.metadata.symbolName === 'defaultFunc')).toBe(true);
    });
  });

  describe('PHP support', () => {
    it('should chunk PHP functions', () => {
      const content = `<?php

function validateEmail($email) {
  if (empty($email)) {
    return false;
  }
  return filter_var($email, FILTER_VALIDATE_EMAIL);
}

function formatUserData($user) {
  return [
    'id' => $user->id,
    'name' => $user->name
  ];
}
?>`;

      const chunks = chunkByAST('test.php', content);

      const validateChunk = chunks.find(c => c.metadata.symbolName === 'validateEmail');
      expect(validateChunk).toBeDefined();
      expect(validateChunk?.metadata.symbolType).toBe('function');
      expect(validateChunk?.metadata.language).toBe('php');

      const formatChunk = chunks.find(c => c.metadata.symbolName === 'formatUserData');
      expect(formatChunk).toBeDefined();
      expect(formatChunk?.metadata.symbolType).toBe('function');
    });

    it('should chunk PHP class methods', () => {
      const content = `<?php

class UserController {
  private $database;
  
  public function __construct($db) {
    $this->database = $db;
  }
  
  public function getUserById($id) {
    if (!is_numeric($id)) {
      throw new InvalidArgumentException('ID must be numeric');
    }
    return $this->database->find($id);
  }
  
  public function createUser($username, $email) {
    return $this->database->insert([
      'username' => $username,
      'email' => $email
    ]);
  }
}
?>`;

      const chunks = chunkByAST('test.php', content);

      // Should have a class chunk
      const classChunk = chunks.find(c => c.metadata.symbolName === 'UserController');
      expect(classChunk).toBeDefined();
      expect(classChunk?.metadata.symbolType).toBe('class');

      // Should have chunks for each method
      const constructorChunk = chunks.find(c => c.metadata.symbolName === '__construct');
      expect(constructorChunk).toBeDefined();
      expect(constructorChunk?.metadata.symbolType).toBe('method');
      expect(constructorChunk?.metadata.parentClass).toBe('UserController');

      const getByIdChunk = chunks.find(c => c.metadata.symbolName === 'getUserById');
      expect(getByIdChunk).toBeDefined();
      expect(getByIdChunk?.metadata.symbolType).toBe('method');
      expect(getByIdChunk?.metadata.parentClass).toBe('UserController');

      const createChunk = chunks.find(c => c.metadata.symbolName === 'createUser');
      expect(createChunk).toBeDefined();
      expect(createChunk?.metadata.symbolType).toBe('method');
      expect(createChunk?.metadata.parentClass).toBe('UserController');
    });

    it('should calculate complexity for PHP control structures', () => {
      const content = `<?php

function processUsers($users) {
  foreach ($users as $user) {
    if ($user->active) {
      if ($user->verified) {
        echo $user->name;
      }
    }
  }
}
?>`;

      const chunks = chunkByAST('test.php', content);
      const chunk = chunks.find(c => c.metadata.symbolName === 'processUsers');

      expect(chunk).toBeDefined();
      expect(chunk?.metadata.complexity).toBeGreaterThan(1);
      // Should count foreach (1) + if (2) + nested if (3) = base(1) + 3 = 4
      expect(chunk?.metadata.complexity).toBeGreaterThanOrEqual(4);
    });

    it('should require PHP opening tag', () => {
      // PHP files need <?php tag for tree-sitter-php to parse correctly
      const contentWithoutTag = `
function test() {
  return true;
}
      `.trim();

      const chunks = chunkByAST('test.php', contentWithoutTag);

      // Without <?php tag, tree-sitter-php may not parse correctly
      // This is expected behavior - valid PHP files should have the tag
      expect(chunks.length).toBeGreaterThanOrEqual(0);

      // With proper tag, should parse correctly
      const contentWithTag = `<?php
function test() {
  return true;
}
?>`;

      const chunksWithTag = chunkByAST('test.php', contentWithTag);
      expect(chunksWithTag.length).toBeGreaterThan(0);
      expect(chunksWithTag.some(c => c.metadata.symbolName === 'test')).toBe(true);
    });

    it('should handle PHP traits', () => {
      const content = `<?php

trait Timestampable {
  public function getCreatedAt() {
    return $this->created_at;
  }
  
  public function getUpdatedAt() {
    return $this->updated_at;
  }
}
?>`;

      const chunks = chunkByAST('test.php', content);

      // Should extract methods from trait
      const createdChunk = chunks.find(c => c.metadata.symbolName === 'getCreatedAt');
      expect(createdChunk).toBeDefined();
      expect(createdChunk?.metadata.symbolType).toBe('method');
      expect(createdChunk?.metadata.parentClass).toBe('Timestampable');
    });

    it('should extract PHP function metadata', () => {
      const content = `<?php

function calculateTotal($items) {
  $total = 0;
  foreach ($items as $item) {
    $total += $item->price;
  }
  return $total;
}
?>`;

      const chunks = chunkByAST('test.php', content);
      const chunk = chunks.find(c => c.metadata.symbolName === 'calculateTotal');

      expect(chunk).toBeDefined();
      expect(chunk?.metadata.symbolName).toBe('calculateTotal');
      expect(chunk?.metadata.symbolType).toBe('function');
      expect(chunk?.metadata.parameters).toBeDefined();
      expect(chunk?.metadata.signature).toContain('calculateTotal');
      expect(chunk?.metadata.complexity).toBeGreaterThan(1); // Has foreach
    });

    it('should handle multiple PHP functions in one file', () => {
      const content = `<?php

function first() {
  return 1;
}

function second() {
  return 2;
}

function third() {
  return 3;
}
?>`;

      const chunks = chunkByAST('test.php', content);

      expect(chunks.length).toBeGreaterThanOrEqual(3);
      expect(chunks.some(c => c.metadata.symbolName === 'first')).toBe(true);
      expect(chunks.some(c => c.metadata.symbolName === 'second')).toBe(true);
      expect(chunks.some(c => c.metadata.symbolName === 'third')).toBe(true);
    });
  });

  describe('barrel/re-export files', () => {
    it('should produce at least one chunk for barrel files with only re-exports', () => {
      const content = `export { foo } from './foo';
export { bar, baz } from './bar';
export { default as qux } from './qux';`;

      const chunks = chunkByAST('index.ts', content);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].metadata.type).toBe('block');
      expect(chunks[0].metadata.exports).toBeDefined();
      expect(chunks[0].metadata.exports!.length).toBeGreaterThan(0);
      expect(chunks[0].content).toContain('export');
    });

    it('should produce a chunk for a single re-export', () => {
      const content = `export { foo } from './foo';`;

      const chunks = chunkByAST('index.ts', content);

      expect(chunks.length).toBe(1);
      expect(chunks[0].metadata.exports).toBeDefined();
      expect(chunks[0].content).toBe("export { foo } from './foo';");
    });
  });

  describe('small files with no recognized top-level node (#772)', () => {
    // production's chunkFile() computes minChunkSize = Math.floor(chunkSize / 10)
    // with the default chunkSize of 75, i.e. 7 -- passed explicitly here so
    // these tests pin the exact boundary hit during real indexing, independent
    // of chunkByAST's own bare default (5).
    const PROD_MIN_CHUNK_SIZE = 7;

    it('should produce a chunk for a small file containing only a bare test() call', () => {
      // The exact shape that was silently dropped during PR #772's dogfood:
      // a bare top-level call expression is not a recognized top-level node
      // (not a function/class/interface/variable declaration), so the whole
      // file used to fall through to the minChunkSize-filtered "uncovered
      // code" path and vanish -- no chunk, no manifest entry, no error.
      const content = `import { test, expect } from 'vitest';

test('does something', () => {
  expect(1).toBe(1);
});`;

      const chunks = chunkByAST('tiny.test.ts', content, { minChunkSize: PROD_MIN_CHUNK_SIZE });

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some(c => c.content.includes("test('does something'"))).toBe(true);
    });

    it('should produce a chunk for a small single-function file', () => {
      const content = `export function foo() {
  return 1;
}`;

      const chunks = chunkByAST('foo.ts', content, { minChunkSize: PROD_MIN_CHUNK_SIZE });

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some(c => c.metadata.symbolName === 'foo')).toBe(true);
    });

    it('should produce a chunk for a 1-line export', () => {
      const content = 'export const foo = 1;';

      const chunks = chunkByAST('foo.ts', content, { minChunkSize: PROD_MIN_CHUNK_SIZE });

      expect(chunks.length).toBe(1);
      expect(chunks[0].content).toBe(content);
    });

    it('should still produce no chunks for an empty file', () => {
      const chunks = chunkByAST('empty.ts', '', { minChunkSize: PROD_MIN_CHUNK_SIZE });

      expect(chunks).toHaveLength(0);
    });

    it('should still produce no chunks for a whitespace-only file', () => {
      const content = '   \n\t\n   \n';

      const chunks = chunkByAST('whitespace.ts', content, { minChunkSize: PROD_MIN_CHUNK_SIZE });

      expect(chunks).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('should throw error for unsupported language', () => {
      const content = 'print("Hello")';

      // Scala is not AST-supported
      expect(() => chunkByAST('test.scala', content)).toThrow();
    });

    it('should handle invalid syntax gracefully', () => {
      const content = 'function invalid() { this is not valid }}}';

      // Tree-sitter is resilient and still produces a tree with errors
      // So this should not throw, but return some chunks
      const chunks = chunkByAST('test.ts', content);
      expect(chunks).toBeDefined();
    });
  });
});
