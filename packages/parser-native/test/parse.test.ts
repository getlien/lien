import { describe, it, expect } from 'vitest';
import { parseTree } from '../index.js';
import type { WireNode } from '../index.js';

interface LanguageCase {
  lang: string;
  rootType: string;
  valid: string;
  broken: string;
}

// One valid + one syntactically broken snippet per supported language, plus
// the expected root node type. Ids must match
// packages/parser/src/ast/languages/registry.ts's LANGUAGE_IDS exactly.
const LANGUAGE_CASES: LanguageCase[] = [
  {
    lang: 'typescript',
    rootType: 'program',
    valid: 'function add(a: number, b: number): number { return a + b; }',
    broken: 'function foo(',
  },
  {
    lang: 'javascript',
    rootType: 'program',
    valid: 'function add(a, b) { return a + b; }',
    broken: 'function foo(',
  },
  {
    lang: 'php',
    rootType: 'program',
    valid: '<?php function add($a, $b) { return $a + $b; }',
    broken: '<?php function foo(',
  },
  {
    lang: 'python',
    rootType: 'module',
    valid: 'def add(a, b):\n    return a + b\n',
    broken: 'def foo(\n',
  },
  {
    lang: 'rust',
    rootType: 'source_file',
    valid: 'fn add(a: i32, b: i32) -> i32 { a + b }',
    broken: 'fn foo(',
  },
  {
    lang: 'go',
    rootType: 'source_file',
    valid: 'package main\nfunc add(a int, b int) int { return a + b }',
    broken: 'func foo(',
  },
  {
    lang: 'java',
    rootType: 'program',
    valid: 'class Foo { int add(int a, int b) { return a + b; } }',
    broken: 'class Foo {',
  },
  {
    lang: 'csharp',
    rootType: 'compilation_unit',
    valid: 'class Foo { int Add(int a, int b) { return a + b; } }',
    broken: 'class Foo {',
  },
  {
    lang: 'ruby',
    rootType: 'program',
    valid: 'def add(a, b)\n  a + b\nend\n',
    broken: 'def foo(',
  },
  {
    lang: 'kotlin',
    rootType: 'source_file',
    valid: 'fun add(a: Int, b: Int): Int { return a + b }',
    broken: 'fun foo(',
  },
  {
    lang: 'swift',
    rootType: 'source_file',
    valid: 'func add(a: Int, b: Int) -> Int { return a + b }',
    broken: 'func foo(',
  },
];

function findByPredicate(node: WireNode, predicate: (n: WireNode) => boolean): WireNode | null {
  if (predicate(node)) return node;
  for (const child of node.children) {
    const found = findByPredicate(child, predicate);
    if (found) return found;
  }
  return null;
}

describe('parseTree', () => {
  describe.each(LANGUAGE_CASES)('$lang', ({ lang, rootType, valid, broken }) => {
    it('parses valid source with no error', () => {
      const wire: WireNode = JSON.parse(parseTree(lang, valid));
      expect(wire.type).toBe(rootType);
      // Omitted-default encoding: hasError absent means false -- assert
      // absence, not just falsiness, so a stray `"hasError":false` emission
      // (a spec violation) would also fail this.
      expect(wire.hasError).toBeUndefined();
      expect(Array.isArray(wire.children)).toBe(true);
    });

    it('sets hasError on the root for broken source', () => {
      const wire: WireNode = JSON.parse(parseTree(lang, broken));
      expect(wire.hasError).toBe(true);
    });
  });

  describe('isMissing round-trip', () => {
    // ADR-013 open question #1 / native-parser.md §5.1: isMissing was frozen
    // into the wire shape unproven -- the original empirical test (a broken
    // JS object literal) recovered via ERROR nodes, never MISSING. Tried
    // here across 11 languages x 2-5 constructs each (unclosed paren/brace,
    // unclosed string, incomplete if/else, incomplete class/interface/func
    // signature -- 26 constructs total, reproduced via a scratch script
    // against packages/parser's own tree-sitter + grammar devDependencies
    // before writing this fixture). Three constructs genuinely produced a
    // MISSING node: TypeScript `interface X {` (MISSING `}`), Java
    // `class Foo {` (MISSING `}`), and Go `func foo(` (MISSING `)`) -- the
    // canonical one asserted below.
    it('produces a genuine MISSING node for an unclosed Go parameter list', () => {
      const wire: WireNode = JSON.parse(parseTree('go', 'func foo('));
      expect(wire.hasError).toBe(true);

      const missingNode = findByPredicate(wire, n => n.isMissing === true);
      expect(missingNode).not.toBeNull();
      expect(missingNode?.type).toBe(')');
      // Missing tokens are zero-width: tree-sitter reports the same
      // start/end position for the inserted virtual token.
      expect(missingNode?.startIndex).toBe(missingNode?.endIndex);
    });
  });

  describe('byte-offset semantics', () => {
    it('reports startIndex/endIndex as UTF-8 byte offsets, not UTF-16 code-unit offsets', () => {
      // "café" (é = 2 UTF-8 bytes, 1 UTF-16 unit) precedes the string, and
      // the string itself contains an astral-plane emoji (4 UTF-8 bytes, 2
      // UTF-16 units) -- a UTF-16-offset bug would diverge from the correct
      // byte offset at both points.
      const source = 'const café = "🎉world";\n';
      const wire: WireNode = JSON.parse(parseTree('javascript', source));

      expect(wire.hasError).toBeUndefined();

      const stringNode = findByPredicate(wire, n => n.type === 'string');
      expect(stringNode).not.toBeNull();

      const literal = '"🎉world"';
      const utf16Index = source.indexOf(literal);
      expect(utf16Index).toBeGreaterThan(-1);

      const expectedStart = Buffer.byteLength(source.slice(0, utf16Index), 'utf8');
      const expectedEnd = expectedStart + Buffer.byteLength(literal, 'utf8');

      expect(stringNode?.startIndex).toBe(expectedStart);
      expect(stringNode?.endIndex).toBe(expectedEnd);

      // Sanity check that this fixture actually exercises multi-byte UTF-8:
      // if these were equal, the test would be vacuous.
      expect(Buffer.byteLength(source, 'utf8')).not.toBe(source.length);
    });
  });

  describe('unknown language', () => {
    it('throws an error naming the valid language ids', () => {
      expect(() => parseTree('elixir', 'anything')).toThrowError(/unsupported language/i);
      try {
        parseTree('elixir', 'anything');
        expect.unreachable('parseTree should have thrown for an unsupported language');
      } catch (err) {
        const message = (err as Error).message;
        expect(message).toContain('elixir');
        for (const { lang } of LANGUAGE_CASES) {
          expect(message).toContain(lang);
        }
      }
    });
  });
});
