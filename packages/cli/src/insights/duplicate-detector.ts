/**
 * Duplicate code detection using stored embedding vectors.
 * 
 * Algorithm:
 * 1. Compute pairwise cosine distances between function embeddings
 * 2. Build adjacency graph where edges exist if similarity > threshold
 * 3. Find connected components (clusters) in the graph
 * 4. Filter and rank clusters by impact
 */

import { SearchResultWithVector } from '../vectordb/types.js';
import { DuplicateCluster, DuplicateInstance, DuplicateAnalysis, DuplicateSummary } from './types.js';

/**
 * Cosine distance between two vectors (0 = identical, 2 = opposite)
 */
function cosineDistance(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 2;
  return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Convert cosine distance to similarity (0-1)
 * Distance 0 = similarity 1 (identical)
 * Distance 2 = similarity 0 (opposite)
 */
function distanceToSimilarity(distance: number): number {
  return 1 - distance / 2;
}

export interface DuplicateOptions {
  /** Minimum similarity to consider duplicate (default: 0.90) */
  threshold?: number;
  /** Minimum cluster size (default: 2) */
  minClusterSize?: number;
  /** Maximum clusters to return (default: 20) */
  maxClusters?: number;
}

/**
 * Common build output directories to exclude from duplicate analysis.
 * These contain compiled versions of source code which aren't useful duplicates.
 */
const BUILD_OUTPUT_PATTERNS = [
  '/dist/',
  '/build/',
  '/out/',
  '/.next/',
  '/node_modules/',
];

/**
 * Check if a file path is in a build output directory.
 */
function isBuildOutput(filepath: string): boolean {
  const normalized = filepath.replace(/\\/g, '/');
  return BUILD_OUTPUT_PATTERNS.some(pattern => normalized.includes(pattern));
}

/**
 * Deduplicate chunks by file + line range and filter out build output.
 * The index may contain duplicate entries from incremental reindexing.
 */
function deduplicateChunks(chunks: SearchResultWithVector[]): SearchResultWithVector[] {
  const seen = new Set<string>();
  const result: SearchResultWithVector[] = [];
  
  for (const chunk of chunks) {
    // Skip build output directories
    if (isBuildOutput(chunk.metadata.file)) continue;
    
    const key = `${chunk.metadata.file}:${chunk.metadata.startLine}-${chunk.metadata.endLine}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(chunk);
    }
  }
  
  return result;
}

/**
 * Find duplicate code clusters using stored embeddings.
 * Uses connected components algorithm on similarity graph.
 */
export function findDuplicates(
  chunks: SearchResultWithVector[],
  options: DuplicateOptions = {}
): DuplicateAnalysis {
  const {
    threshold = 0.90,
    minClusterSize = 2,
    maxClusters = 20,
  } = options;

  // Deduplicate chunks (index may have duplicates from incremental reindexing)
  const uniqueChunks = deduplicateChunks(chunks);

  if (uniqueChunks.length === 0) {
    return {
      summary: createEmptySummary(),
      clusters: [],
    };
  }

  // Convert similarity threshold to distance threshold
  // similarity = 1 - distance/2, so distance = 2 * (1 - similarity)
  const distanceThreshold = 2 * (1 - threshold);
  
  // Build adjacency list for similarity graph
  const adjacency = buildSimilarityGraph(uniqueChunks, distanceThreshold);

  // Find connected components (clusters)
  const clusters = findConnectedComponents(adjacency, uniqueChunks, minClusterSize);

  // Sort by impact (count * lines) and limit
  const sortedClusters = clusters
    .sort((a, b) => (b.count * b.totalLines) - (a.count * a.totalLines))
    .slice(0, maxClusters);

  // Build summary (use uniqueChunks count for accuracy)
  const summary = buildSummary(sortedClusters, uniqueChunks.length);

  return { summary, clusters: sortedClusters };
}

/**
 * Build adjacency graph based on vector similarity.
 * O(n²) pairwise comparison, but fast since it's just array math.
 */
function buildSimilarityGraph(
  chunks: SearchResultWithVector[],
  distanceThreshold: number
): Map<number, number[]> {
  const adjacency = new Map<number, number[]>();
  
  for (let i = 0; i < chunks.length; i++) {
    for (let j = i + 1; j < chunks.length; j++) {
      const dist = cosineDistance(chunks[i].vector, chunks[j].vector);
      
      if (dist < distanceThreshold) {
        // Add bidirectional edges
        if (!adjacency.has(i)) adjacency.set(i, []);
        if (!adjacency.has(j)) adjacency.set(j, []);
        adjacency.get(i)!.push(j);
        adjacency.get(j)!.push(i);
      }
    }
  }
  
  return adjacency;
}

/**
 * Find connected components in the similarity graph.
 * Each component becomes a duplicate cluster.
 */
function findConnectedComponents(
  adjacency: Map<number, number[]>,
  chunks: SearchResultWithVector[],
  minClusterSize: number
): DuplicateCluster[] {
  const visited = new Set<number>();
  const clusters: DuplicateCluster[] = [];
  let clusterId = 0;

  for (const [startNode] of adjacency) {
    if (visited.has(startNode)) continue;

    // BFS to find component
    const component: number[] = [];
    const queue = [startNode];

    while (queue.length > 0) {
      const node = queue.shift()!;
      if (visited.has(node)) continue;
      
      visited.add(node);
      component.push(node);

      for (const neighbor of adjacency.get(node) || []) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }

    // Only keep clusters above minimum size
    if (component.length >= minClusterSize) {
      clusters.push(buildCluster(++clusterId, component, chunks));
    }
  }

  return clusters;
}

/**
 * Build a DuplicateCluster from component indices.
 */
function buildCluster(
  id: number,
  indices: number[],
  chunks: SearchResultWithVector[]
): DuplicateCluster {
  const instances: DuplicateInstance[] = indices.map(i => {
    const chunk = chunks[i];
    return {
      filepath: chunk.metadata.file,
      startLine: chunk.metadata.startLine,
      endLine: chunk.metadata.endLine,
      symbolName: chunk.metadata.symbolName || 'anonymous',
      symbolType: chunk.metadata.symbolType as 'function' | 'method',
      language: chunk.metadata.language,
    };
  });

  // Calculate average pairwise similarity within cluster
  let totalSimilarity = 0;
  let pairs = 0;
  for (let i = 0; i < indices.length; i++) {
    for (let j = i + 1; j < indices.length; j++) {
      const dist = cosineDistance(chunks[indices[i]].vector, chunks[indices[j]].vector);
      totalSimilarity += distanceToSimilarity(dist);
      pairs++;
    }
  }
  const avgSimilarity = pairs > 0 ? totalSimilarity / pairs : 1;

  const totalLines = instances.reduce(
    (sum, inst) => sum + (inst.endLine - inst.startLine + 1),
    0
  );

  return {
    id: `cluster-${id}`,
    similarity: Math.round(avgSimilarity * 100) / 100,
    count: instances.length,
    totalLines,
    instances,
    suggestion: generateSuggestion(instances),
  };
}

/**
 * Generate actionable suggestion based on cluster characteristics.
 */
function generateSuggestion(instances: DuplicateInstance[]): string {
  const uniqueFiles = new Set(instances.map(i => i.filepath)).size;
  const names = instances.map(i => i.symbolName).filter(n => n !== 'anonymous');
  
  // Find common prefix in function names
  if (names.length >= 2) {
    const sorted = names.sort();
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    let i = 0;
    while (i < first.length && first[i] === last[i]) i++;
    const prefix = first.substring(0, i);
    
    if (prefix.length >= 4 && uniqueFiles > 1) {
      return `Consider extracting shared ${prefix}*() logic to a utility module`;
    }
  }
  
  if (uniqueFiles > 1) {
    return 'Consider extracting to a shared utility function';
  }
  return 'Consider consolidating duplicate logic within file';
}

/**
 * Build summary statistics from clusters.
 */
function buildSummary(clusters: DuplicateCluster[], totalFunctions: number): DuplicateSummary {
  const totalInstances = clusters.reduce((sum, c) => sum + c.count, 0);
  const totalLines = clusters.reduce((sum, c) => sum + c.totalLines, 0);

  return {
    functionsAnalyzed: totalFunctions,
    clustersFound: clusters.length,
    totalDuplicateInstances: totalInstances,
    estimatedDuplicateLines: totalLines,
    duplicationRatio: totalFunctions > 0 ? totalInstances / totalFunctions : 0,
  };
}

/**
 * Create empty summary for when there are no chunks to analyze.
 */
function createEmptySummary(): DuplicateSummary {
  return {
    functionsAnalyzed: 0,
    clustersFound: 0,
    totalDuplicateInstances: 0,
    estimatedDuplicateLines: 0,
    duplicationRatio: 0,
  };
}
