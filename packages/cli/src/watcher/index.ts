import chokidar from 'chokidar';
import path from 'path';
import { detectAllFrameworks, getFrameworkDetector, DEFAULT_DEBOUNCE_MS } from '@liendev/core';
import type { FrameworkConfig } from '@liendev/core';

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
  private rootDir: string;
  private onChangeHandler: FileChangeHandler | null = null;
  
  constructor(rootDir: string) {
    this.rootDir = rootDir;
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
    
    // Auto-detect frameworks to get watch patterns
    let includePatterns: string[];
    let excludePatterns: string[];
    
    try {
      const detectedFrameworks = await detectAllFrameworks(this.rootDir);
      
      if (detectedFrameworks.length > 0) {
        // Convert detected frameworks to get their config
        const frameworks = await Promise.all(
          detectedFrameworks.map(async (detection) => {
            const detector = getFrameworkDetector(detection.name);
            if (!detector) {
              return null;
            }
            const config = await detector.generateConfig(this.rootDir, detection.path);
            return {
              name: detection.name,
              path: detection.path,
              enabled: true,
              config: config as FrameworkConfig,
            };
          })
        );
        
        const validFrameworks = frameworks.filter(f => f !== null);
        includePatterns = validFrameworks.flatMap(f => f!.config.include);
        excludePatterns = validFrameworks.flatMap(f => f!.config.exclude);
        
        // Fallback: if no patterns, use defaults
        if (includePatterns.length === 0) {
          includePatterns = ['**/*'];
          excludePatterns = [];
        }
      } else {
        // No frameworks detected - use default patterns
        includePatterns = ['**/*'];
        excludePatterns = [
          '**/node_modules/**',
          '**/vendor/**',
          '**/dist/**',
          '**/build/**',
          '**/.git/**',
        ];
      }
    } catch (error) {
      // Fallback to defaults if detection fails
      includePatterns = ['**/*'];
      excludePatterns = [
        '**/node_modules/**',
        '**/vendor/**',
        '**/dist/**',
        '**/build/**',
        '**/.git/**',
      ];
    }
    
    // Configure chokidar
    this.watcher = chokidar.watch(includePatterns, {
      cwd: this.rootDir,
      ignored: excludePatterns,
      persistent: true,
      ignoreInitial: true, // Don't trigger for existing files
      
      // Handle atomic saves from modern editors (VS Code, Sublime, etc.)
      // Editors write to temp file then rename - without this, we get unlink+add instead of change
      atomic: true,
      
      awaitWriteFinish: {
        stabilityThreshold: 300, // Reduced from 500ms for faster detection
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
    // Fix: Add timeout fallback in case 'ready' event never fires (race condition)
    let readyFired = false;
    await Promise.race([
      new Promise<void>((resolve) => {
        const readyHandler = () => {
          readyFired = true;
          resolve();
        };
        this.watcher!.once('ready', readyHandler);
      }),
      new Promise<void>((resolve) => {
        // Timeout fallback: if ready doesn't fire within 5 seconds, resolve anyway
        setTimeout(() => {
          if (!readyFired) {
            resolve();
          }
        }, 5000);
      }),
    ]);
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
        // Use path.join for proper cross-platform path handling
        const absolutePath = path.isAbsolute(filepath)
          ? filepath
          : path.join(this.rootDir, filepath);
        
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
    }, DEFAULT_DEBOUNCE_MS);
    
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

