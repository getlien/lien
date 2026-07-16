import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { chunkByAST, shouldUseAST } from './chunker.js';
import { clearWorkspacePackageCache } from '../workspace-packages.js';

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

    it('should NOT resolve relative-looking specifiers for non-JS/TS languages (#525 scope)', () => {
      // Rust's extractor rewrites `super::utils::helper` as `../utils/helper`
      // as an internal storage convention, not as a filesystem path. Resolving
      // that against the chunk's directory would produce incorrect keys, so
      // the gate in prepareASTContext must keep Rust imports untouched.
      const rustContent = `
use super::utils::helper;

pub fn run() {
    helper();
}
      `.trim();

      const chunks = chunkByAST('crates/app/src/foo.rs', rustContent);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'run');

      expect(funcChunk?.metadata.imports).toBeDefined();
      // The Rust extractor's normalized form stays exactly as-is.
      expect(funcChunk?.metadata.imports).toContain('../utils/helper');
      // Explicitly NOT resolved against crates/app/src/foo.rs.
      expect(funcChunk?.metadata.imports).not.toContain('crates/app/utils/helper');
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
