import { afterEach, describe, expect, it } from 'vitest';
import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import Python from 'tree-sitter-python';
import Kotlin from 'tree-sitter-kotlin';
import PHPParser from 'tree-sitter-php';
import Go from 'tree-sitter-go';
import Swift from 'tree-sitter-swift';
import { parseAST } from '../parser.js';
import { chunkByAST } from '../chunker.js';
import { extractExports, extractImports, extractCallSites } from '../symbols.js';
import type { SupportedLanguage } from '../languages/registry.js';

/**
 * Dual-backend equivalence tests for the native compat deserializer
 * (docs/architecture/native-parser.md). "Legacy" trees are built the same
 * way the per-language *.test.ts files do -- direct node-tree-sitter, not
 * through parseAST -- so these tests compare two independent
 * reconstructions of the same underlying grammar's output.
 */

const GRAMMARS: Partial<Record<SupportedLanguage, unknown>> = {
  typescript: TypeScript.typescript,
  python: Python,
  kotlin: Kotlin,
  php: PHPParser.php,
  go: Go,
  swift: Swift,
};

function buildLegacyTree(lang: SupportedLanguage, source: string): Parser.Tree {
  const parser = new Parser();
  parser.setLanguage(GRAMMARS[lang]);
  return parser.parse(source);
}

function buildNativeTree(lang: SupportedLanguage, source: string): Parser.Tree {
  process.env.LIEN_PARSER = 'native';
  try {
    const result = parseAST(source, lang);
    if (!result.tree) throw new Error(`native parse produced no tree: ${result.error}`);
    return result.tree;
  } finally {
    delete process.env.LIEN_PARSER;
  }
}

// Field names actually read via childForFieldName across
// ast/languages/*.ts and ast/extractors/symbol-helpers.ts.
const FIELDS_TO_CHECK = [
  'body',
  'name',
  'parameters',
  'return_type',
  'condition',
  'operator',
  'function',
  'definition',
];

/**
 * Compare one childForFieldName(field) result between backends, including
 * the reference-equality invariant (native-parser.md section 2.5): the
 * field lookup must return the SAME object already in `children` (field
 * targets are not always named), not a fresh reconstruction.
 */
function compareField(
  legacy: Parser.SyntaxNode,
  native: Parser.SyntaxNode,
  field: string,
  path: string,
): void {
  const legacyField = legacy.childForFieldName(field);
  const nativeField = native.childForFieldName(field);

  if (legacyField === null) {
    expect(nativeField, `${path} field "${field}"`).toBeNull();
    return;
  }
  expect(nativeField, `${path} field "${field}"`).not.toBeNull();
  expect(nativeField!.type).toBe(legacyField.type);
  expect(nativeField!.text).toBe(legacyField.text);
  expect(native.children.includes(nativeField!)).toBe(true);
}

function compareNodes(legacy: Parser.SyntaxNode, native: Parser.SyntaxNode, path: string): void {
  expect(native.type).toBe(legacy.type);
  expect(native.isNamed).toBe(legacy.isNamed);
  expect(native.startIndex).toBe(legacy.startIndex);
  expect(native.endIndex).toBe(legacy.endIndex);
  expect(native.startPosition).toEqual(legacy.startPosition);
  expect(native.endPosition).toEqual(legacy.endPosition);
  expect(native.namedChildren.length).toBe(legacy.namedChildren.length);
  expect(native.children.length).toBe(legacy.children.length);

  if (legacy.isNamed) {
    expect(native.text).toBe(legacy.text);
  }

  for (const field of FIELDS_TO_CHECK) {
    compareField(legacy, native, field, path);
  }

  for (let i = 0; i < legacy.children.length; i++) {
    compareNodes(
      legacy.children[i],
      native.children[i],
      `${path}>${legacy.children[i].type}[${i}]`,
    );
  }
}

interface Fixture {
  name: string;
  lang: SupportedLanguage;
  source: string;
}

const TS_SOURCE = `
import { helper } from './helper';

export interface Greeter {
  greet(name: string): string;
}

export class Greeting implements Greeter {
  greet(name: string): string {
    return helper(name);
  }
}
`;

const PYTHON_SOURCE = `import os

def helper(x):
    return x + 1

class Greeter:
    def greet(self, name):
        return helper(name)
`;

const KOTLIN_SOURCE = `import kotlinx.coroutines.delay

class Greeter {
    fun greet(name: String): String {
        return "hello " + name
    }
}
`;

const PHP_SOURCE = `<?php
namespace App;

use App\\Support\\Helper;

class Greeter {
    public function greet($name) {
        return Helper::format($name);
    }
}
`;

// Regression fixture for the native-backend defect where every Swift
// function/method/subscript with an explicit `-> Type` annotation lost
// `metadata.returnType`: tree-sitter-swift's grammar nests field() calls
// around a shared hidden rule (e.g. `field("return_type", field("name",
// $._type))`), so the return-type node carries two field names, but
// TreeCursor::field_name() -- what the wire's `field` key used -- only
// surfaces one of them. Covers a protocol's abstract method (no body), a
// concrete method, an initializer (no return type, must stay unaffected),
// and a subscript -- all four productions double-tag the same way per
// tree-sitter-swift's grammar.js.
const SWIFT_SOURCE = `
protocol Greeting {
    func message() -> String
}

class Greeter: Greeting {
    private let name: String

    init(name: String) {
        self.name = name
    }

    func message() -> String {
        return "hello " + name
    }

    func add(a: Int, b: Int) -> Int {
        return a + b
    }

    subscript(index: Int) -> String {
        return message()
    }
}
`;

