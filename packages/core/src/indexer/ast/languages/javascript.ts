import JavaScript from 'tree-sitter-javascript';
import type { LanguageDefinition } from './types.js';
import { JavaScriptTraverser } from '../traversers/typescript.js';
import { JavaScriptExportExtractor } from '../extractors/javascript.js';

export const javascriptDefinition: LanguageDefinition = {
  id: 'javascript',
  extensions: ['js', 'jsx', 'mjs', 'cjs'],
  grammar: JavaScript,
  traverser: new JavaScriptTraverser(),
  exportExtractor: new JavaScriptExportExtractor(),

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
