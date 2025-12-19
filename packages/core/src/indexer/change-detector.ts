import fs from 'fs/promises';
import path from 'path';
import type { VectorDBInterface } from '../vectordb/types.js';
import { ManifestManager, IndexManifest } from './manifest.js';
import { scanCodebase, scanCodebaseWithFrameworks } from './scanner.js';
import { LienConfig, LegacyLienConfig, isModernConfig, isLegacyConfig } from '../config/schema.js';
import { GitStateTracker } from '../git/tracker.js';
import { isGitAvailable, isGitRepo, getChangedFiles } from '../git/utils.js';
import { normalizeToRelativePath } from './incremental.js';

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
 * Check if git state has changed (branch switch, new commits).
 */
async function hasGitStateChanged(
  rootDir: string,
  dbPath: string,
  savedGitState: IndexManifest['gitState']
): Promise<{ changed: boolean; currentState?: ReturnType<GitStateTracker['getState']> }> {
  if (!savedGitState) return { changed: false };

  const gitAvailable = await isGitAvailable();
  const isRepo = await isGitRepo(rootDir);
  if (!gitAvailable || !isRepo) return { changed: false };

  const gitTracker = new GitStateTracker(rootDir, dbPath);
  await gitTracker.initialize();
  const currentState = gitTracker.getState();

  if (!currentState) return { changed: false };

  const changed = currentState.branch !== savedGitState.branch ||
                  currentState.commit !== savedGitState.commit;

  return { changed, currentState };
}

/**
 * Categorize files from git diff into added, modified, deleted.
 */
function categorizeChangedFiles(
  changedFilesPaths: string[],
  currentFileSet: Set<string>,
  normalizedManifestFiles: Set<string>,
  allFiles: string[]
): { added: string[]; modified: string[]; deleted: string[] } {
  const changedFilesSet = new Set(changedFilesPaths);
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  // Categorize files from git diff
  for (const filepath of changedFilesPaths) {
    if (currentFileSet.has(filepath)) {
      if (normalizedManifestFiles.has(filepath)) {
        modified.push(filepath);
      } else {
        added.push(filepath);
      }
    }
  }

  // Find truly new files (not in git diff, but not in old manifest)
  for (const filepath of allFiles) {
    if (!normalizedManifestFiles.has(filepath) && !changedFilesSet.has(filepath)) {
      added.push(filepath);
    }
  }

  // Find deleted files (in old manifest but not in current)
  for (const normalizedPath of normalizedManifestFiles) {
    if (!currentFileSet.has(normalizedPath)) {
      deleted.push(normalizedPath);
    }
  }

  return { added, modified, deleted };
}

/**
 * Build normalized set of manifest file paths for comparison.
 */
function normalizeManifestPaths(
  manifestFiles: IndexManifest['files'],
  rootDir: string
): Set<string> {
  const normalized = new Set<string>();
  for (const filepath of Object.keys(manifestFiles)) {
    normalized.add(normalizeToRelativePath(filepath, rootDir));
  }
  return normalized;
}

/**
 * Detect changes using git diff between commits.
 */
async function detectGitBasedChanges(
  rootDir: string,
  savedManifest: IndexManifest,
  currentCommit: string,
  config: LienConfig | LegacyLienConfig
): Promise<ChangeDetectionResult> {
  const changedFilesAbsolute = await getChangedFiles(
    rootDir,
    savedManifest.gitState!.commit,
    currentCommit
  );
  const changedFilesPaths = changedFilesAbsolute.map(fp => normalizeToRelativePath(fp, rootDir));

  const allFiles = await getAllFiles(rootDir, config);
  const currentFileSet = new Set(allFiles);
  const normalizedManifestFiles = normalizeManifestPaths(savedManifest.files, rootDir);

  const { added, modified, deleted } = categorizeChangedFiles(
    changedFilesPaths,
    currentFileSet,
    normalizedManifestFiles,
    allFiles
  );

  return { added, modified, deleted, reason: 'git-state-changed' };
}

/**
 * Fall back to full reindex when git diff fails.
 */
async function fallbackToFullReindex(
  rootDir: string,
  savedManifest: IndexManifest,
  config: LienConfig | LegacyLienConfig
): Promise<ChangeDetectionResult> {
  const allFiles = await getAllFiles(rootDir, config);
  const currentFileSet = new Set(allFiles);

  const deleted: string[] = [];
  for (const filepath of Object.keys(savedManifest.files)) {
    const normalizedPath = normalizeToRelativePath(filepath, rootDir);
    if (!currentFileSet.has(normalizedPath)) {
      deleted.push(normalizedPath);
    }
  }

  return { added: allFiles, modified: [], deleted, reason: 'git-state-changed' };
}