const FIXTURES: Fixture[] = [
  { name: 'typescript basic', lang: 'typescript', source: TS_SOURCE },
  { name: 'python basic', lang: 'python', source: PYTHON_SOURCE },
  { name: 'kotlin basic', lang: 'kotlin', source: KOTLIN_SOURCE },
  { name: 'php basic (multi-grammar)', lang: 'php', source: PHP_SOURCE },
  {
    name: 'swift (protocol method + method + init + subscript, explicit return types)',
    lang: 'swift',
    source: SWIFT_SOURCE,
  },
  {
    name: 'non-ascii (accents + emoji)',
    lang: 'typescript',
    source: 'const café = "🎉world";\n',
  },
  {
    name: 'CRLF line endings',
    lang: 'typescript',
    source: 'function foo() {\r\n  return 1;\r\n}\r\n',
  },
  { name: 'empty file', lang: 'typescript', source: '' },
  { name: 'syntax error', lang: 'typescript', source: 'function foo(' },
  { name: 'isMissing (unclosed Go parameter list)', lang: 'go', source: 'func foo(' },
];

describe('native compat deserializer: dual-backend equivalence', () => {
  afterEach(() => {
    delete process.env.LIEN_PARSER;
  });

  describe.each(FIXTURES)('$name', ({ lang, source }) => {
    it('produces a structurally identical tree to legacy node-tree-sitter', () => {
      const legacyTree = buildLegacyTree(lang, source);
      const nativeTree = buildNativeTree(lang, source);
      expect(nativeTree.rootNode.hasError).toBe(legacyTree.rootNode.hasError);
      compareNodes(legacyTree.rootNode, nativeTree.rootNode, lang);
    });
  });
});

describe('native compat deserializer: isMissing round-trip', () => {
  afterEach(() => {
    delete process.env.LIEN_PARSER;
  });

  it('round-trips a genuine MISSING node (Go unclosed parameter list)', () => {
    const nativeTree = buildNativeTree('go', 'func foo(');
    expect(nativeTree.rootNode.hasError).toBe(true);

    function findMissing(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
      if (node.isMissing) return node;
      for (const child of node.children) {
        const found = findMissing(child);
        if (found) return found;
      }
      return null;
    }

    const missing = findMissing(nativeTree.rootNode);
    expect(missing).not.toBeNull();
    expect(missing!.type).toBe(')');
    expect(missing!.startIndex).toBe(missing!.endIndex);
  });
});

describe('native compat deserializer: real extractor parity', () => {
  afterEach(() => {
    delete process.env.LIEN_PARSER;
  });

  it('extractExports matches between backends (typescript)', () => {
    const legacyRoot = buildLegacyTree('typescript', TS_SOURCE).rootNode;
    const nativeRoot = buildNativeTree('typescript', TS_SOURCE).rootNode;
    expect(extractExports(nativeRoot, 'typescript')).toEqual(
      extractExports(legacyRoot, 'typescript'),
    );
  });

  it('extractImports matches between backends (typescript)', () => {
    const legacyRoot = buildLegacyTree('typescript', TS_SOURCE).rootNode;
    const nativeRoot = buildNativeTree('typescript', TS_SOURCE).rootNode;
    expect(extractImports(nativeRoot, 'typescript')).toEqual(
      extractImports(legacyRoot, 'typescript'),
    );
  });

  it('extractCallSites matches between backends (python)', () => {
    const legacyRoot = buildLegacyTree('python', PYTHON_SOURCE).rootNode;
    const nativeRoot = buildNativeTree('python', PYTHON_SOURCE).rootNode;
    expect(extractCallSites(nativeRoot, 'python')).toEqual(extractCallSites(legacyRoot, 'python'));
  });

  it('chunkByAST matches end-to-end between backends (typescript)', () => {
    delete process.env.LIEN_PARSER;
    const legacyChunks = chunkByAST('greeter.ts', TS_SOURCE);
    process.env.LIEN_PARSER = 'native';
    const nativeChunks = chunkByAST('greeter.ts', TS_SOURCE);
    expect(nativeChunks).toEqual(legacyChunks);
  });

  it('chunkByAST matches end-to-end between backends (swift), including returnType', () => {
    delete process.env.LIEN_PARSER;
    const legacyChunks = chunkByAST('greeter.swift', SWIFT_SOURCE);
    process.env.LIEN_PARSER = 'native';
    const nativeChunks = chunkByAST('greeter.swift', SWIFT_SOURCE);
    expect(nativeChunks).toEqual(legacyChunks);

    // Guard against a vacuous pass: assert the fixture actually exercises
    // returnType extraction on both sides, so a future regression that
    // silently dropped returnType from *both* backends wouldn't slip
    // through toEqual() alone.
    const returnTypes = legacyChunks.map(c => c.metadata.returnType).filter(Boolean);
    expect(returnTypes).toEqual(['String', 'String', 'Int', 'String']);
  });
});

// resolveParserBackend()/isBackendUnset() unit tests live in ../backend.test.ts.
