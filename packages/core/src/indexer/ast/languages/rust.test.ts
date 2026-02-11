import { describe, it, expect } from 'vitest';
import Parser from 'tree-sitter';
import Rust from 'tree-sitter-rust';
import { chunkByAST } from '../chunker.js';
import {
  RustTraverser,
  RustExportExtractor,
  RustImportExtractor,
  RustSymbolExtractor,
} from './rust.js';

describe('Rust Language', () => {
  const parser = new Parser();
  parser.setLanguage(Rust);
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
      const tree = parser.parse(code);
      const implNode = tree.rootNode.namedChild(0)!;
      expect(traverser.shouldExtractChildren(implNode)).toBe(true);
    });

    it('should get impl body as container body', () => {
      const code = 'impl Foo { fn bar(&self) {} }';
      const tree = parser.parse(code);
      const implNode = tree.rootNode.namedChild(0)!;
      const body = traverser.getContainerBody(implNode);
      expect(body).not.toBeNull();
      expect(body!.type).toBe('declaration_list');
    });

    it('should traverse source_file root', () => {
      const code = 'fn main() {}';
      const tree = parser.parse(code);
      expect(traverser.shouldTraverseChildren(tree.rootNode)).toBe(true);
    });

    it('should traverse declaration_list nodes', () => {
      const code = 'impl Foo { fn bar(&self) {} }';
      const tree = parser.parse(code);
      const implNode = tree.rootNode.namedChild(0)!;
      const body = implNode.childForFieldName('body')!;
      expect(traverser.shouldTraverseChildren(body)).toBe(true);
    });

    it('should not treat any nodes as declarations with functions', () => {
      const code = 'let x = 42;';
      const tree = parser.parse(code);
      for (let i = 0; i < tree.rootNode.namedChildCount; i++) {
        const child = tree.rootNode.namedChild(i);
        if (child) {
          expect(traverser.isDeclarationWithFunction(child)).toBe(false);
        }
      }
    });

    it('should find parent impl name for methods', () => {
      const code = 'impl MyStruct { fn my_method(&self) {} }';
      const tree = parser.parse(code);
      const implNode = tree.rootNode.namedChild(0)!;
      const body = implNode.childForFieldName('body')!;
      const funcNode = body.namedChild(0)!;
      expect(traverser.findParentContainerName(funcNode)).toBe('MyStruct');
    });

    it('should find parent trait name for methods', () => {
      const code = 'trait MyTrait { fn required(&self); }';
      const tree = parser.parse(code);
      const traitNode = tree.rootNode.namedChild(0)!;
      const body = traitNode.childForFieldName('body')!;
      const funcNode = body.namedChild(0)!;
      expect(traverser.findParentContainerName(funcNode)).toBe('MyTrait');
    });
  });

  describe('Export Extraction', () => {
    it('should extract pub function exports', () => {
      const code = 'pub fn helper() {}';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['helper']);
    });

    it('should extract pub struct exports', () => {
      const code = 'pub struct User { name: String }';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['User']);
    });

    it('should extract pub enum exports', () => {
      const code = 'pub enum Status { Active, Inactive }';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['Status']);
    });

    it('should extract pub trait exports', () => {
      const code = 'pub trait Serialize { fn serialize(&self) -> String; }';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['Serialize']);
    });

    it('should not export private items', () => {
      const code = 'fn private_helper() {}';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual([]);
    });

    it('should extract pub use re-exports', () => {
      const code = 'pub use crate::auth::AuthService;';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['AuthService']);
    });

    it('should extract pub use list re-exports', () => {
      const code = 'pub use crate::auth::{AuthService, AuthError};';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toContain('AuthService');
      expect(exports).toContain('AuthError');
    });

    it('should extract multiple pub exports', () => {
      const code = `pub fn foo() {}
pub struct Bar {}
fn private_fn() {}
pub enum Baz { A, B }`;
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['foo', 'Bar', 'Baz']);
      expect(exports).not.toContain('private_fn');
    });

    it('should extract pub const and pub static exports', () => {
      const code = `pub const MAX_SIZE: usize = 100;
pub static COUNTER: i32 = 0;`;
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toContain('MAX_SIZE');
      expect(exports).toContain('COUNTER');
    });

    it('should extract pub mod exports', () => {
      const code = 'pub mod auth;';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['auth']);
    });
  });

  describe('Import Extraction', () => {
    it('should identify use_declaration as import node type', () => {
      expect(importExtractor.importNodeTypes).toContain('use_declaration');
    });

    it('should extract crate import path', () => {
      const code = 'use crate::auth::AuthService;';
      const tree = parser.parse(code);
      const useNode = tree.rootNode.namedChild(0)!;
      const path = importExtractor.extractImportPath(useNode);
      // extractImportPath resolves the full path including symbol
      expect(path).toBe('auth/AuthService');
    });

    it('should extract self import path', () => {
      const code = 'use self::config::Settings;';
      const tree = parser.parse(code);
      const useNode = tree.rootNode.namedChild(0)!;
      const path = importExtractor.extractImportPath(useNode);
      expect(path).toBe('config/Settings');
    });

    it('should extract super import path', () => {
      const code = 'use super::utils::helper;';
      const tree = parser.parse(code);
      const useNode = tree.rootNode.namedChild(0)!;
      const path = importExtractor.extractImportPath(useNode);
      expect(path).toBe('../utils/helper');
    });

    it('should return null for external crate imports', () => {
      const code = 'use std::io::Read;';
      const tree = parser.parse(code);
      const useNode = tree.rootNode.namedChild(0)!;
      const path = importExtractor.extractImportPath(useNode);
      expect(path).toBeNull();
    });

    it('should extract import symbols from scoped identifier', () => {
      const code = 'use crate::auth::AuthService;';
      const tree = parser.parse(code);
      const useNode = tree.rootNode.namedChild(0)!;
      const result = importExtractor.processImportSymbols(useNode);
      expect(result).not.toBeNull();
      expect(result!.importPath).toBe('auth');
      expect(result!.symbols).toEqual(['AuthService']);
    });

    it('should extract import symbols from use list', () => {
      const code = 'use crate::auth::{AuthService, AuthError};';
      const tree = parser.parse(code);
      const useNode = tree.rootNode.namedChild(0)!;
      const result = importExtractor.processImportSymbols(useNode);
      expect(result).not.toBeNull();
      expect(result!.importPath).toBe('auth');
      expect(result!.symbols).toContain('AuthService');
      expect(result!.symbols).toContain('AuthError');
    });

    it('should extract aliased import symbols', () => {
      const code = 'use crate::auth::Service as Auth;';
      const tree = parser.parse(code);
      const useNode = tree.rootNode.namedChild(0)!;
      const result = importExtractor.processImportSymbols(useNode);
      expect(result).not.toBeNull();
      expect(result!.symbols).toContain('Auth');
    });

    it('should return null for external crate import symbols', () => {
      const code = 'use std::collections::HashMap;';
      const tree = parser.parse(code);
      const useNode = tree.rootNode.namedChild(0)!;
      const result = importExtractor.processImportSymbols(useNode);
      expect(result).toBeNull();
    });
  });

  describe('Symbol Extraction', () => {
    it('should extract function_item info', () => {
      const code = 'fn process_data(items: Vec<i32>) -> Vec<i32> { items }';
      const tree = parser.parse(code);
      const funcNode = tree.rootNode.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(funcNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('process_data');
      expect(symbol!.type).toBe('function');
      expect(symbol!.signature).toContain('process_data');
    });

    it('should extract function as method when parent class is given', () => {
      const code = 'fn get_name(&self) -> &str { &self.name }';
      const tree = parser.parse(code);
      const funcNode = tree.rootNode.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(funcNode, code, 'MyStruct');
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('get_name');
      expect(symbol!.type).toBe('method');
      expect(symbol!.parentClass).toBe('MyStruct');
    });

    it('should extract impl_item as class', () => {
      const code = 'impl UserService { fn new() -> Self { UserService {} } }';
      const tree = parser.parse(code);
      const implNode = tree.rootNode.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(implNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('UserService');
      expect(symbol!.type).toBe('class');
      expect(symbol!.signature).toBe('impl UserService');
    });

    it('should extract trait_item as interface', () => {
      const code = 'trait Validate { fn validate(&self) -> bool; }';
      const tree = parser.parse(code);
      const traitNode = tree.rootNode.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(traitNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('Validate');
      expect(symbol!.type).toBe('interface');
      expect(symbol!.signature).toBe('trait Validate');
    });

    it('should extract call site from direct function call', () => {
      const code = 'fn main() { do_something(); }';
      const tree = parser.parse(code);

      function findNode(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
        if (node.type === type) return node;
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child) {
            const result = findNode(child, type);
            if (result) return result;
          }
        }
        return null;
      }

      const callNode = findNode(tree.rootNode, 'call_expression');
      if (callNode) {
        const callSite = symbolExtractor.extractCallSite(callNode);
        expect(callSite).not.toBeNull();
        expect(callSite!.symbol).toBe('do_something');
      }
    });

    it('should extract call site from field expression (method call)', () => {
      const code = 'fn main() { user.get_name(); }';
      const tree = parser.parse(code);

      function findNode(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
        if (node.type === type) return node;
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child) {
            const result = findNode(child, type);
            if (result) return result;
          }
        }
        return null;
      }

      const callNode = findNode(tree.rootNode, 'call_expression');
      if (callNode) {
        const callSite = symbolExtractor.extractCallSite(callNode);
        expect(callSite).not.toBeNull();
        expect(callSite!.symbol).toBe('get_name');
      }
    });

    it('should extract call site from macro invocation', () => {
      const code = 'fn main() { println!("hello"); }';
      const tree = parser.parse(code);

      function findNode(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
        if (node.type === type) return node;
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child) {
            const result = findNode(child, type);
            if (result) return result;
          }
        }
        return null;
      }

      const macroNode = findNode(tree.rootNode, 'macro_invocation');
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

      const implChunk = chunks.find(c => c.metadata.symbolName === 'Calculator' && c.metadata.symbolType === 'class');
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
