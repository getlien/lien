import { describe, it, expect } from 'vitest';
import { mustParse } from '../test/helpers/parse-fixture.js';
import type { SyntaxNode } from '../types.js';
import type { SupportedLanguage } from './registry.js';
import type { LanguageSymbolExtractor } from '../extractors/types.js';
import { CSharpSymbolExtractor } from './csharp.js';
import { JavaSymbolExtractor } from './java.js';
import { KotlinSymbolExtractor } from './kotlin.js';
import { SwiftSymbolExtractor } from './swift.js';
import { TypeScriptSymbolExtractor } from './javascript.js';
import { PythonSymbolExtractor } from './python.js';
import { PHPSymbolExtractor } from './php.js';
import { GoSymbolExtractor } from './go.js';
import { RubySymbolExtractor } from './ruby.js';

/**
 * Cross-language regression test for #976 (#965 recurring).
 *
 * Six languages (C#, Java, Kotlin, Swift, JS/TS, and Rust for impl/trait
 * blocks) independently grew a `typeParamsAndX`-shaped helper so that a type
 * declaration's `signature` carries its generic type parameters and
 * heritage clause (base class / interface list), not just its bare keyword
 * and name. Their doc comments explicitly cross-reference each other
 * (java.ts:529 calls itself "the Java analog of C#'s typeParamsAndBaseList")
 * — six files independently documenting that they implement the same rule
 * is the clearest possible signal the RULE should be asserted once, even
 * though the grammar-specific extraction stays per-language. #976 then
 * found the rule had never been applied to Python, PHP, or Go.
 *
 * This table is that single assertion: for every language whose type-level
 * symbol extractor exists, a declaration exercising whichever of
 * {generics, heritage} that language's grammar supports must round-trip
 * into `signature` — not just the bare `<keyword> <name>`. A 10th language
 * that copies the bare-keyword-and-name shape without reading this file
 * will fail here immediately, the same way Python/PHP/Go's gaps would have
 * been caught immediately had this table existed before #965.
 *
 * Rust is deliberately excluded: `struct_item`/`enum_item` aren't
 * symbol-extracted at all yet (only `impl_item`/`trait_item`, via
 * `extractImplInfo` — a different shape, since Rust's generics/heritage
 * live on the `impl`/`trait` block, not a type declaration keyword). That
 * gap is bigger and different in kind, and is tracked separately, not fixed
 * here.
 */

function findNode(node: SyntaxNode, type: string): SyntaxNode | null {
  if (node.type === type) return node;
  for (const child of node.namedChildren) {
    const found = findNode(child, type);
    if (found) return found;
  }
  return null;
}

interface TypeSignatureCase {
  language: SupportedLanguage;
  extractor: LanguageSymbolExtractor;
  nodeType: string;
  code: string;
  expectedSignature: string;
  covers: string;
}

const cases: TypeSignatureCase[] = [
  {
    language: 'csharp',
    extractor: new CSharpSymbolExtractor(),
    nodeType: 'class_declaration',
    code: 'public class Constrained<T> : Base where T : class, new() {}',
    expectedSignature: 'class Constrained<T> : Base',
    covers: 'generics + base list',
  },
  {
    language: 'java',
    extractor: new JavaSymbolExtractor(),
    nodeType: 'class_declaration',
    code: 'class Foo<T extends Comparable<T>> extends Bar<T> implements Baz, Qux {}',
    expectedSignature: 'class Foo<T extends Comparable<T>> extends Bar<T> implements Baz, Qux',
    covers: 'generics + extends/implements',
  },
  {
    language: 'kotlin',
    extractor: new KotlinSymbolExtractor(),
    nodeType: 'class_declaration',
    code: 'class Foo<T> : Bar<T>(), Baz',
    expectedSignature: 'class Foo<T> : Bar<T>(), Baz',
    covers: 'generics + supertypes',
  },
  {
    language: 'swift',
    extractor: new SwiftSymbolExtractor(),
    nodeType: 'class_declaration',
    code: 'class Foo<T>: Bar, Baz {}',
    expectedSignature: 'class Foo<T>: Bar, Baz',
    covers: 'generics + inheritance clause',
  },
  {
    language: 'typescript',
    extractor: new TypeScriptSymbolExtractor(),
    nodeType: 'class_declaration',
    code: 'class Foo<T> extends Bar<T> implements Baz, Qux {}',
    expectedSignature: 'class Foo<T> extends Bar<T> implements Baz, Qux',
    covers: 'generics + extends/implements',
  },
  {
    // #976: signature was `class Dog`, dropping `[T]` and `(Base, Serializable)`.
    language: 'python',
    extractor: new PythonSymbolExtractor(),
    nodeType: 'class_definition',
    code: 'class Box[T](Base, Serializable):\n    pass\n',
    expectedSignature: 'class Box[T](Base, Serializable)',
    covers: 'generics (PEP 695) + base classes',
  },
  {
    // #976: signature was `class Dog`, dropping `extends Animal implements
    // Serializable` entirely. PHP has no generic type parameters.
    language: 'php',
    extractor: new PHPSymbolExtractor(),
    nodeType: 'class_declaration',
    code: '<?php\nclass Dog extends Animal implements Serializable {}',
    expectedSignature: 'class Dog extends Animal implements Serializable',
    covers: 'heritage only (no generics in PHP)',
  },
  {
    // #976: signature was `type Stack struct`, dropping `[T any]` entirely.
    // Go structs/interfaces have no heritage clause (composition is via
    // embedded fields/interfaces, not extends/implements).
    language: 'go',
    extractor: new GoSymbolExtractor(),
    nodeType: 'type_declaration',
    code: 'package main\ntype Stack[T any] struct { items []T }',
    expectedSignature: 'type Stack[T any] struct',
    covers: 'generics only (no heritage clause in Go)',
  },
  {
    // Already correct pre-#976 — Ruby has no generics, and its superclass
    // handling (`class Dog < Animal`) was never dropped. Included so the
    // table covers every language with a type-level extractor, not just the
    // ones that needed fixing.
    language: 'ruby',
    extractor: new RubySymbolExtractor(),
    nodeType: 'class',
    code: 'class Dog < Animal\nend\n',
    expectedSignature: 'class Dog < Animal',
    covers: 'superclass only (no generics in Ruby)',
  },
];

describe('Cross-language: type declaration signature carries generics + heritage (#976)', () => {
  it.each(cases)(
    '$language ($covers): signature is not just bare keyword + name',
    ({ language, extractor, nodeType, code, expectedSignature }) => {
      const root = mustParse(code, language);
      const node = findNode(root, nodeType);
      expect(node, `expected to find a "${nodeType}" node parsing ${language} fixture`).not.toBe(
        null,
      );

      const symbol = extractor.extractSymbol(node!, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.signature).toBe(expectedSignature);
    },
  );
});
