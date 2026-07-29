import { describe, it, expect } from 'vitest';
import { mustParse } from '../test/helpers/parse-fixture.js';
import type { SyntaxNode } from '../types.js';
import { chunkByAST } from '../chunker.js';
import {
  RustTraverser,
  RustExportExtractor,
  RustImportExtractor,
  RustSymbolExtractor,
} from './rust.js';

describe('Rust Language', () => {
  const traverser = new RustTraverser();
  const exportExtractor = new RustExportExtractor();
  const importExtractor = new RustImportExtractor();
  const symbolExtractor = new RustSymbolExtractor();

  describe('Traverser', () => {
    it('should identify function_item and function_signature_item as target nodes', () => {
      expect(traverser.targetNodeTypes).toContain('function_item');
      expect(traverser.targetNodeTypes).toContain('function_signature_item');
    });

    it('should identify impl_item and trait_item as containers', () => {
      expect(traverser.containerTypes).toContain('impl_item');
      expect(traverser.containerTypes).toContain('trait_item');
    });

    it('should extract children from impl blocks', () => {
      const code = 'impl Foo { fn bar(&self) {} }';
      const root = mustParse(code, 'rust');
      const implNode = root.namedChild(0)!;
      expect(traverser.shouldExtractChildren(implNode)).toBe(true);
    });

    it('should get impl body as container body', () => {
      const code = 'impl Foo { fn bar(&self) {} }';
      const root = mustParse(code, 'rust');
      const implNode = root.namedChild(0)!;
      const body = traverser.getContainerBody(implNode);
      expect(body).not.toBeNull();
      expect(body!.type).toBe('declaration_list');
    });

    it('should traverse source_file root', () => {
      const code = 'fn main() {}';
      const root = mustParse(code, 'rust');
      expect(traverser.shouldTraverseChildren(root)).toBe(true);
    });

    it('should traverse declaration_list nodes', () => {
      const code = 'impl Foo { fn bar(&self) {} }';
      const root = mustParse(code, 'rust');
      const implNode = root.namedChild(0)!;
      const body = implNode.childForFieldName('body')!;
      expect(traverser.shouldTraverseChildren(body)).toBe(true);
    });

    it('should not treat any nodes as declarations with functions', () => {
      const code = 'let x = 42;';
      const root = mustParse(code, 'rust');
      root.namedChildren.forEach(child => {
        expect(traverser.isDeclarationWithFunction(child)).toBe(false);
      });
    });

    it('should find parent impl name for methods', () => {
      const code = 'impl MyStruct { fn my_method(&self) {} }';
      const root = mustParse(code, 'rust');
      const implNode = root.namedChild(0)!;
      const body = implNode.childForFieldName('body')!;
      const funcNode = body.namedChild(0)!;
      expect(traverser.findParentContainerName(funcNode)).toBe('MyStruct');
    });

    it('should find parent trait name for methods', () => {
      const code = 'trait MyTrait { fn required(&self); }';
      const root = mustParse(code, 'rust');
      const traitNode = root.namedChild(0)!;
      const body = traitNode.childForFieldName('body')!;
      const funcNode = body.namedChild(0)!;
      expect(traverser.findParentContainerName(funcNode)).toBe('MyTrait');
    });
  });

  describe('Export Extraction', () => {
    it('should extract pub function exports', () => {
      const code = 'pub fn helper() {}';
      const root = mustParse(code, 'rust');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toEqual(['helper']);
    });

    it('should extract pub struct exports', () => {
      const code = 'pub struct User { name: String }';
      const root = mustParse(code, 'rust');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toEqual(['User']);
    });

    it('should extract pub enum exports', () => {
      const code = 'pub enum Status { Active, Inactive }';
      const root = mustParse(code, 'rust');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toEqual(['Status']);
    });

    it('should extract pub trait exports', () => {
      const code = 'pub trait Serialize { fn serialize(&self) -> String; }';
      const root = mustParse(code, 'rust');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toEqual(['Serialize']);
    });

    it('should not export private items', () => {
      const code = 'fn private_helper() {}';
      const root = mustParse(code, 'rust');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toEqual([]);
    });

    it('should extract pub use re-exports', () => {
      const code = 'pub use crate::auth::AuthService;';
      const root = mustParse(code, 'rust');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toEqual(['AuthService']);
    });

    it('should extract pub use list re-exports', () => {
      const code = 'pub use crate::auth::{AuthService, AuthError};';
      const root = mustParse(code, 'rust');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toContain('AuthService');
      expect(exports).toContain('AuthError');
    });

    it('should extract multiple pub exports', () => {
      const code = `pub fn foo() {}
pub struct Bar {}
fn private_fn() {}
pub enum Baz { A, B }`;
      const root = mustParse(code, 'rust');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toEqual(['foo', 'Bar', 'Baz']);
      expect(exports).not.toContain('private_fn');
    });

    it('should extract pub const and pub static exports', () => {
      const code = `pub const MAX_SIZE: usize = 100;
pub static COUNTER: i32 = 0;`;
      const root = mustParse(code, 'rust');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toContain('MAX_SIZE');
      expect(exports).toContain('COUNTER');
    });

    it('should extract pub mod exports', () => {
      const code = 'pub mod auth;';
      const root = mustParse(code, 'rust');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toEqual(['auth']);
    });
  });

  describe('Import Extraction', () => {
    it('should identify use_declaration as import node type', () => {
      expect(importExtractor.importNodeTypes).toContain('use_declaration');
    });

    it('should extract crate import path', () => {
      const code = 'use crate::auth::AuthService;';
      const root = mustParse(code, 'rust');
      const useNode = root.namedChild(0)!;
      const path = importExtractor.extractImportPath(useNode);
      // extractImportPath resolves the full path including symbol
      expect(path).toBe('auth/AuthService');
    });

    it('should extract self import path', () => {
      const code = 'use self::config::Settings;';
      const root = mustParse(code, 'rust');
      const useNode = root.namedChild(0)!;
      const path = importExtractor.extractImportPath(useNode);
      expect(path).toBe('config/Settings');
    });

    it('should extract super import path', () => {
      const code = 'use super::utils::helper;';
      const root = mustParse(code, 'rust');
      const useNode = root.namedChild(0)!;
      const path = importExtractor.extractImportPath(useNode);
      expect(path).toBe('../utils/helper');
    });

    it('should return null for external crate imports', () => {
      const code = 'use std::io::Read;';
      const root = mustParse(code, 'rust');
      const useNode = root.namedChild(0)!;
      const path = importExtractor.extractImportPath(useNode);
      expect(path).toBeNull();
    });

    it('should extract import symbols from scoped identifier', () => {
      const code = 'use crate::auth::AuthService;';
      const root = mustParse(code, 'rust');
      const useNode = root.namedChild(0)!;
      const result = importExtractor.processImportSymbols(useNode);
      expect(result).not.toBeNull();
      expect(result!.importPath).toBe('auth');
      expect(result!.symbols).toEqual(['AuthService']);
    });

    it('should extract import symbols from use list', () => {
      const code = 'use crate::auth::{AuthService, AuthError};';
      const root = mustParse(code, 'rust');
      const useNode = root.namedChild(0)!;
      const result = importExtractor.processImportSymbols(useNode);
      expect(result).not.toBeNull();
      expect(result!.importPath).toBe('auth');
      expect(result!.symbols).toContain('AuthService');
      expect(result!.symbols).toContain('AuthError');
    });

    it('should extract aliased import symbols', () => {
      const code = 'use crate::auth::Service as Auth;';
      const root = mustParse(code, 'rust');
      const useNode = root.namedChild(0)!;
      const result = importExtractor.processImportSymbols(useNode);
      expect(result).not.toBeNull();
      expect(result!.symbols).toContain('Auth');
    });

    it('should return null for external crate import symbols', () => {
      const code = 'use std::collections::HashMap;';
      const root = mustParse(code, 'rust');
      const useNode = root.namedChild(0)!;
      const result = importExtractor.processImportSymbols(useNode);
      expect(result).toBeNull();
    });

    it('extractImportPaths wraps the single extractImportPath result in an array (default shape, #863)', () => {
      const code = 'use crate::auth::AuthService;';
      const root = mustParse(code, 'rust');
      const useNode = root.namedChild(0)!;
      expect(importExtractor.extractImportPaths(useNode)).toEqual(['auth/AuthService']);

      const stdlibCode = 'use std::io::Read;';
      const stdlibRoot = mustParse(stdlibCode, 'rust');
      const stdlibNode = stdlibRoot.namedChild(0)!;
      expect(importExtractor.extractImportPaths(stdlibNode)).toEqual([]);
    });

    // `use crate::config;` (a single segment directly off a BARE crate/self/
    // super root, no further `::`) previously resolved a correct path via
    // extractImportPath (which converts the whole node's text) but returned
    // null from processImportSymbols — which read the `path` field alone
    // ("crate", with no "::" for convertRustModulePath to strip) instead of
    // combining it with the imported name first.
    it('should extract import path for a bare-root single-segment use (crate::x)', () => {
      const code = 'use crate::config;';
      const root = mustParse(code, 'rust');
      const useNode = root.namedChild(0)!;
      const path = importExtractor.extractImportPath(useNode);
      expect(path).toBe('config');
    });

    it('should extract import symbols for a bare-root single-segment use (crate::x)', () => {
      const code = 'use crate::config;';
      const root = mustParse(code, 'rust');
      const useNode = root.namedChild(0)!;
      const result = importExtractor.processImportSymbols(useNode);
      expect(result).not.toBeNull();
      expect(result!.importPath).toBe('config');
      expect(result!.symbols).toEqual(['config']);
    });

    it('should extract import symbols for a bare-root single-segment use (self::x)', () => {
      const code = 'use self::config;';
      const root = mustParse(code, 'rust');
      const useNode = root.namedChild(0)!;
      const result = importExtractor.processImportSymbols(useNode);
      expect(result).not.toBeNull();
      expect(result!.importPath).toBe('config');
      expect(result!.symbols).toEqual(['config']);
    });

    // `use crate::{auth::AuthService, config::Settings};` groups items that
    // point at genuinely DIFFERENT modules (unlike `use crate::auth::{A, B}`,
    // where all items share one module) under a BARE crate/self/super root.
    // tree-sitter-rust gives crate/self/super their own named node types with
    // no further `::` segment, so convertRustModulePath's prefix-strip never
    // matched and the whole declaration returned null. Mirrors
    // GoImportExtractor's "first wins" precedent for its own multi-target
    // grouped imports rather than dropping the statement entirely.
    it('should extract the first target from a bare-root use group', () => {
      const code = 'use crate::{auth::AuthService, config::Settings};';
      const root = mustParse(code, 'rust');
      const useNode = root.namedChild(0)!;
      const path = importExtractor.extractImportPath(useNode);
      expect(path).toBe('auth');
    });

    it('should extract first-target import symbols from a bare-root use group', () => {
      const code = 'use crate::{auth::AuthService, config::Settings};';
      const root = mustParse(code, 'rust');
      const useNode = root.namedChild(0)!;
      const result = importExtractor.processImportSymbols(useNode);
      expect(result).not.toBeNull();
      expect(result!.importPath).toBe('auth');
      expect(result!.symbols).toEqual(['AuthService']);
    });

    it('should extract the first target from a flat bare-root use group (no submodule)', () => {
      const code = 'use crate::{Foo, Bar};';
      const root = mustParse(code, 'rust');
      const useNode = root.namedChild(0)!;
      const path = importExtractor.extractImportPath(useNode);
      expect(path).toBe('Foo');
    });

    // #903: a Cargo workspace member's `tests/` integration tests are
    // compiled as a SEPARATE crate, so they reference the crate under test by
    // its published name (`use tokio_util::codec::Framed;`), never `crate::`.
    // Passing a `rustCrateMap` (built by `resolveRustCrateMap`) lets the
    // extractor tell a workspace-member crate apart from a genuinely
    // external one, without changing any existing crate/self/super behavior.
    describe('workspace crate-map resolution (#903)', () => {
      const rustCrateMap = new Map([
        ['tokio_util', 'tokio-util/src'],
        ['tokio_test', 'tokio-test/src'],
      ]);

      it('resolves a workspace-member crate import (tokio-util repro)', () => {
        const code = 'use tokio_util::codec::Framed;';
        const root = mustParse(code, 'rust');
        const useNode = root.namedChild(0)!;
        expect(importExtractor.extractImportPath(useNode, rustCrateMap)).toBe(
          'tokio-util/src/codec/Framed',
        );
      });

      it('resolves a bare workspace-crate group reference (no module segment before the braces) to the crate dir itself', () => {
        // `use tokio_test::{assert_ok, assert_err};` (tokio-test's own repro
        // shape from #903) has no module path between the crate name and the
        // group -- convertRustModulePath's `rest` is empty, so it resolves to
        // the crate's src dir itself, same as a bare crate::-relative import
        // with nothing to strip.
        const code = 'use tokio_test::{assert_ok, assert_err};';
        const root = mustParse(code, 'rust');
        const useNode = root.namedChild(0)!;
        expect(importExtractor.extractImportPath(useNode, rustCrateMap)).toBe('tokio-test/src');

        const result = importExtractor.processImportSymbols(useNode, rustCrateMap);
        expect(result).not.toBeNull();
        expect(result!.importPath).toBe('tokio-test/src');
        expect(result!.symbols).toContain('assert_ok');
        expect(result!.symbols).toContain('assert_err');
      });

      it('still returns null for a genuinely external crate even with a crate map present', () => {
        const code = 'use futures::stream::StreamExt;';
        const root = mustParse(code, 'rust');
        const useNode = root.namedChild(0)!;
        expect(importExtractor.extractImportPath(useNode, rustCrateMap)).toBeNull();
      });

      it('is a no-op (returns null) for a non-crate/self/super root when no crate map is passed — zero behavior change', () => {
        const code = 'use tokio_util::codec::Framed;';
        const root = mustParse(code, 'rust');
        const useNode = root.namedChild(0)!;
        expect(importExtractor.extractImportPath(useNode)).toBeNull();
      });

      it('resolves imported symbols for a workspace-member crate the same way', () => {
        const code = 'use tokio_util::codec::Framed;';
        const root = mustParse(code, 'rust');
        const useNode = root.namedChild(0)!;
        const result = importExtractor.processImportSymbols(useNode, rustCrateMap);
        expect(result).not.toBeNull();
        expect(result!.importPath).toBe('tokio-util/src/codec');
        expect(result!.symbols).toEqual(['Framed']);
      });

      it('still resolves crate::-relative imports unaffected by a populated crate map', () => {
        const code = 'use crate::auth::AuthService;';
        const root = mustParse(code, 'rust');
        const useNode = root.namedChild(0)!;
        expect(importExtractor.extractImportPath(useNode, rustCrateMap)).toBe('auth/AuthService');
      });
    });

    // #928: without `importerFile`, `self::`/`super::` fell back to a
    // directory-less (or merely `../`-prefixed) string with no knowledge of
    // the importer's real location. `matchesFile`'s generic bare-identifier
    // leniency (designed for the legitimate `crate::auth` -> `src/auth.rs`
    // convention) then had to guess at match time, and could coincidentally
    // match an unrelated same-named file elsewhere in the repo through a
    // single leading directory — the exact tokio-rs/tokio repro from #928:
    // `benches/copy.rs` (a leaf Rust benchmark nothing can import) fuzzy-
    // matched `tokio/src/fs/mod.rs`'s `self::copy` and
    // `tokio/src/io/util/copy_bidirectional.rs`'s `super::copy`, fabricating
    // 80 dependents. Passing `importerFile` resolves both keywords to the
    // REAL workspace-relative path up front, so the generic matcher never
    // sees an ambiguous bare word for these two keywords at all.
    describe('self::/super:: importer-relative resolution (#928)', () => {
      it('resolves self:: from a module-root file (mod.rs) to a sibling in the SAME directory', () => {
        // The tokio/src/fs/mod.rs repro: `pub use self::copy::copy;` must
        // resolve to tokio/src/fs/copy/copy (extractImportPath returns the
        // FULL path including the imported item name — see
        // processImportSymbols below for the module-only form), not the
        // directory-less bare "copy" that used to fuzzy-match an unrelated
        // benches/copy.rs.
        const code = 'use self::copy::copy;';
        const root = mustParse(code, 'rust');
        const useNode = root.namedChild(0)!;
        expect(importExtractor.extractImportPath(useNode, undefined, 'tokio/src/fs/mod.rs')).toBe(
          'tokio/src/fs/copy/copy',
        );
      });

      it('resolves super:: from a LEAF file to a sibling in the SAME directory (no traversal)', () => {
        // The tokio/src/io/util/copy_bidirectional.rs repro: `use
        // super::copy::CopyBuffer;` must resolve to
        // tokio/src/io/util/copy/CopyBuffer, not tokio/src/io/copy/CopyBuffer
        // (a naive filesystem-style ".." join would incorrectly ascend past
        // io/util/ since a leaf file's own directory already IS its parent
        // module's location).
        const code = 'use super::copy::CopyBuffer;';
        const root = mustParse(code, 'rust');
        const useNode = root.namedChild(0)!;
        expect(
          importExtractor.extractImportPath(
            useNode,
            undefined,
            'tokio/src/io/util/copy_bidirectional.rs',
          ),
        ).toBe('tokio/src/io/util/copy/CopyBuffer');
      });

      it('resolves super:: from a module-root file (mod.rs) to the PARENT directory', () => {
        // Asymmetric with the leaf case above: a mod.rs IS its directory's
        // own module, so super:: from it genuinely ascends one level.
        const code = 'use super::helper;';
        const root = mustParse(code, 'rust');
        const useNode = root.namedChild(0)!;
        expect(importExtractor.extractImportPath(useNode, undefined, 'tokio/src/io/mod.rs')).toBe(
          'tokio/src/helper',
        );
      });

      it('recognizes lib.rs and main.rs as module-root files too', () => {
        const code = 'use super::helper;';
        const root = mustParse(code, 'rust');
        const useNode = root.namedChild(0)!;
        expect(importExtractor.extractImportPath(useNode, undefined, 'tokio/src/lib.rs')).toBe(
          'tokio/helper',
        );
        expect(importExtractor.extractImportPath(useNode, undefined, 'tokio/src/main.rs')).toBe(
          'tokio/helper',
        );
      });

      it('self:: from a repo-root module-root file resolves with no leading slash', () => {
        const code = 'use self::helper;';
        const root = mustParse(code, 'rust');
        const useNode = root.namedChild(0)!;
        expect(importExtractor.extractImportPath(useNode, undefined, 'mod.rs')).toBe('helper');
      });

      it('processImportSymbols resolves self::/super:: the same way as extractImportPath', () => {
        const code = 'use self::copy::copy;';
        const root = mustParse(code, 'rust');
        const useNode = root.namedChild(0)!;
        const result = importExtractor.processImportSymbols(
          useNode,
          undefined,
          'tokio/src/fs/mod.rs',
        );
        expect(result).not.toBeNull();
        expect(result!.importPath).toBe('tokio/src/fs/copy');
        expect(result!.symbols).toEqual(['copy']);
      });

      it('extractImportPaths threads importerFile through to extractImportPath', () => {
        const code = 'use super::copy::CopyBuffer;';
        const root = mustParse(code, 'rust');
        const useNode = root.namedChild(0)!;
        expect(
          importExtractor.extractImportPaths(
            useNode,
            undefined,
            'tokio/src/io/util/copy_bidirectional.rs',
          ),
        ).toEqual(['tokio/src/io/util/copy/CopyBuffer']);
      });

      it('crate::-relative imports are unaffected by importerFile (absolute from the crate root already)', () => {
        const code = 'use crate::auth::AuthService;';
        const root = mustParse(code, 'rust');
        const useNode = root.namedChild(0)!;
        expect(
          importExtractor.extractImportPath(useNode, undefined, 'tokio/src/io/util/deep/mod.rs'),
        ).toBe('auth/AuthService');
      });

      it('is a strict no-op (identical to the pre-#928 behavior) when importerFile is omitted', () => {
        const selfCode = 'use self::config::Settings;';
        const selfRoot = mustParse(selfCode, 'rust');
        expect(importExtractor.extractImportPath(selfRoot.namedChild(0)!)).toBe('config/Settings');

        const superCode = 'use super::utils::helper;';
        const superRoot = mustParse(superCode, 'rust');
        expect(importExtractor.extractImportPath(superRoot.namedChild(0)!)).toBe('../utils/helper');
      });
    });
  });

  describe('Symbol Extraction', () => {
    it('should extract function_item info', () => {
      const code = 'fn process_data(items: Vec<i32>) -> Vec<i32> { items }';
      const root = mustParse(code, 'rust');
      const funcNode = root.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(funcNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('process_data');
      expect(symbol!.type).toBe('function');
      expect(symbol!.signature).toContain('process_data');
    });

    it('should extract function as method when parent class is given', () => {
      const code = 'fn get_name(&self) -> &str { &self.name }';
      const root = mustParse(code, 'rust');
      const funcNode = root.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(funcNode, code, 'MyStruct');
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('get_name');
      expect(symbol!.type).toBe('method');
      expect(symbol!.parentClass).toBe('MyStruct');
    });

    it('should extract impl_item as class', () => {
      const code = 'impl UserService { fn new() -> Self { UserService {} } }';
      const root = mustParse(code, 'rust');
      const implNode = root.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(implNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('UserService');
      expect(symbol!.type).toBe('class');
      expect(symbol!.signature).toBe('impl UserService');
    });

    // Same underlying bug as the C#/Java/Kotlin/TS/Swift fix: `signature`
    // dropped generic type parameters and the implemented trait entirely, so
    // `impl<T> Trait for Type<T>` came back as bare `impl Type` — losing the
    // one fact (which trait this impl provides) that's most useful for
    // deciding whether it's the impl you want.
    it('should include generic type parameters and the implemented trait in an impl signature', () => {
      const code = 'impl<T> Trait for Type<T> { fn m(&self) {} }';
      const root = mustParse(code, 'rust');
      const implNode = root.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(implNode, code);
      expect(symbol!.name).toBe('Type<T>');
      expect(symbol!.signature).toBe('impl<T> Trait for Type<T>');
    });

    it('should extract trait_item as interface', () => {
      const code = 'trait Validate { fn validate(&self) -> bool; }';
      const root = mustParse(code, 'rust');
      const traitNode = root.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(traitNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('Validate');
      expect(symbol!.type).toBe('interface');
      expect(symbol!.signature).toBe('trait Validate');
    });

    it('should include generic type parameters and supertraits in a trait signature', () => {
      const code = 'trait Foo<T>: Bar + Baz { fn m(&self); }';
      const root = mustParse(code, 'rust');
      const traitNode = root.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(traitNode, code);
      expect(symbol!.signature).toBe('trait Foo<T>: Bar + Baz');
    });

    it('should extract call site from direct function call', () => {
      const code = 'fn main() { do_something(); }';
      const root = mustParse(code, 'rust');

      function findNode(node: SyntaxNode, type: string): SyntaxNode | null {
        if (node.type === type) return node;
        for (const child of node.namedChildren) {
          const result = findNode(child, type);
          if (result) return result;
        }
        return null;
      }

      const callNode = findNode(root, 'call_expression');
      if (callNode) {
        const callSite = symbolExtractor.extractCallSite(callNode);
        expect(callSite).not.toBeNull();
        expect(callSite!.symbol).toBe('do_something');
      }
    });

    it('should extract call site from field expression (method call)', () => {
      const code = 'fn main() { user.get_name(); }';
      const root = mustParse(code, 'rust');

      function findNode(node: SyntaxNode, type: string): SyntaxNode | null {
        if (node.type === type) return node;
        for (const child of node.namedChildren) {
          const result = findNode(child, type);
          if (result) return result;
        }
        return null;
      }

      const callNode = findNode(root, 'call_expression');
      if (callNode) {
        const callSite = symbolExtractor.extractCallSite(callNode);
        expect(callSite).not.toBeNull();
        expect(callSite!.symbol).toBe('get_name');
      }
    });

    it('should extract call site from scoped call (module::function)', () => {
      const code = 'fn main() { parser::parse_input(&path, &config); }';
      const root = mustParse(code, 'rust');

      function findNode(node: SyntaxNode, type: string): SyntaxNode | null {
        if (node.type === type) return node;
        for (const child of node.namedChildren) {
          const result = findNode(child, type);
          if (result) return result;
        }
        return null;
      }

      const callNode = findNode(root, 'call_expression');
      expect(callNode).not.toBeNull();
      if (callNode) {
        const callSite = symbolExtractor.extractCallSite(callNode);
        expect(callSite).not.toBeNull();
        // Should extract 'parse_input', not 'parser'
        expect(callSite!.symbol).toBe('parse_input');
      }
    });

    it('should extract call site from macro invocation', () => {
      const code = 'fn main() { println!("hello"); }';
      const root = mustParse(code, 'rust');

      function findNode(node: SyntaxNode, type: string): SyntaxNode | null {
        if (node.type === type) return node;
        for (const child of node.namedChildren) {
          const result = findNode(child, type);
          if (result) return result;
        }
        return null;
      }

      const macroNode = findNode(root, 'macro_invocation');
      if (macroNode) {
        const callSite = symbolExtractor.extractCallSite(macroNode);
        expect(callSite).not.toBeNull();
        expect(callSite!.symbol).toBe('println!');
      }
    });
  });

  describe('AST Chunking Integration', () => {
    it('should chunk Rust functions', () => {
      const content = `fn greet(name: &str) -> String {
    format!("Hello {}", name)
}

fn add(a: i32, b: i32) -> i32 {
    a + b
}`;

      const chunks = chunkByAST('test.rs', content);
      expect(chunks.length).toBeGreaterThanOrEqual(2);

      const greetChunk = chunks.find(c => c.metadata.symbolName === 'greet');
      expect(greetChunk).toBeDefined();
      expect(greetChunk?.metadata.symbolType).toBe('function');

      const addChunk = chunks.find(c => c.metadata.symbolName === 'add');
      expect(addChunk).toBeDefined();
      expect(addChunk?.metadata.symbolType).toBe('function');
    });

    it('should chunk Rust impl blocks with methods', () => {
      const content = `struct Calculator;

impl Calculator {
    fn add(&self, a: i32, b: i32) -> i32 {
        a + b
    }

    fn subtract(&self, a: i32, b: i32) -> i32 {
        a - b
    }
}`;

      const chunks = chunkByAST('test.rs', content);
      expect(chunks.length).toBeGreaterThanOrEqual(3);

      const implChunk = chunks.find(
        c => c.metadata.symbolName === 'Calculator' && c.metadata.symbolType === 'class',
      );
      expect(implChunk).toBeDefined();

      const addMethod = chunks.find(c => c.metadata.symbolName === 'add');
      expect(addMethod).toBeDefined();
      expect(addMethod?.metadata.symbolType).toBe('method');
      expect(addMethod?.metadata.parentClass).toBe('Calculator');
    });

    it('should chunk Rust trait definitions', () => {
      const content = `trait Drawable {
    fn draw(&self);
    fn area(&self) -> f64;
}`;

      const chunks = chunkByAST('test.rs', content);
      const traitChunk = chunks.find(c => c.metadata.symbolName === 'Drawable');
      expect(traitChunk).toBeDefined();
      expect(traitChunk?.metadata.symbolType).toBe('interface');
    });

    it('should extract pub exports from Rust files', () => {
      const content = `pub fn public_helper() -> bool {
    true
}

fn private_helper() -> bool {
    false
}`;

      const chunks = chunkByAST('test.rs', content);
      const pubChunk = chunks.find(c => c.metadata.symbolName === 'public_helper');
      expect(pubChunk).toBeDefined();
      expect(pubChunk?.metadata.exports).toContain('public_helper');
      expect(pubChunk?.metadata.exports).not.toContain('private_helper');
    });

    it('should calculate complexity for Rust functions', () => {
      const content = `fn classify(x: i32) -> &'static str {
    if x > 0 {
        "positive"
    } else if x < 0 {
        "negative"
    } else {
        "zero"
    }
}`;

      const chunks = chunkByAST('test.rs', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'classify');
      expect(funcChunk).toBeDefined();
      expect(funcChunk?.metadata.complexity).toBeDefined();
      expect(funcChunk?.metadata.complexity).toBeGreaterThanOrEqual(2);
    });

    it('should handle Rust match expressions', () => {
      const content = `fn describe(opt: Option<i32>) -> &'static str {
    match opt {
        Some(x) if x > 0 => "positive",
        Some(_) => "non-positive",
        None => "nothing",
    }
}`;

      const chunks = chunkByAST('test.rs', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'describe');
      expect(funcChunk).toBeDefined();
      expect(funcChunk?.metadata.complexity).toBeDefined();
      expect(funcChunk?.metadata.complexity).toBeGreaterThanOrEqual(1);
    });

    it('should handle Rust async functions', () => {
      const content = `async fn fetch_data() -> String {
    String::from("data")
}`;

      const chunks = chunkByAST('test.rs', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'fetch_data');
      expect(funcChunk).toBeDefined();
      expect(funcChunk?.metadata.symbolType).toBe('function');
    });

    it('should extract function parameters', () => {
      const content = `fn greet(name: &str, age: u32) -> String {
    format!("{} is {}", name, age)
}`;

      const chunks = chunkByAST('test.rs', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'greet');
      expect(funcChunk).toBeDefined();
      expect(funcChunk?.metadata.parameters).toBeDefined();
      expect(funcChunk?.metadata.parameters?.length).toBe(2);
    });

    it('should handle Rust imports via use declarations', () => {
      const content = `use crate::auth::AuthService;

pub fn authenticate() -> bool {
    true
}`;

      const chunks = chunkByAST('test.rs', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'authenticate');
      expect(funcChunk).toBeDefined();
      expect(funcChunk?.metadata.imports).toBeDefined();
      expect(funcChunk?.metadata.imports?.length).toBeGreaterThan(0);
    });
  });
});
