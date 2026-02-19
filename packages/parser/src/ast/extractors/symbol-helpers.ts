import type Parser from 'tree-sitter';

/**
 * Extract function/method signature
 */
export function extractSignature(node: Parser.SyntaxNode, content: string): string {
  // Get the first line of the function (up to opening brace or arrow)
  const startLine = node.startPosition.row;
  const lines = content.split('\n');
  let signature = lines[startLine] || '';

  // If signature spans multiple lines, try to get up to the opening brace
  let currentLine = startLine;
  while (
    currentLine < node.endPosition.row &&
    !signature.includes('{') &&
    !signature.includes('=>')
  ) {
    currentLine++;
    signature += ' ' + (lines[currentLine] || '');
  }

  // Clean up signature
  signature = signature.split('{')[0].split('=>')[0].trim();

  // Limit length
  if (signature.length > 200) {
    signature = signature.substring(0, 197) + '...';
  }

  return signature;
}

/**
 * Extract parameter list from function node
 *
 * Note: The `_content` parameter is unused in this function, but is kept for API consistency
 * with other extract functions (e.g., extractSignature).
 */
export function extractParameters(node: Parser.SyntaxNode, _content: string): string[] {
  const parameters: string[] = [];

  // Find parameters node
  const paramsNode = node.childForFieldName('parameters');
  if (!paramsNode) return parameters;

  // Traverse parameter nodes
  for (let i = 0; i < paramsNode.namedChildCount; i++) {
    const param = paramsNode.namedChild(i);
    if (param && param.text.trim()) {
      parameters.push(param.text);
    }
  }

  return parameters;
}

/**
 * Extract return type from function node (TypeScript)
 *
 * Note: The `_content` parameter is unused in this function, but is kept for API consistency
 * with other extract functions (e.g., extractSignature).
 */
export function extractReturnType(node: Parser.SyntaxNode, _content: string): string | undefined {
  const returnTypeNode = node.childForFieldName('return_type');
  if (!returnTypeNode) return undefined;

  return returnTypeNode.text;
}
