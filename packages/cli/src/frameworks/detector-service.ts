import fs from 'fs/promises';
import path from 'path';
import { DetectionResult, DetectionOptions, defaultDetectionOptions } from './types.js';
import { frameworkDetectors } from './registry.js';

/** Detection result with internal priority for conflict resolution */
export type DetectionWithPriority = DetectionResult & { priority: number };

/** Detections grouped by confidence level */
export interface GroupedDetections {
  high: DetectionWithPriority[];
  medium: DetectionWithPriority[];
  low: DetectionWithPriority[];
}

/**
 * Strip the internal priority property from a detection result.
 */
function stripPriority(detection: DetectionWithPriority): DetectionResult {
  const { priority, ...result } = detection;
  return result;
}

/**
 * Log skipped frameworks when lower confidence detections are ignored.
 */
function logSkippedFrameworks(
  skipped: DetectionWithPriority[],
  context?: { relativePath: string; winnerName: string }
): void {
  if (skipped.length === 0) return;

  const names = skipped.map(d => d.name).join(', ');

  if (context) {
    console.log(`  → Skipping ${names} at ${context.relativePath} (${context.winnerName} takes precedence)`);
  } else {
    console.log(`  → Skipping lower confidence detections: ${names}`);
  }
}

/**
 * Group detections by confidence level.
 */
export function groupByConfidence(detections: DetectionWithPriority[]): GroupedDetections {
  return {
    high: detections.filter(d => d.confidence === 'high'),
    medium: detections.filter(d => d.confidence === 'medium'),
    low: detections.filter(d => d.confidence === 'low'),
  };
}

/**
 * Select the winner from a list using priority (highest priority wins).
 * Returns the winner and the remaining (skipped) detections.
 *
 * @throws Error if detections array is empty
 */
export function selectByPriority(
  detections: DetectionWithPriority[]
): { winner: DetectionWithPriority; skipped: DetectionWithPriority[] } {
  if (detections.length === 0) {
    throw new Error('selectByPriority requires at least one detection');
  }
  const sorted = [...detections].sort((a, b) => b.priority - a.priority);
  return {
    winner: sorted[0],
    skipped: sorted.slice(1),
  };
}

/**
 * Resolve conflicts when multiple frameworks are detected at the same path.
 *
 * Resolution rules (applied in order):
 * 1. Multiple HIGH confidence → keep ALL (hybrid project support)
 * 2. Single HIGH confidence → keep it, skip lower confidence
 * 3. No HIGH but have MEDIUM → use priority to select winner
 * 4. Only LOW confidence → use priority to select winner
 *
 * @param detections - All detected frameworks with their priorities
 * @param relativePath - Path being analyzed (for logging)
 * @returns Array of resolved detection results
 */
export function resolveFrameworkConflicts(
  detections: DetectionWithPriority[],
  relativePath: string
): DetectionResult[] {
  // No detections
  if (detections.length === 0) {
    return [];
  }

  // Single detection - no conflict
  if (detections.length === 1) {
    return [stripPriority(detections[0])];
  }

  // Multiple detections - apply resolution rules
  const grouped = groupByConfidence(detections);

  // Rule 1: Multiple HIGH confidence → hybrid project (keep all)
  if (grouped.high.length > 1) {
    const names = grouped.high.map(d => d.name).join(' + ');
    console.log(`  → Detected hybrid project: ${names}`);
    logSkippedFrameworks([...grouped.medium, ...grouped.low]);
    return grouped.high.map(stripPriority);
  }

  // Rule 2: Single HIGH confidence → keep it
  if (grouped.high.length === 1) {
    logSkippedFrameworks([...grouped.medium, ...grouped.low]);
    return [stripPriority(grouped.high[0])];
  }

  // Rule 3: No HIGH but have MEDIUM → use priority
  if (grouped.medium.length > 0) {
    const { winner, skipped } = selectByPriority(grouped.medium);
    logSkippedFrameworks([...skipped, ...grouped.low], {
      relativePath,
      winnerName: winner.name,
    });
    return [stripPriority(winner)];
  }

  // Rule 4: Only LOW confidence → use priority
  const { winner, skipped } = selectByPriority(grouped.low);
  if (skipped.length > 0) {
    logSkippedFrameworks(skipped, { relativePath, winnerName: winner.name });
  }
  return [stripPriority(winner)];
}

