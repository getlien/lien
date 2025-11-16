import chokidar from 'chokidar';
import { LienConfig, LegacyLienConfig, isLegacyConfig, isModernConfig } from '../config/schema.js';

export interface FileChangeEvent {
  type: 'add' | 'change' | 'unlink';
  filepath: string;
}

export type FileChangeHandler = (event: FileChangeEvent) => void | Promise<void>;

/**
 * File watcher service that monitors code files for changes.
 * Uses chokidar for robust file watching with debouncing support.
 */
export class FileWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private config: LienConfig | LegacyLienConfig;
  private rootDir: string;
  private onChangeHandler: FileChangeHandler | null = null;
  
  constructor(rootDir: string, config: LienConfig | LegacyLienConfig) {
    this.rootDir = rootDir;
    this.config = config;
  }
  
  /**
   * Starts watching files for changes.
   * 
   * @param handler - Callback function called when files change
   */
  async start(handler: FileChangeHandler): Promise<void> {
    if (this.watcher) {
      throw new Error('File watcher is already running');
    }
    
    this.onChangeHandler = handler;
    
    // Get watch patterns based on config type
    let includePatterns: string[];
    let excludePatterns: string[];
    
    if (isLegacyConfig(this.config)) {
      includePatterns = this.config.indexing.include;
      excludePatterns = this.config.indexing.exclude;
    } else if (isModernConfig(this.config)) {
      // For modern configs, aggregate patterns from all frameworks
      includePatterns = this.config.frameworks.flatMap(f => f.config.include);
      excludePatterns = this.config.frameworks.flatMap(f => f.config.exclude);
    } else {
      includePatterns = ['**/*'];
      excludePatterns = [];
    }
    
    // Configure chokidar
    this.watcher = chokidar.watch(includePatterns, {
      cwd: this.rootDir,
      ignored: excludePatterns,
      persistent: true,
      ignoreInitial: true, // Don't trigger for existing files
      awaitWriteFinish: {
        stabilityThreshold: 500, // Wait 500ms for file to stop changing
        pollInterval: 100,
      },
      // Performance optimizations
      usePolling: false,
      interval: 100,
      binaryInterval: 300,
    });
    
    // Register event handlers with debouncing
    this.watcher
      .on('add', (filepath) => this.handleChange('add', filepath))
      .on('change', (filepath) => this.handleChange('change', filepath))
      .on('unlink', (filepath) => this.handleChange('unlink', filepath))
      .on('error', (error) => {
        console.error(`[Lien] File watcher error: ${error}`);
      });
    
    // Wait for watcher to be ready
    await new Promise<void>((resolve) => {
      this.watcher!.on('ready', () => {
        resolve();
      });
    });
  }
  
  /**
   * Handles a file change event with debouncing.
   * Debouncing prevents rapid reindexing when files are saved multiple times quickly.
   */
  private handleChange(type: 'add' | 'change' | 'unlink', filepath: string): void {
    // Clear existing debounce timer for this file
    const existingTimer = this.debounceTimers.get(filepath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    // Set new debounce timer
    const timer = setTimeout(() => {
      this.debounceTimers.delete(filepath);
      
      // Call handler
      if (this.onChangeHandler) {
        const absolutePath = filepath.startsWith('/')
          ? filepath
          : `${this.rootDir}/${filepath}`;
        
        try {
          const result = this.onChangeHandler({
            type,
            filepath: absolutePath,
          });
          
          // Handle async handlers
          if (result instanceof Promise) {
            result.catch((error) => {
              console.error(`[Lien] Error handling file change: ${error}`);
            });
          }
        } catch (error) {
          console.error(`[Lien] Error handling file change: ${error}`);
        }
      }
    }, this.config.fileWatching.debounceMs);
    
    this.debounceTimers.set(filepath, timer);
  }
  
  /**
   * Stops the file watcher and cleans up resources.
   */
  async stop(): Promise<void> {
    if (!this.watcher) {
      return;
    }
    
    // Clear all pending debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    
    // Close watcher
    await this.watcher.close();
    this.watcher = null;
    this.onChangeHandler = null;
  }
  
  /**
   * Gets the list of files currently being watched.
   */
  getWatchedFiles(): string[] {
    if (!this.watcher) {
      return [];
    }
    
    const watched = this.watcher.getWatched();
    const files: string[] = [];
    
    for (const [dir, filenames] of Object.entries(watched)) {
      for (const filename of filenames) {
        files.push(`${dir}/${filename}`);
      }
    }
    
    return files;
  }
  
  /**
   * Checks if the watcher is currently running.
   */
  isRunning(): boolean {
    return this.watcher !== null;
  }
}

