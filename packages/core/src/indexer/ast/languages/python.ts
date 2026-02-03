import Python from 'tree-sitter-python';
import type { LanguageDefinition } from './types.js';
import { PythonTraverser } from '../traversers/python.js';
import { PythonExportExtractor } from '../extractors/python.js';

export const pythonDefinition: LanguageDefinition = {
  id: 'python',
  extensions: ['py'],
  grammar: Python,
  traverser: new PythonTraverser(),
  exportExtractor: new PythonExportExtractor(),

  complexity: {
    decisionPoints: [
      'if_statement', 'while_statement', 'for_statement', 'switch_case',
      'catch_clause', 'ternary_expression', 'binary_expression',
      'elif_clause', 'except_clause', 'conditional_expression',
    ],
    nestingTypes: [
      'if_statement', 'for_statement', 'while_statement',
      'except_clause',
    ],
    nonNestingTypes: [
      'elif_clause', 'conditional_expression',
    ],
    lambdaTypes: [
      'lambda',
    ],
    operatorSymbols: new Set([
      '+', '-', '*', '/', '%', '**', '//',
      '==', '!=', '<', '>', '<=', '>=',
      '=', '+=', '-=', '*=', '/=', '%=', '**=', '//=',
      '&=', '|=', '^=', '<<=', '>>=',
      '&', '|', '^', '~', '<<', '>>',
      '.', ':', '->', '@',
      '(', ')', '[', ']', '{', '}',
    ]),
    operatorKeywords: new Set([
      'if', 'elif', 'else', 'for', 'while', 'match', 'case',
      'return', 'raise', 'try', 'except', 'finally',
      'and', 'or', 'not', 'is', 'in',
      'await', 'yield', 'break', 'continue', 'pass',
      'def', 'class', 'lambda', 'async',
      'import', 'from', 'as', 'with',
      'global', 'nonlocal', 'del', 'assert',
    ]),
  },

  symbols: {
    callExpressionTypes: [
      'call',
    ],
  },
};
