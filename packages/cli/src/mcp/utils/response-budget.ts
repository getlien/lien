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
  truncateArrays(arrays, 10);
  if (measureSize(cloned) <= maxChars) {
    return buildResult(cloned, originalChars, 1, arrays, originalItemCount);
  }

  // Phase 2: Drop items from the end of arrays
  dropArrayItems(arrays, cloned, maxChars);
  if (measureSize(cloned) <= maxChars) {
    return buildResult(cloned, originalChars, 2, arrays, originalItemCount);
  }

  // Phase 3: Truncate content to 3 lines (signature only)
  // Note: if non-content fields (e.g. metadata) are very large, the result
  // may still exceed maxChars — this is acceptable as a best-effort cap.
  truncateArrays(arrays, 3);
  return buildResult(cloned, originalChars, 3, arrays, originalItemCount);
}

function truncateArrays(arrays: Array<Array<{ content: string }>>, maxLines: number): void {
  for (const arr of arrays) {
    for (const item of arr) {
      item.content = truncateContent(item.content, maxLines);
    }
  }
}

function dropArrayItems(
  arrays: Array<Array<{ content: string }>>,
  root: unknown,
  maxChars: number,
): void {
  let currentSize = measureSize(root);
  for (const arr of arrays) {
    while (arr.length > 1 && currentSize > maxChars) {
      arr.pop();
      currentSize = measureSize(root);
    }
  }
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

function walk(node: unknown, found: Array<Array<{ content: string }>>): void {
  if (node === null || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    if (
      node.length > 0 &&
      node.every(
        elem =>
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
  const itemsDropped = finalItemCount < originalItemCount;

  // `originalItemCount` is just the size of the array THIS function was
  // handed — already capped upstream by whatever limit/offset/over-fetch the
  // tool applied — never the true number of matches in the index. Saying
  // "of {originalItemCount}" reads as a total and isn't one (see the bug
  // this fixes: list_functions/find_similar reported "of 50"/"of 200" that
  // was really just the request's own limit echoed back). State only what
  // this function actually knows: how many survived ITS OWN size cut, and
  // that more may exist — never a specific total.
  const message = itemsDropped
    ? `Showing ${finalItemCount} results (response-size cap; ${originalItemCount - finalItemCount} more dropped here — not the underlying match count). Narrow filters or lower limit for complete results.`
    : `Showing all ${finalItemCount} results (content trimmed to fit response size). Narrow filters or lower limit for full content.`;

  // If items were actually dropped, this response is provably incomplete —
  // never let a stale `hasMore: false` (set upstream before this size cap
  // ran) claim otherwise. And if a `nextOffset` pagination cursor is
  // present, it was computed assuming the full pre-cut page was delivered
  // (offset + limit) — correct it by the same drop count, or paging with it
  // silently skips exactly the items this cut just dropped (verified: a
  // dropped-by-25 response advising nextOffset:50 actually needed
  // nextOffset:25 to avoid a gap). Tool-side prose must never bake in the
  // OLD number here — this is the only place that can still be corrected
  // after the fact, since arbitrary note text can't be safely rewritten.
  if (itemsDropped && cloned && typeof cloned === 'object') {
    const obj = cloned as Record<string, unknown>;
    if ('hasMore' in obj) {
      obj.hasMore = true;
    }
    if (typeof obj.nextOffset === 'number') {
      obj.nextOffset -= originalItemCount - finalItemCount;
    }
  }

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
