import Rust from 'tree-sitter-rust';
import type { LanguageDefinition } from './types.js';
import { RustTraverser } from '../traversers/rust.js';
import { RustExportExtractor } from '../extractors/rust.js';

export const rustDefinition: LanguageDefinition = {
  id: 'rust',
  extensions: ['rs'],
  grammar: Rust,
  traverser: new RustTraverser(),
  exportExtractor: new RustExportExtractor(),

  complexity: {
    decisionPoints: [
      'if_expression', 'match_expression', 'while_expression',
      'for_expression', 'loop_expression', 'match_arm',
      'binary_expression',
    ],
    nestingTypes: [
      'if_expression', 'for_expression', 'while_expression',
      'loop_expression', 'match_expression',
    ],
    nonNestingTypes: [
      'else_clause', 'match_arm',
    ],
    lambdaTypes: [
      'closure_expression',
    ],
    operatorSymbols: new Set([
      '+', '-', '*', '/', '%',
      '==', '!=', '<', '>', '<=', '>=',
      '=', '+=', '-=', '*=', '/=', '%=',
      '&=', '|=', '^=', '<<=', '>>=',
      '&', '|', '^', '!', '<<', '>>',
      '.', '::', '..', '..=', '=>', '->', '?',
      '(', ')', '[', ']', '{', '}',
    ]),
    operatorKeywords: new Set([
      'if', 'else', 'match', 'for', 'while', 'loop',
      'return', 'break', 'continue',
      'let', 'mut', 'fn', 'struct', 'enum', 'impl', 'trait',
      'pub', 'mod', 'use', 'as',
      'async', 'await', 'unsafe', 'where', 'move',
      'ref', 'self', 'super', 'crate', 'dyn', 'type',
    ]),
  },

  symbols: {
    callExpressionTypes: [
      'call_expression',
      'macro_invocation',
    ],
  },
};
