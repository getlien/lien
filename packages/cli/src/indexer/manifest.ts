import fs from 'fs/promises';
import path from 'path';
import { INDEX_FORMAT_VERSION } from '../constants.js';
import { GitState } from '../git/tracker.js';
import { getPackageVersion } from '../utils/version.js';

const MANIFEST_FILE = 'manifest.json';

/**
 * Represents a single file in the index manifest
 */
export interface FileEntry {
  filepath: string;
  lastModified: number;
  chunkCount: number;
}

/**
 * Index manifest tracking all indexed files and version information
 */
export interface IndexManifest {
  formatVersion: number;      // Index format version for compatibility checking
  lienVersion: string;         // Lien package version (for reference)
  lastIndexed: number;         // Timestamp of last indexing operation
  gitState?: GitState;         // Last known git state
  files: Record<string, FileEntry>;  // Map of filepath -> FileEntry (stored as object for JSON)
}

/**
 * Manages the index manifest file, tracking which files are indexed
 * and their metadata for incremental indexing support.
 * 
 * The manifest includes version checking to invalidate indices when
 * Lien's indexing format changes (e.g., new chunking algorithm,
 * different embedding model, schema changes).
 */
export class ManifestManager {
  private manifestPath: string;
  private indexPath: string;
  
  /**
   * Promise-based lock to prevent race conditions during concurrent updates.
   * Ensures read-modify-write operations are atomic.
   */
  private updateLock = Promise.resolve();
  
  /**
   * Creates a new ManifestManager
   * @param indexPath - Path to the index directory (same as VectorDB path)
   */
  constructor(indexPath: string) {
    this.indexPath = indexPath;
    this.manifestPath = path.join(indexPath, MANIFEST_FILE);
  }
  
  /**
   * Loads the manifest from disk.
   * Returns null if:
   * - Manifest doesn't exist (first run)
   * - Manifest is corrupt
   * - Format version is incompatible (triggers full reindex)
   * 
   * @returns Loaded manifest or null
   */
  async load(): Promise<IndexManifest | null> {
    try {
      const content = await fs.readFile(this.manifestPath, 'utf-8');
      const manifest = JSON.parse(content) as IndexManifest;
      
      // VERSION CHECK: Invalidate if format version doesn't match
      if (manifest.formatVersion !== INDEX_FORMAT_VERSION) {
        console.error(
          `[Lien] Index format v${manifest.formatVersion} is incompatible with current v${INDEX_FORMAT_VERSION}`
        );
        console.error(`[Lien] Full reindex required after Lien upgrade`);
        
        // Clear old manifest and return null (triggers full reindex)
        await this.clear();
        return null;
      }
      
      return manifest;
    } catch (error) {
      // File doesn't exist or is invalid - return null for first run
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      
      // Corrupt manifest - log warning and return null
      console.error(`[Lien] Warning: Failed to load manifest: ${error}`);
      return null;
    }
  }
  
  /**
   * Saves the manifest to disk.
   * Always saves with current format and package versions.
   * 
   * @param manifest - Manifest to save
   */
  async save(manifest: IndexManifest): Promise<void> {
    try {
      // Ensure index directory exists
      await fs.mkdir(this.indexPath, { recursive: true });
      
      // Always save with current versions
      const manifestToSave: IndexManifest = {
        ...manifest,
        formatVersion: INDEX_FORMAT_VERSION,
        lienVersion: getPackageVersion(),
        lastIndexed: Date.now(),
      };
      
      const content = JSON.stringify(manifestToSave, null, 2);
      await fs.writeFile(this.manifestPath, content, 'utf-8');
    } catch (error) {
      // Don't throw - manifest is best-effort
      console.error(`[Lien] Warning: Failed to save manifest: ${error}`);
    }
  }
  
  /**
   * Adds or updates a file entry in the manifest.
   * Protected by lock to prevent race conditions during concurrent updates.
   * 
   * @param filepath - Path to the file
   * @param entry - File entry metadata
   */
  async updateFile(filepath: string, entry: FileEntry): Promise<void> {
    // Chain this operation to the lock to ensure atomicity
    this.updateLock = this.updateLock.then(async () => {
      const manifest = await this.load() || this.createEmpty();
      manifest.files[filepath] = entry;
      await this.save(manifest);
    }).catch(error => {
      console.error(`[Lien] Failed to update manifest for ${filepath}: ${error}`);
      // Return to reset lock - don't let errors block future operations
      return undefined;
    });
    
    // Wait for this operation to complete
    await this.updateLock;
  }
  