/**
 * Detects which files have changed since last indexing.
 * Uses git state detection to handle branch switches, then falls back to mtime.
 */
export async function detectChanges(
  rootDir: string,
  vectorDB: VectorDBInterface,
  config: LienConfig | LegacyLienConfig
): Promise<ChangeDetectionResult> {
  const manifest = new ManifestManager(vectorDB.dbPath);
  const savedManifest = await manifest.load();

  // No manifest = first run = full index
  if (!savedManifest) {
    const allFiles = await getAllFiles(rootDir, config);
    return { added: allFiles, modified: [], deleted: [], reason: 'full' };
  }

  // Check if git state has changed
  const gitCheck = await hasGitStateChanged(rootDir, vectorDB.dbPath, savedManifest.gitState);

  if (gitCheck.changed && gitCheck.currentState) {
    try {
      return await detectGitBasedChanges(rootDir, savedManifest, gitCheck.currentState.commit, config);
    } catch (error) {
      console.warn(`[Lien] Git diff failed, falling back to full reindex: ${error}`);
      return await fallbackToFullReindex(rootDir, savedManifest, config);
    }
  }

  // Use mtime-based detection for file-level changes
  return await mtimeBasedDetection(rootDir, savedManifest, config);
}

/**
 * Gets all files in the project based on configuration.
 * Always returns relative paths for consistent comparison with manifest and git diff.
 */
async function getAllFiles(
  rootDir: string,
  config: LienConfig | LegacyLienConfig
): Promise<string[]> {
  let files: string[];
  
  if (isModernConfig(config) && config.frameworks.length > 0) {
    files = await scanCodebaseWithFrameworks(rootDir, config);
  } else if (isLegacyConfig(config)) {
    files = await scanCodebase({
      rootDir,
      includePatterns: config.indexing.include,
      excludePatterns: config.indexing.exclude,
    });
  } else {
    files = await scanCodebase({
      rootDir,
      includePatterns: [],
      excludePatterns: [],
    });
  }
  
  // Normalize all paths to relative for consistent comparison
  return files.map(fp => normalizeToRelativePath(fp, rootDir));
}

/**
 * Detects changes by comparing file modification times
 */
async function mtimeBasedDetection(
  rootDir: string,
  savedManifest: IndexManifest,
  config: LienConfig | LegacyLienConfig
): Promise<ChangeDetectionResult> {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  
  // Get all current files (already normalized to relative paths by getAllFiles)
  const currentFiles = await getAllFiles(rootDir, config);
  const currentFileSet = new Set(currentFiles);
  
  // Build a normalized map of manifest files for comparison
  // This handles cases where manifest has absolute paths (from tests or legacy data)
  const normalizedManifestFiles = new Map<string, typeof savedManifest.files[string]>();
  for (const [filepath, entry] of Object.entries(savedManifest.files)) {
    const normalizedPath = normalizeToRelativePath(filepath, rootDir);
    normalizedManifestFiles.set(normalizedPath, entry);
  }
  
  // Get mtimes for all current files
  // Note: need to construct absolute path for fs.stat since currentFiles are relative
  const fileStats = new Map<string, number>();
  
  for (const filepath of currentFiles) {
    try {
      // Construct absolute path for filesystem access (use path.join for cross-platform)
      const absolutePath = path.isAbsolute(filepath) ? filepath : path.join(rootDir, filepath);
      const stats = await fs.stat(absolutePath);
      fileStats.set(filepath, stats.mtimeMs);
    } catch {
      // Ignore files we can't stat
      continue;
    }
  }
  
  // Check for new and modified files
  for (const [filepath, mtime] of fileStats) {
    const entry = normalizedManifestFiles.get(filepath);
    
    if (!entry) {
      // New file
      added.push(filepath);
    } else if (entry.lastModified < mtime) {
      // File modified since last index
      modified.push(filepath);
    }
  }
  
  // Check for deleted files (use normalized manifest paths)
  for (const normalizedPath of normalizedManifestFiles.keys()) {
    if (!currentFileSet.has(normalizedPath)) {
      deleted.push(normalizedPath);
    }
  }
  
  return {
    added,
    modified,
    deleted,
    reason: 'mtime',
  };
}

