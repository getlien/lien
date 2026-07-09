import type { SyntaxNode } from '../types.js';
import type { SupportedLanguage } from '../languages/registry.js';

/**
 * Shared fixture sources + golden-node serialization for the compat
 * deserializer's regression tests (compat.test.ts) and its fixture
 * generator (scripts/generate-compat-golden-fixtures.ts). Kept in one place
 * so the sources used to *generate* __fixtures__/*.json are always the same
 * ones used to *verify* against them at test time -- if a source here ever
 * changes, regenerate the fixtures (see that script's header) rather than
 * hand-editing the JSON.
 */

export interface Fixture {
  name: string;
  lang: SupportedLanguage;
  source: string;
}

export const TS_SOURCE = `
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

export const PYTHON_SOURCE = `import os

def helper(x):
    return x + 1

class Greeter:
    def greet(self, name):
        return helper(name)
`;

export const KOTLIN_SOURCE = `import kotlinx.coroutines.delay

class Greeter {
    fun greet(name: String): String {
        return "hello " + name
    }
}
`;

export const PHP_SOURCE = `<?php
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
export const SWIFT_SOURCE = `
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

export const FIXTURES: Fixture[] = [
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

/**
 * Field names actually read via childForFieldName across
 * ast/languages/*.ts and ast/extractors/symbol-helpers.ts.
 */
export const FIELDS_TO_CHECK = [
  'body',
  'name',
  'parameters',
  'return_type',
  'condition',
  'operator',
  'function',
  'definition',
] as const;

export interface GoldenFieldValue {
  type: string;
  text: string;
}

export interface GoldenNode {
  type: string;
  isNamed: boolean;
  startIndex: number;
  endIndex: number;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  namedChildCount: number;
  childCount: number;
  /**
   * Only populated for named LEAF nodes (childCount === 0). A non-leaf
   * node's text is just the concatenation of its descendants' text (already
   * covered by their own entries), and `text` is itself a pure function of
   * (source, startIndex, endIndex) -- capturing it on every node would
   * mostly just re-encode the source string over and over across a deeply
   * nested tree. Leaf text is kept because it's still a real regression
   * guard: a bug in CompatSyntaxNode's UTF-16 slicing (the CRLF / non-ascii
   * fixtures exist specifically to catch that) could shift indices in a
   * self-consistent way that only shows up by comparing actual sliced text.
   */
  text: string | null;
  /** Omitted when every FIELDS_TO_CHECK lookup on this node is null. */
  fields?: Record<string, GoldenFieldValue>;
}

export interface GoldenTree {
  hasError: boolean;
  nodes: GoldenNode[];
}

function toGoldenNode(node: SyntaxNode): GoldenNode {
  const fields: Record<string, GoldenFieldValue> = {};
  for (const field of FIELDS_TO_CHECK) {
    const target = node.childForFieldName(field);
    if (target) fields[field] = { type: target.type, text: target.text };
  }
  const isLeaf = node.children.length === 0;
  return {
    type: node.type,
    isNamed: node.isNamed,
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    startPosition: node.startPosition,
    endPosition: node.endPosition,
    namedChildCount: node.namedChildren.length,
    childCount: node.children.length,
    text: node.isNamed && isLeaf ? node.text : null,
    ...(Object.keys(fields).length > 0 ? { fields } : {}),
  };
}

/**
 * Flattens `root` into a pre-order (DFS over ALL children, named or not --
 * matching the original dual-backend test's traversal) array of
 * GoldenNodes. A flat array keeps the committed JSON fixture reviewable as
 * a simple list rather than a deeply nested tree.
 */
export function flattenTree(root: SyntaxNode): GoldenNode[] {
  const out: GoldenNode[] = [];
  const visit = (node: SyntaxNode): void => {
    out.push(toGoldenNode(node));
    node.children.forEach(visit);
  };
  visit(root);
  return out;
}

export function toGoldenTree(root: SyntaxNode, hasError: boolean): GoldenTree {
  return { hasError, nodes: flattenTree(root) };
}

/**
 * Verifies the childForFieldName reference-equality invariant
 * (native-parser.md section 2.5): a field lookup must return the SAME
 * object already present in `children`, not a fresh reconstruction. This
 * is a native-only structural invariant -- it doesn't depend on any
 * golden/legacy comparison, so it's checked live against the tree under
 * test rather than baked into the fixture JSON.
 *
 * @returns a list of "{path} field \"{field}\"" violation descriptions;
 *   empty means the invariant holds everywhere.
 */
export function findFieldReferenceViolations(root: SyntaxNode, rootPath = 'root'): string[] {
  const violations: string[] = [];
  const visit = (node: SyntaxNode, path: string): void => {
    for (const field of FIELDS_TO_CHECK) {
      const target = node.childForFieldName(field);
      if (target !== null && !node.children.includes(target)) {
        violations.push(`${path} field "${field}"`);
      }
    }
    node.children.forEach((child, i) => visit(child, `${path}>${child.type}[${i}]`));
  };
  visit(root, rootPath);
  return violations;
}
