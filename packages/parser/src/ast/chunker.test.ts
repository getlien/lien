import { describe, it, expect } from 'vitest';
import { chunkByAST, shouldUseAST } from './chunker.js';

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

    it('should return false for unsupported files', () => {
      expect(shouldUseAST('test.go')).toBe(false);
      expect(shouldUseAST('test.rb')).toBe(false);
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

    it('should extract imports', () => {
      const content = `
import { foo } from './foo';
import { bar } from './bar';

function test() {
  return foo() + bar();
}
      `.trim();

      const chunks = chunkByAST('test.ts', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'test');

      expect(funcChunk?.metadata.imports).toBeDefined();
      expect(funcChunk?.metadata.imports).toContain('./foo');
      expect(funcChunk?.metadata.imports).toContain('./bar');
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

  describe('error handling', () => {
    it('should throw error for unsupported language', () => {
      const content = 'puts "Hello"';

      // Ruby is not yet supported
      expect(() => chunkByAST('test.rb', content)).toThrow();
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
