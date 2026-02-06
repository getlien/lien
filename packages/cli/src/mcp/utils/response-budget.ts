// Budget is measured on compact JSON, but wrapToolHandler serializes with
// pretty-print (JSON.stringify with indent 2) which roughly doubles the size.
// 12K compact ≈ 24K pretty-printed ≈ 6K tokens — stays under Claude Code's
// ~8K token "large MCP response" warning threshold.
const MAX_RESPONSE_CHARS = 12_000;

interface TruncationInfo {
  originalChars: number;
  finalChars: number;
  originalItemCount: number;
  finalItemCount: number;
  phase: number;
  message: string;
}

/**
 * Apply a character budget to an MCP tool response.
 *
 * Finds arrays of objects with `content` string fields and progressively
 * truncates them until the JSON-serialized size is within budget.
 *
 * Phase 1: Truncate `content` fields to first 10 lines
 * Phase 2: Drop items from the end of arrays
 * Phase 3: Truncate `content` fields to first 3 lines (signature only)
 */
export function applyResponseBudget(
  result: unknown,
  maxChars: number = MAX_RESPONSE_CHARS,
): { result: unknown; truncation?: TruncationInfo } {
  const serialized = JSON.stringify(result);
  if (serialized.length <= maxChars) {
    return { result };
  }

  const originalChars = serialized.length;
  const cloned = JSON.parse(serialized);

  const arrays = findContentArrays(cloned);
  if (arrays.length === 0) {
    return { result };
  }

  const originalItemCount = arrays.reduce((sum, arr) => sum + arr.length, 0);

  // Phase 1: Truncate content to 10 lines
  for (const arr of arrays) {
    for (const item of arr) {
      item.content = truncateContent(item.content, 10);
    }
  }
  if (measureSize(cloned) <= maxChars) {
    return buildResult(cloned, originalChars, 1, arrays, originalItemCount);
  }

  // Phase 2: Drop items from the end of arrays
  let currentSize = measureSize(cloned);
  for (const arr of arrays) {
    while (arr.length > 1 && currentSize > maxChars) {
      arr.pop();
      currentSize = measureSize(cloned);
    }
  }
  if (currentSize <= maxChars) {
    return buildResult(cloned, originalChars, 2, arrays, originalItemCount);
  }

  // Phase 3: Truncate content to 3 lines (signature only)
  // Note: if non-content fields (e.g. metadata) are very large, the result
  // may still exceed maxChars — this is acceptable as a best-effort cap.
  for (const arr of arrays) {
    for (const item of arr) {
      item.content = truncateContent(item.content, 3);
    }
  }
  return buildResult(cloned, originalChars, 3, arrays, originalItemCount);
}

function truncateContent(content: string, maxLines: number): string {
  const lines = content.split('\n');
  if (lines.length <= maxLines) return content;
  return lines.slice(0, maxLines).join('\n') + '\n... (truncated)';
}

function measureSize(obj: unknown): number {
  return JSON.stringify(obj).length;
}

/**
 * Recursively find all arrays whose elements have a string `content` field.
 * Handles: result.results[], result.files[key].chunks[], result.violations[],
 * result.dependents[], etc.
 */
function findContentArrays(obj: unknown): Array<Array<{ content: string }>> {
  const found: Array<Array<{ content: string }>> = [];
  walk(obj, found);
  return found;
}

function walk(
  node: unknown,
  found: Array<Array<{ content: string }>>,
): void {
  if (node === null || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    if (
      node.length > 0 &&
      node.every(
        (elem) =>
          typeof elem === 'object' &&
          elem !== null &&
          typeof (elem as Record<string, unknown>).content === 'string',
      )
    ) {
      found.push(node as Array<{ content: string }>);
    }
    return;
  }

  for (const value of Object.values(node as Record<string, unknown>)) {
    walk(value, found);
  }
}

function buildResult(
  cloned: unknown,
  originalChars: number,
  phase: number,
  arrays: Array<Array<{ content: string }>>,
  originalItemCount: number,
): { result: unknown; truncation: TruncationInfo } {
  const finalChars = measureSize(cloned);
  const finalItemCount = arrays.reduce((sum, arr) => sum + arr.length, 0);

  const message = finalItemCount < originalItemCount
    ? `Showing ${finalItemCount} of ${originalItemCount} results (truncated). Use narrower filters or smaller limit for complete results.`
    : `Showing all ${finalItemCount} results (content trimmed to fit). Use narrower filters or smaller limit for complete results.`;

  return {
    result: cloned,
    truncation: {
      originalChars,
      finalChars,
      originalItemCount,
      finalItemCount,
      phase,
      message,
    },
  };
}
