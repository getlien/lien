import TypeScript from 'tree-sitter-typescript';
import type { LanguageDefinition } from './types.js';
import { TypeScriptTraverser, TypeScriptExportExtractor, TypeScriptImportExtractor } from './javascript.js';

export const typescriptDefinition: LanguageDefinition = {
  id: 'typescript',
  extensions: ['ts', 'tsx'],
  grammar: TypeScript.typescript,
  traverser: new TypeScriptTraverser(),
  exportExtractor: new TypeScriptExportExtractor(),
  importExtractor: new TypeScriptImportExtractor(),

  complexity: {
    decisionPoints: [
      'if_statement', 'while_statement', 'for_statement', 'switch_case',
      'catch_clause', 'ternary_expression', 'binary_expression',
      'do_statement', 'for_in_statement', 'for_of_statement',
    ],
    nestingTypes: [
      'if_statement', 'for_statement', 'while_statement', 'switch_statement',
      'catch_clause', 'do_statement', 'for_in_statement', 'for_of_statement',
    ],
    nonNestingTypes: [
      'else_clause', 'ternary_expression',
    ],
    lambdaTypes: [
      'arrow_function', 'function_expression',
    ],
    operatorSymbols: new Set([
      '+', '-', '*', '/', '%', '**',
      '==', '===', '!=', '!==', '<', '>', '<=', '>=',
      '&&', '||', '!', '??',
      '=', '+=', '-=', '*=', '/=', '%=', '**=', '&&=', '||=', '??=',
      '&', '|', '^', '~', '<<', '>>', '>>>',
      '&=', '|=', '^=', '<<=', '>>=', '>>>=',
      '?', ':', '.', '?.', '++', '--', '...', '=>',
      '(', ')', '[', ']', '{', '}',
    ]),
    operatorKeywords: new Set([
      'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
      'return', 'throw', 'try', 'catch', 'finally',
      'new', 'delete', 'typeof', 'instanceof', 'in', 'of',
      'await', 'yield', 'break', 'continue',
      'const', 'let', 'var', 'function', 'class', 'extends', 'implements',
      'import', 'export', 'from', 'as',
    ]),
  },

  symbols: {
    callExpressionTypes: [
      'call_expression',
      'new_expression',
    ],
  },
};
