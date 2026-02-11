import fs from 'fs/promises';
import path from 'path';
import pLimit from 'p-limit';
import type { VectorDBInterface } from '../vectordb/types.js';
import type { IndexManifest } from './manifest.js';
import { ManifestManager } from './manifest.js';
// scanFilesToIndex is imported from index.ts to avoid circular dependency
import { GitStateTracker } from '../git/tracker.js';
import { isGitAvailable, isGitRepo, getChangedFiles } from '../git/utils.js';
import { normalizeToRelativePath } from './incremental.js';
import { DEFAULT_STAT_CONCURRENCY } from '../constants.js';

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
  currentCommit: string
): Promise<ChangeDetectionResult> {
  const changedFilesAbsolute = await getChangedFiles(
    rootDir,
    savedManifest.gitState!.commit,
    currentCommit
  );
  const changedFilesPaths = changedFilesAbsolute.map(fp => normalizeToRelativePath(fp, rootDir));

  const allFiles = await getAllFiles(rootDir);
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
  savedManifest: IndexManifest
): Promise<ChangeDetectionResult> {
  const allFiles = await getAllFiles(rootDir);
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
  vectorDB: VectorDBInterface
): Promise<ChangeDetectionResult> {
  const manifest = new ManifestManager(vectorDB.dbPath);
  const savedManifest = await manifest.load();

  // No manifest = first run = full index
  if (!savedManifest) {
    const allFiles = await getAllFiles(rootDir);
    return { added: allFiles, modified: [], deleted: [], reason: 'full' };
  }

  // Check if git state has changed
  const gitCheck = await hasGitStateChanged(rootDir, vectorDB.dbPath, savedManifest.gitState);

  if (gitCheck.changed && gitCheck.currentState) {
    try {
      return await detectGitBasedChanges(rootDir, savedManifest, gitCheck.currentState.commit);
    } catch (error) {
      console.warn(`[Lien] Git diff failed, falling back to full reindex: ${error}`);
      return await fallbackToFullReindex(rootDir, savedManifest);
    }
  }

  // Use mtime-based detection for file-level changes
  return await mtimeBasedDetection(rootDir, savedManifest);
}

/**
 * Gets all files in the project by auto-detecting frameworks.
 * Always returns relative paths for consistent comparison with manifest and git diff.
 */
async function getAllFiles(rootDir: string): Promise<string[]> {
  // Use the same auto-detection logic as scanFilesToIndex
  // Import it from index.ts to reuse the framework detection logic
  const { scanFilesToIndex } = await import('./index.js');
  const files = await scanFilesToIndex(rootDir);
  
  // Normalize all paths to relative for consistent comparison
  return files.map((fp: string) => normalizeToRelativePath(fp, rootDir));
}

/**
 * Gather file modification times concurrently.
 */
async function gatherFileStats(
  files: string[],
  rootDir: string
): Promise<Map<string, number>> {
  const limit = pLimit(DEFAULT_STAT_CONCURRENCY);
  const fileStats = new Map<string, number>();
  await Promise.all(
    files.map(filepath => limit(async () => {
      try {
        const absolutePath = path.isAbsolute(filepath) ? filepath : path.join(rootDir, filepath);
        const stats = await fs.stat(absolutePath);
        fileStats.set(filepath, stats.mtimeMs);
      } catch {
        // File not accessible - skip
      }
    }))
  );
  return fileStats;
}

/**
 * Build a normalized map of manifest file paths for comparison.
 * Handles cases where manifest has absolute paths (from tests or legacy data).
 */
function buildNormalizedManifestMap(
  savedManifest: IndexManifest,
  rootDir: string
): Map<string, IndexManifest['files'][string]> {
  const normalized = new Map<string, IndexManifest['files'][string]>();
  for (const [filepath, entry] of Object.entries(savedManifest.files)) {
    normalized.set(normalizeToRelativePath(filepath, rootDir), entry);
  }
  return normalized;
}

/**
 * Classify files as added, modified, or deleted by comparing mtimes.
 */
function classifyByMtime(
  fileStats: Map<string, number>,
  manifestFiles: Map<string, IndexManifest['files'][string]>,
  currentFileSet: Set<string>
): { added: string[]; modified: string[]; deleted: string[] } {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const [filepath, mtime] of fileStats) {
    const entry = manifestFiles.get(filepath);
    if (!entry) {
      added.push(filepath);
    } else if (entry.lastModified < mtime) {
      modified.push(filepath);
    }
  }

  for (const normalizedPath of manifestFiles.keys()) {
    if (!currentFileSet.has(normalizedPath)) {
      deleted.push(normalizedPath);
    }
  }

  return { added, modified, deleted };
}

/**
 * Detects changes by comparing file modification times
 */
async function mtimeBasedDetection(
  rootDir: string,
  savedManifest: IndexManifest
): Promise<ChangeDetectionResult> {
  const currentFiles = await getAllFiles(rootDir);
  const currentFileSet = new Set(currentFiles);
  const fileStats = await gatherFileStats(currentFiles, rootDir);
  const manifestFiles = buildNormalizedManifestMap(savedManifest, rootDir);
  const { added, modified, deleted } = classifyByMtime(fileStats, manifestFiles, currentFileSet);

  return { added, modified, deleted, reason: 'mtime' };
}

