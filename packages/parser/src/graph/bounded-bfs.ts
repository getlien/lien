/**
 * Generic bounded level-BFS over an arbitrary graph.
 *
 * Extracted from the caller-graph BFS in `@liendev/review`'s
 * `dependency-graph.ts` (`bfsTransitiveCallers` / `expandFrontier`). This file
 * keeps the traversal *shape* — frontier expansion, dedup, depth cap, maxNodes
 * truncation — generic and domain-agnostic. Callers supply the domain (what a
 * "node" and an "edge" are, and how to get from one to the other); this module
 * does not know anything about symbols, callers, or files.
 */

export interface BoundedBfsOptions {
  /** Max hop distance from the seed. Unbounded if omitted. */
  depth?: number;
  /** Max edges to emit before stopping. Unbounded if omitted. */
  maxNodes?: number;
}

export interface BoundedBfsEdgeResult<TNode, TEdge> {
  /** The edge as returned by `getNeighbors`. */
  edge: TEdge;
  /** The node whose neighbors produced this edge (the BFS predecessor). */
  fromNode: TNode;
  /** Hop distance from the seed. Direct neighbors of the seed are 1. */
  hops: number;
}

export interface BoundedBfsResult<TNode, TEdge> {
  results: Array<BoundedBfsEdgeResult<TNode, TEdge>>;
  /** True if the walk stopped because it hit maxNodes before exploring the full graph. */
  truncated: boolean;
  /** Count of distinct nodes whose neighbors were expanded (for diagnostics). */
  visitedCount: number;
}

interface QueueItem<TNode> {
  node: TNode;
  hops: number;
}

/**
 * BFS-walk outward from `seed` up to `opts.depth` hops. Each reachable node is
 * emitted exactly once (via its edge), at its shortest hop distance from the
 * seed. Stops once `opts.maxNodes` edges have been emitted (sets
 * `truncated: true`).
 *
 * @param seed - The starting node.
 * @param getNeighbors - Returns the outgoing edges of a node.
 * @param getNextNode - Extracts the node an edge leads to.
 * @param getEdgeKey - Dedup key for the node an edge leads to (equivalent to
 *   `getNodeKey(getNextNode(edge))`, but callers may compute it more directly).
 * @param getNodeKey - Dedup key for a node — must produce the same key format
 *   as `getEdgeKey` for equivalent nodes.
 */
export function walkBounded<TNode, TEdge>(
  seed: TNode,
  getNeighbors: (node: TNode) => TEdge[],
  getNextNode: (edge: TEdge) => TNode,
  getEdgeKey: (edge: TEdge) => string,
  getNodeKey: (node: TNode) => string,
  opts: BoundedBfsOptions = {},
): BoundedBfsResult<TNode, TEdge> {
  const depth = opts.depth ?? Number.POSITIVE_INFINITY;
  const maxNodes = opts.maxNodes ?? Number.POSITIVE_INFINITY;

  if (depth < 1 || maxNodes < 1) {
    return { results: [], truncated: false, visitedCount: 0 };
  }

  // Seed in `visited` ensures cycles can never re-emit the seed.
  const visited = new Set<string>([getNodeKey(seed)]);
  const expanded = new Set<string>();
  const results: Array<BoundedBfsEdgeResult<TNode, TEdge>> = [];
  const queue: Array<QueueItem<TNode>> = [{ node: seed, hops: 0 }];
  const state = { truncated: false };

  while (queue.length > 0 && !state.truncated) {
    const current = queue.shift();
    if (!current) break;
    const currentKey = getNodeKey(current.node);
    if (expanded.has(currentKey)) continue;
    expanded.add(currentKey);
    expandFrontier(
      current,
      getNeighbors,
      getNextNode,
      getEdgeKey,
      { depth, maxNodes },
      visited,
      results,
      queue,
      state,
    );
  }

  return { results, truncated: state.truncated, visitedCount: expanded.size };
}

interface ExpandLimits {
  depth: number;
  maxNodes: number;
}

/**
 * Process the direct neighbors of a single frontier node.
 *
 * Truncation is deterministic but ordering-dependent: when maxNodes is hit
 * mid-expansion, the remaining neighbors of the current node (and any deeper
 * nodes still in the queue) are dropped silently. Which edges survive
 * therefore depends on the iteration order of `getNeighbors` — consumers
 * should not rely on any particular subset appearing in a truncated result.
 */
function expandFrontier<TNode, TEdge>(
  current: QueueItem<TNode>,
  getNeighbors: (node: TNode) => TEdge[],
  getNextNode: (edge: TEdge) => TNode,
  getEdgeKey: (edge: TEdge) => string,
  limits: ExpandLimits,
  visited: Set<string>,
  results: Array<BoundedBfsEdgeResult<TNode, TEdge>>,
  queue: Array<QueueItem<TNode>>,
  state: { truncated: boolean },
): void {
  const edges = getNeighbors(current.node);
  for (const edge of edges) {
    const key = getEdgeKey(edge);
    if (visited.has(key)) continue;

    if (results.length >= limits.maxNodes) {
      state.truncated = true;
      return;
    }

    visited.add(key);
    const hops = current.hops + 1;
    results.push({ edge, fromNode: current.node, hops });

    if (hops < limits.depth) {
      queue.push({ node: getNextNode(edge), hops });
    }
  }
}
