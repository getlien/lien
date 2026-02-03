import PHPParser from 'tree-sitter-php';
import type { LanguageDefinition } from './types.js';
import { PHPTraverser } from '../traversers/php.js';
import { PHPExportExtractor } from '../extractors/php.js';

export const phpDefinition: LanguageDefinition = {
  id: 'php',
  extensions: ['php'],
  grammar: PHPParser.php,
  traverser: new PHPTraverser(),
  exportExtractor: new PHPExportExtractor(),

  complexity: {
    decisionPoints: [
      'if_statement', 'while_statement', 'for_statement', 'switch_case',
      'catch_clause', 'ternary_expression', 'binary_expression',
      'foreach_statement',
    ],
    nestingTypes: [
      'if_statement', 'for_statement', 'while_statement', 'switch_statement',
      'catch_clause', 'do_statement', 'foreach_statement', 'match_statement',
    ],
    nonNestingTypes: [
      'else_clause', 'ternary_expression',
    ],
    lambdaTypes: [],
    operatorSymbols: new Set([
      '+', '-', '*', '/', '%', '**',
      '==', '===', '!=', '!==', '<>', '<', '>', '<=', '>=', '<=>',
      '&&', '||', '!', 'and', 'or', 'xor',
      '=', '+=', '-=', '*=', '/=', '%=', '**=', '.=',
      '&=', '|=', '^=', '<<=', '>>=', '??=',
      '&', '|', '^', '~', '<<', '>>',
      '.',
      '?', ':', '::', '->', '=>', '??', '@',
      '(', ')', '[', ']', '{', '}',
    ]),
    operatorKeywords: new Set([
      'if', 'elseif', 'else', 'for', 'foreach', 'while', 'do', 'switch', 'case', 'default', 'match',
      'return', 'throw', 'try', 'catch', 'finally',
      'new', 'clone', 'instanceof',
      'yield', 'break', 'continue',
      'function', 'class', 'extends', 'implements', 'trait', 'interface',
      'use', 'namespace', 'as',
      'echo', 'print', 'include', 'require', 'include_once', 'require_once',
      'global', 'static', 'const', 'public', 'private', 'protected', 'readonly',
    ]),
  },

  symbols: {
    callExpressionTypes: [
      'function_call_expression',
      'member_call_expression',
      'scoped_call_expression',
    ],
  },
};
