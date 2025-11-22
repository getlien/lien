import fs from 'fs/promises';
import { VectorDB } from '../vectordb/lancedb.js';
import { ManifestManager } from './manifest.js';
import { scanCodebase, scanCodebaseWithFrameworks } from './scanner.js';
import { LienConfig, LegacyLienConfig, isModernConfig, isLegacyConfig } from '../config/schema.js';
import { GitStateTracker } from '../git/tracker.js';
import { isGitAvailable, isGitRepo } from '../git/utils.js';

/**
 * Result of change detection, categorized by type of change
 */
export interface ChangeDetectionResult {
  added: string[];      // New files not in previous index
  modified: string[];   // Existing files that have been modified
  deleted: string[];    // Files that were indexed but no longer exist
  reason: 'mtime' | 'full' | 'git-state-changed';  // How changes were detected
}

/**
 * Detects which files have changed since last indexing.
 * Uses git state detection to handle branch switches, then falls back to mtime.
 * 
 * @param rootDir - Root directory of the project
 * @param vectorDB - Initialized VectorDB instance
 * @param config - Lien configuration
 * @returns Change detection result
 */
export async function detectChanges(
  rootDir: string,
  vectorDB: VectorDB,
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
  
  // Check if git state has changed (branch switch, new commits)
  // This is critical because git doesn't always update mtimes when checking out files
  const gitAvailable = await isGitAvailable();
  const isRepo = await isGitRepo(rootDir);
  
  if (gitAvailable && isRepo && savedManifest.gitState) {
    const gitTracker = new GitStateTracker(rootDir, vectorDB.dbPath);
    await gitTracker.initialize();
    
    const currentState = gitTracker.getState();
    
    // If branch or commit changed, force full reindex (mtime detection would miss changes)
    if (currentState && 
        (currentState.branch !== savedManifest.gitState.branch ||
         currentState.commit !== savedManifest.gitState.commit)) {
      const allFiles = await getAllFiles(rootDir, config);
      return {
        added: allFiles,
        modified: [],
        deleted: [],
        reason: 'git-state-changed',
      };
    }
  }
  
  // Use mtime-based detection for file-level changes
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