/**
 * Run all framework detectors at a path and collect results.
 *
 * @param rootDir - Project root directory
 * @param relativePath - Path relative to root being scanned
 * @returns Array of detection results with priorities
 */
export async function runAllDetectors(
  rootDir: string,
  relativePath: string
): Promise<DetectionWithPriority[]> {
  const results: DetectionWithPriority[] = [];

  for (const detector of frameworkDetectors) {
    try {
      const result = await detector.detect(rootDir, relativePath);
      if (result.detected) {
        results.push({
          ...result,
          priority: detector.priority ?? 0,
        });
      }
    } catch (error) {
      console.error(`Error running detector '${detector.name}' at ${relativePath}:`, error);
    }
  }

  return results;
}

/**
 * Detect all frameworks in a monorepo by recursively scanning subdirectories
 * @param rootDir - Absolute path to project root
 * @param options - Detection options (max depth, skip dirs)
 * @returns Array of detected frameworks with their paths
 */
export async function detectAllFrameworks(
  rootDir: string,
  options: Partial<DetectionOptions> = {}
): Promise<DetectionResult[]> {
  const opts = { ...defaultDetectionOptions, ...options };
  const results: DetectionResult[] = [];
  const visited = new Set<string>();

  // Detect at root first
  await detectAtPath(rootDir, '.', results, visited);

  // Recursively scan subdirectories
  await scanSubdirectories(rootDir, '.', results, visited, 0, opts);

  return results;
}

/**
 * Detect frameworks at a specific path.
 *
 * Runs all detectors and resolves conflicts using confidence-based rules.
 * Now delegates to focused helper functions for better testability.
 */
async function detectAtPath(
  rootDir: string,
  relativePath: string,
  results: DetectionResult[],
  visited: Set<string>
): Promise<void> {
  // Guard: already visited
  const fullPath = path.join(rootDir, relativePath);
  if (visited.has(fullPath)) {
    return;
  }
  visited.add(fullPath);

  // Run detectors
  const detections = await runAllDetectors(rootDir, relativePath);

  // Resolve conflicts and add to results
  const resolved = resolveFrameworkConflicts(detections, relativePath);
  results.push(...resolved);
}

/**
 * Recursively scan subdirectories for frameworks
 */
async function scanSubdirectories(
  rootDir: string,
  relativePath: string,
  results: DetectionResult[],
  visited: Set<string>,
  depth: number,
  options: DetectionOptions
): Promise<void> {
  // Check depth limit
  if (depth >= options.maxDepth) {
    return;
  }
  
  const fullPath = path.join(rootDir, relativePath);
  
  try {
    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    
    // Process only directories
    const dirs = entries.filter(e => e.isDirectory());
    
    for (const dir of dirs) {
      // Skip directories in the skip list
      if (options.skipDirs.includes(dir.name)) {
        continue;
      }
      
      // Skip hidden directories (except .git, .github which are already in skipDirs)
      if (dir.name.startsWith('.')) {
        continue;
      }
      
      const subPath = relativePath === '.' 
        ? dir.name 
        : path.join(relativePath, dir.name);
      
      // Detect at this subdirectory
      await detectAtPath(rootDir, subPath, results, visited);
      
      // Recurse deeper
      await scanSubdirectories(rootDir, subPath, results, visited, depth + 1, options);
    }
  } catch (error) {
    // Silently skip directories we can't read (permission errors, etc.)
    return;
  }
}

/**
 * Get a human-readable summary of detected frameworks
 */
export function getDetectionSummary(results: DetectionResult[]): string {
  if (results.length === 0) {
    return 'No frameworks detected';
  }
  
  const lines: string[] = [];
  
  for (const result of results) {
    const pathDisplay = result.path === '.' ? 'root' : result.path;
    lines.push(`${result.name} at ${pathDisplay} (${result.confidence} confidence)`);
    
    if (result.evidence.length > 0) {
      result.evidence.forEach(e => {
        lines.push(`  - ${e}`);
      });
    }
  }
  
  return lines.join('\n');
}