  /**
   * Removes a file entry from the manifest.
   * Protected by lock to prevent race conditions during concurrent updates.
   * 
   * Note: If the manifest doesn't exist, this is a no-op (not an error).
   * This can happen legitimately after clearing the index or on fresh installs.
   * 
   * @param filepath - Path to the file to remove
   */
  async removeFile(filepath: string): Promise<void> {
    // Chain this operation to the lock to ensure atomicity
    this.updateLock = this.updateLock.then(async () => {
      const manifest = await this.load();
      if (!manifest) {
        // No manifest exists - nothing to remove from (expected in some scenarios)
        return;
      }
      
      delete manifest.files[filepath];
      await this.save(manifest);
    }).catch(error => {
      console.error(`[Lien] Failed to remove manifest entry for ${filepath}: ${error}`);
      // Return to reset lock - don't let errors block future operations
      return undefined;
    });
    
    // Wait for this operation to complete
    await this.updateLock;
  }
  
  /**
   * Updates multiple files at once (more efficient than individual updates).
   * Protected by lock to prevent race conditions during concurrent updates.
   * 
   * @param entries - Array of file entries to update
   */
  async updateFiles(entries: FileEntry[]): Promise<void> {
    // Chain this operation to the lock to ensure atomicity
    this.updateLock = this.updateLock.then(async () => {
      const manifest = await this.load() || this.createEmpty();
      
      for (const entry of entries) {
        manifest.files[entry.filepath] = entry;
      }
      
      await this.save(manifest);
    }).catch(error => {
      console.error(`[Lien] Failed to update manifest for ${entries.length} files: ${error}`);
      // Return to reset lock - don't let errors block future operations
      return undefined;
    });
    
    // Wait for this operation to complete
    await this.updateLock;
  }
  
  /**
   * Updates the git state in the manifest.
   * Protected by lock to prevent race conditions during concurrent updates.
   * 
   * @param gitState - Current git state
   */
  async updateGitState(gitState: GitState): Promise<void> {
    // Chain this operation to the lock to ensure atomicity
    this.updateLock = this.updateLock.then(async () => {
      const manifest = await this.load() || this.createEmpty();
      
      manifest.gitState = gitState;
      await this.save(manifest);
    }).catch(error => {
      console.error(`[Lien] Failed to update git state in manifest: ${error}`);
      // Return to reset lock - don't let errors block future operations
      return undefined;
    });
    
    // Wait for this operation to complete
    await this.updateLock;
  }
  
  /**
   * Gets the list of files currently in the manifest
   * 
   * @returns Array of filepaths
   */
  async getIndexedFiles(): Promise<string[]> {
    const manifest = await this.load();
    if (!manifest) return [];
    
    return Object.keys(manifest.files);
  }
  
  /**
   * Detects which files have changed based on mtime comparison
   * 
   * @param currentFiles - Map of current files with their mtimes
   * @returns Array of filepaths that have changed
   */
  async getChangedFiles(currentFiles: Map<string, number>): Promise<string[]> {
    const manifest = await this.load();
    if (!manifest) {
      // No manifest = all files are "changed" (need full index)
      return Array.from(currentFiles.keys());
    }
    
    const changedFiles: string[] = [];
    
    for (const [filepath, mtime] of currentFiles) {
      const entry = manifest.files[filepath];
      
      if (!entry) {
        // New file
        changedFiles.push(filepath);
      } else if (entry.lastModified < mtime) {
        // File modified since last index
        changedFiles.push(filepath);
      }
    }
    
    return changedFiles;
  }
  
  /**
   * Gets files that are in the manifest but not in the current file list
   * (i.e., deleted files)
   * 
   * @param currentFiles - Set of current file paths
   * @returns Array of deleted file paths
   */
  async getDeletedFiles(currentFiles: Set<string>): Promise<string[]> {
    const manifest = await this.load();
    if (!manifest) return [];
    
    const deletedFiles: string[] = [];
    
    for (const filepath of Object.keys(manifest.files)) {
      if (!currentFiles.has(filepath)) {
        deletedFiles.push(filepath);
      }
    }
    
    return deletedFiles;
  }
  
  /**
   * Clears the manifest file
   */
  async clear(): Promise<void> {
    try {
      await fs.unlink(this.manifestPath);
    } catch (error) {
      // Ignore error if file doesn't exist
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[Lien] Warning: Failed to clear manifest: ${error}`);
      }
    }
  }
  
  /**
   * Creates an empty manifest with current version information
   * 
   * @returns Empty manifest
   */
  private createEmpty(): IndexManifest {
    return {
      formatVersion: INDEX_FORMAT_VERSION,
      lienVersion: getPackageVersion(),
      lastIndexed: Date.now(),
      files: {},
    };
  }
}

