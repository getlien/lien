import type { SyntaxNode } from '../types.js';

/**
 * Extract function/method signature
 */
export function extractSignature(node: SyntaxNode, content: string): string {
  // Preferred: bound the signature by where the function body begins. This is
  // language-agnostic — it works for brace languages (`… ) {`), colon languages
  // (Python `… ):`), and `end` languages (Ruby `def … )`). The legacy brace/arrow
  // scan below walked an entire no-brace body into the "signature" (e.g. Python,
  // Ruby), which this avoids.
  const bodyNode = node.childForFieldName('body');
  if (bodyNode) {
    const signature = content
      .slice(node.startIndex, bodyNode.startIndex)
      .replace(/\s+/g, ' ') // collapse newlines/indentation (matches the old join-with-space)
      .replace(/(\{|=>|:)\s*$/, '') // drop a dangling block-opener if it was captured
      .trim();
    return clampSignatureLength(signature);
  }

  // Fallback: nodes with no `body` field (e.g. Rust trait signatures, abstract
  // interface methods). Preserve the original first-line / brace-scan behavior.
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

  return clampSignatureLength(signature);
}

/**
 * Truncate an over-long signature to keep stored chunks compact.
 */
export function clampSignatureLength(signature: string): string {
  return signature.length > 200 ? signature.substring(0, 197) + '...' : signature;
}

/**
 * Collapse a node's raw text to a single line for signature-building,
 * mirroring `extractSignature`'s `.replace(/\s+/g, ' ').trim()` convention.
 * A grammar node's text can itself span multiple physical lines even when
 * it's a small, single "clause" — e.g. a C# `base_list` wrapping a
 * conditionally-compiled member in a preprocessor block (`: ILogger\n#if
 * X\n, IAsyncDisposable\n#endif`), found via dogfooding a real class
 * (Serilog's `Logger`) rather than a hypothetical case. Returns `''` for
 * `undefined`/absent nodes so callers can compose pieces without a null
 * check at every call site.
 */
export function collapseWhitespace(text: string | undefined): string {
  return text ? text.replace(/\s+/g, ' ').trim() : '';
}

/**
 * Extract parameter list from function node
 *
 * Note: The `_content` parameter is unused in this function, but is kept for API consistency
 * with other extract functions (e.g., extractSignature).
 */
export function extractParameters(node: SyntaxNode, _content: string): string[] {
  const parameters: string[] = [];

  // Find parameters node
  const paramsNode = node.childForFieldName('parameters');
  if (!paramsNode) return parameters;

  // Traverse parameter nodes
  for (const param of paramsNode.namedChildren) {
    if (param.text.trim()) {
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
export function extractReturnType(node: SyntaxNode, _content: string): string | undefined {
  const returnTypeNode = node.childForFieldName('return_type');
  if (!returnTypeNode) return undefined;

  return returnTypeNode.text;
}
