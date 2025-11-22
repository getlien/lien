import fs from 'fs/promises';
import { VectorDB } from '../vectordb/lancedb.js';
import { GitStateTracker } from '../git/tracker.js';
import { ManifestManager } from './manifest.js';
import { scanCodebase, scanCodebaseWithFrameworks } from './scanner.js';
import { LienConfig, LegacyLienConfig, isModernConfig, isLegacyConfig } from '../config/schema.js';

/**
 * Result of change detection, categorized by type of change
 */
export interface ChangeDetectionResult {
  added: string[];      // New files not in previous index
  modified: string[];   // Existing files that have been modified
  deleted: string[];    // Files that were indexed but no longer exist
  reason: 'git' | 'mtime' | 'full';  // How changes were detected
}

/**
 * Detects which files have changed since last indexing.
 * Uses a multi-tiered strategy:
 * 1. Git-based detection (fast, accurate, requires git)
 * 2. mtime-based detection (slower, works everywhere)
 * 3. Full reindex (no manifest exists)
 * 
 * @param rootDir - Root directory of the project
 * @param vectorDB - Initialized VectorDB instance
 * @param gitTracker - Optional GitStateTracker (if git available)
 * @param config - Lien configuration
 * @returns Change detection result
 */
export async function detectChanges(
  rootDir: string,
  vectorDB: VectorDB,
  gitTracker: GitStateTracker | null,
  config: LienConfig | LegacyLienConfig
): Promise<ChangeDetectionResult> {
  const manifest = new ManifestManager(vectorDB.dbPath);
  const savedManifest = await manifest.load();
  
  // No manifest = first run = full index
  if (!savedManifest) {
    const allFiles = await getAllFiles(rootDir, config);
    return {
      added: allFiles,
      modified: [],
      deleted: [],
      reason: 'full',
    };
  }
  
  // Try git-based detection first (fastest)
  if (gitTracker && savedManifest.gitState) {
    try {
      const gitChanges = await gitTracker.detectChanges();
      
      if (gitChanges && gitChanges.length > 0) {
        return await categorizeGitChanges(gitChanges, savedManifest, rootDir);
      }
      
      // No git changes detected
      return {
        added: [],
        modified: [],
        deleted: [],
        reason: 'git',
      };
    } catch (error) {
      console.error(`[Lien] Git detection failed: ${error}`);
      // Fall through to mtime-based detection
    }
  }
  
  // Fallback to mtime-based detection
  return await mtimeBasedDetection(rootDir, savedManifest, config);
}

/**
 * Gets all files in the project based on configuration
 */
async function getAllFiles(
  rootDir: string,
  config: LienConfig | LegacyLienConfig
): Promise<string[]> {
  if (isModernConfig(config) && config.frameworks.length > 0) {
    return await scanCodebaseWithFrameworks(rootDir, config);
  } else if (isLegacyConfig(config)) {
    return await scanCodebase({
      rootDir,
      includePatterns: config.indexing.include,
      excludePatterns: config.indexing.exclude,
    });
  } else {
    return await scanCodebase({
      rootDir,
      includePatterns: [],
      excludePatterns: [],
    });
  }
}

/**
 * Categorizes git changes into added, modified, and deleted
 */
async function categorizeGitChanges(
  gitChanges: string[],
  savedManifest: any,
  rootDir: string
): Promise<ChangeDetectionResult> {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  
  for (const filepath of gitChanges) {
    // Resolve to absolute path if relative
    const absolutePath = filepath.startsWith('/')
      ? filepath
      : `${rootDir}/${filepath}`;
    
    // Check if file exists
    try {
      await fs.access(absolutePath);
      
      // File exists - either added or modified
      if (savedManifest.files[absolutePath]) {
        modified.push(absolutePath);
      } else {
        added.push(absolutePath);
      }
    } catch {
      // File doesn't exist - it was deleted
      if (savedManifest.files[absolutePath]) {
        deleted.push(absolutePath);
      }
      // If it's not in manifest and doesn't exist, ignore it
    }
  }
  
  return {
    added,
    modified,
    deleted,
    reason: 'git',
  };
}

/**
 * Detects changes by comparing file modification times
 */
async function mtimeBasedDetection(
  rootDir: string,
  savedManifest: any,
  config: LienConfig | LegacyLienConfig
): Promise<ChangeDetectionResult> {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  
  // Get all current files
  const currentFiles = await getAllFiles(rootDir, config);
  const currentFileSet = new Set(currentFiles);
  
  // Get mtimes for all current files
  const fileStats = new Map<string, number>();
  
  for (const filepath of currentFiles) {
    try {
      const stats = await fs.stat(filepath);
      fileStats.set(filepath, stats.mtimeMs);
    } catch {
      // Ignore files we can't stat
      continue;
    }
  }
  
  // Check for new and modified files
  for (const [filepath, mtime] of fileStats) {
    const entry = savedManifest.files[filepath];
    
    if (!entry) {
      // New file
      added.push(filepath);
    } else if (entry.lastModified < mtime) {
      // File modified since last index
      modified.push(filepath);
    }
  }
  
  // Check for deleted files
  for (const filepath of Object.keys(savedManifest.files)) {
    if (!currentFileSet.has(filepath)) {
      deleted.push(filepath);
    }
  }
  
  return {
    added,
    modified,
    deleted,
    reason: 'mtime',
  };
}

