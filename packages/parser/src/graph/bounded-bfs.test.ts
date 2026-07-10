import { describe, it, expect } from 'vitest';
import { walkBounded } from './bounded-bfs.js';

interface TestEdge {
  to: string;
}

/** Build a `getNeighbors` function from a plain adjacency list. */
function makeGraph(adjacency: Record<string, string[]>): (node: string) => TestEdge[] {
  return (node: string) => (adjacency[node] ?? []).map(to => ({ to }));
}

const getNextNode = (edge: TestEdge): string => edge.to;
const getEdgeKey = (edge: TestEdge): string => edge.to;
const getNodeKey = (node: string): string => node;

describe('walkBounded', () => {
  it('expands level by level, labeling each edge with its shortest hop', () => {
    const getNeighbors = makeGraph({
      seed: ['a'],
      a: ['b'],
    });

    const result = walkBounded<string, TestEdge>(
      'seed',
      getNeighbors,
      getNextNode,
      getEdgeKey,
      getNodeKey,
      { depth: 2, maxNodes: 10 },
    );

    expect(result.results.map(r => r.edge.to)).toEqual(['a', 'b']);
    expect(result.results.map(r => r.hops)).toEqual([1, 2]);
    expect(result.results.map(r => r.fromNode)).toEqual(['seed', 'a']);
    expect(result.truncated).toBe(false);
  });

  it('does not walk past the requested depth', () => {
    const getNeighbors = makeGraph({
      seed: ['a'],
      a: ['b'],
      b: ['c'],
    });

    const result = walkBounded<string, TestEdge>(
      'seed',
      getNeighbors,
      getNextNode,
      getEdgeKey,
      getNodeKey,
      { depth: 2, maxNodes: 10 },
    );

    expect(result.results.map(r => r.edge.to)).toEqual(['a', 'b']);
  });

  it('terminates cleanly on a cycle without re-emitting the seed', () => {
    const getNeighbors = makeGraph({
      a: ['b'],
      b: ['a'],
    });

    const result = walkBounded<string, TestEdge>(
      'a',
      getNeighbors,
      getNextNode,
      getEdgeKey,
      getNodeKey,
      { depth: 5, maxNodes: 10 },
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0].edge.to).toBe('b');
    expect(result.results[0].hops).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it('dedups a node reached via multiple paths, keeping the shortest hop', () => {
    // Diamond: seed -> a -> c, seed -> b -> c. "c" is reachable at hop 2 via
    // either path but must be emitted exactly once.
    const getNeighbors = makeGraph({
      seed: ['a', 'b'],
      a: ['c'],
      b: ['c'],
    });

    const result = walkBounded<string, TestEdge>(
      'seed',
      getNeighbors,
      getNextNode,
      getEdgeKey,
      getNodeKey,
      { depth: 3, maxNodes: 10 },
    );

    const cEdges = result.results.filter(r => r.edge.to === 'c');
    expect(cEdges).toHaveLength(1);
    expect(cEdges[0].hops).toBe(2);
    expect(result.results).toHaveLength(3); // a, b, c
  });

  it('truncates when maxNodes is exceeded, stopping the walk immediately', () => {
    const getNeighbors = makeGraph({
      seed: ['a', 'b', 'c', 'd', 'e'],
    });

    const result = walkBounded<string, TestEdge>(
      'seed',
      getNeighbors,
      getNextNode,
      getEdgeKey,
      getNodeKey,
      { depth: 2, maxNodes: 2 },
    );

    expect(result.results).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it('returns an empty result for depth < 1 or maxNodes < 1', () => {
    const getNeighbors = makeGraph({ seed: ['a'] });

    const zeroDepth = walkBounded<string, TestEdge>(
      'seed',
      getNeighbors,
      getNextNode,
      getEdgeKey,
      getNodeKey,
      { depth: 0, maxNodes: 10 },
    );
    expect(zeroDepth.results).toEqual([]);
    expect(zeroDepth.truncated).toBe(false);
    expect(zeroDepth.visitedCount).toBe(0);

    const zeroMaxNodes = walkBounded<string, TestEdge>(
      'seed',
      getNeighbors,
      getNextNode,
      getEdgeKey,
      getNodeKey,
      { depth: 2, maxNodes: 0 },
    );
    expect(zeroMaxNodes.results).toEqual([]);
    expect(zeroMaxNodes.visitedCount).toBe(0);
  });

  it('returns an empty result for a seed with no neighbors', () => {
    const getNeighbors = makeGraph({});

    const result = walkBounded<string, TestEdge>(
      'unknown',
      getNeighbors,
      getNextNode,
      getEdgeKey,
      getNodeKey,
      { depth: 2, maxNodes: 10 },
    );

    expect(result.results).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});
