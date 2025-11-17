import fs from 'fs/promises';
import path from 'path';
import { DetectionResult, DetectionOptions, defaultDetectionOptions } from './types.js';
import { frameworkDetectors } from './registry.js';

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
 * Detect frameworks at a specific path
 */
async function detectAtPath(
  rootDir: string,
  relativePath: string,
  results: DetectionResult[],
  visited: Set<string>
): Promise<void> {
  // Mark as visited
  const fullPath = path.join(rootDir, relativePath);
  if (visited.has(fullPath)) {
    return;
  }
  visited.add(fullPath);
  
  // Run all detectors and collect results
  const detectedAtPath: Array<DetectionResult & { priority: number }> = [];
  
  for (const detector of frameworkDetectors) {
    try {
      const result = await detector.detect(rootDir, relativePath);
      if (result.detected) {
        detectedAtPath.push({
          ...result,
          priority: detector.priority ?? 0,
        });
      }
    } catch (error) {
      // Log error but continue with other detectors
      console.error(`Error running detector '${detector.name}' at ${relativePath}:`, error);
    }
  }
  
  // Conflict resolution: if multiple frameworks detected at same path,
  // only keep the highest priority one
  if (detectedAtPath.length > 1) {
    // Sort by priority (highest first)
    detectedAtPath.sort((a, b) => b.priority - a.priority);
    
    // Keep only the highest priority framework
    const winner = detectedAtPath[0];
    results.push(winner);
    
    // Optional: Log what was skipped
    const skipped = detectedAtPath.slice(1);
    if (skipped.length > 0) {
      const skippedNames = skipped.map(d => d.name).join(', ');
      console.log(`  → Skipping ${skippedNames} at ${relativePath} (${winner.name} takes precedence)`);
    }
  } else if (detectedAtPath.length === 1) {
    results.push(detectedAtPath[0]);
  }
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

