import fs from 'fs/promises';
import path from 'path';
import {
  isGitRepo,
  getCurrentBranch,
  getCurrentCommit,
  getChangedFiles,
  getChangedFilesBetweenCommits,
} from './utils.js';

export interface GitState {
  branch: string;
  commit: string;
  timestamp: number;
}

/**
 * Tracks git state (branch and commit) and detects changes.
 * Persists state to disk to survive server restarts.
 */
export class GitStateTracker {
  private stateFile: string;
  private rootDir: string;
  private currentState: GitState | null = null;

  constructor(rootDir: string, indexPath: string) {
    this.rootDir = rootDir;
    this.stateFile = path.join(indexPath, '.git-state.json');
  }

  /**
   * Loads the last known git state from disk.
   * Returns null if no state file exists (first run).
   */
  private async loadState(): Promise<GitState | null> {
    try {
      const content = await fs.readFile(this.stateFile, 'utf-8');
      return JSON.parse(content);
    } catch {
      // File doesn't exist or is invalid - this is fine for first run
      return null;
    }
  }

  /**
   * Saves the current git state to disk.
   */
  private async saveState(state: GitState): Promise<void> {
    try {
      const content = JSON.stringify(state, null, 2);
      await fs.writeFile(this.stateFile, content, 'utf-8');
    } catch (error) {
      // Log but don't throw - state persistence is best-effort
      console.error(`[Lien] Warning: Failed to save git state: ${error}`);
    }
  }

  /**
   * Gets the current git state from the repository.
   *
   * @returns Current git state
   * @throws Error if git commands fail
   */
  private async getCurrentGitState(): Promise<GitState> {
    const branch = await getCurrentBranch(this.rootDir);
    const commit = await getCurrentCommit(this.rootDir);

    return {
      branch,
      commit,
      timestamp: Date.now(),
    };
  }

  /**
   * Initializes the tracker by loading saved state and checking current state.
   * Should be called once when MCP server starts.
   *
   * @returns Array of changed files if state changed, null if no changes or first run
   */
  async initialize(): Promise<string[] | null> {
    // Check if this is a git repo
    const isRepo = await isGitRepo(this.rootDir);
    if (!isRepo) {
      return null;
    }

    try {
      // Get current state
      this.currentState = await this.getCurrentGitState();

      // Load previous state
      const previousState = await this.loadState();

      if (!previousState) {
        // First run - save current state
        await this.saveState(this.currentState);
        return null;
      }

      // Check if state changed
      const branchChanged = previousState.branch !== this.currentState.branch;
      const commitChanged = previousState.commit !== this.currentState.commit;

      if (!branchChanged && !commitChanged) {
        // No changes
        return null;
      }

      // State changed - get list of changed files
      let changedFiles: string[] = [];

      if (branchChanged) {
        // Branch changed - compare current branch with previous branch
        try {
          changedFiles = await getChangedFiles(
            this.rootDir,
            previousState.branch,
            this.currentState.branch,
          );
        } catch (error) {
          // If branches diverged too much or don't exist, fall back to commit diff
          console.error(`[Lien] Branch diff failed, using commit diff: ${error}`);
          changedFiles = await getChangedFilesBetweenCommits(
            this.rootDir,
            previousState.commit,
            this.currentState.commit,
          );
        }
      } else if (commitChanged) {
        // Same branch, different commit
        changedFiles = await getChangedFilesBetweenCommits(
          this.rootDir,
          previousState.commit,
          this.currentState.commit,
        );
      }

      // Save new state
      await this.saveState(this.currentState);

      return changedFiles;
    } catch (error) {
      console.error(`[Lien] Failed to initialize git tracker: ${error}`);
      return null;
    }
  }

  /**
   * Checks for git state changes since last check.
   * This is called periodically by the MCP server.
   *
   * @returns Array of changed files if state changed, null if no changes
   */
  async detectChanges(): Promise<string[] | null> {
    // Check if this is a git repo
    const isRepo = await isGitRepo(this.rootDir);
    if (!isRepo) {
      return null;
    }

    try {
      // Get current state
      const newState = await this.getCurrentGitState();

      // If we don't have a previous state, just save current and return
      if (!this.currentState) {
        this.currentState = newState;
        await this.saveState(newState);
        return null;
      }

      // Check if state changed
      const branchChanged = this.currentState.branch !== newState.branch;
      const commitChanged = this.currentState.commit !== newState.commit;

      if (!branchChanged && !commitChanged) {
        // No changes
        return null;
      }

      // State changed - get list of changed files
      let changedFiles: string[] = [];

      if (branchChanged) {
        // Branch changed
        try {
          changedFiles = await getChangedFiles(
            this.rootDir,
            this.currentState.branch,
            newState.branch,
          );
        } catch (error) {
          // Fall back to commit diff
          console.error(`[Lien] Branch diff failed, using commit diff: ${error}`);
          changedFiles = await getChangedFilesBetweenCommits(
            this.rootDir,
            this.currentState.commit,
            newState.commit,
          );
        }
      } else if (commitChanged) {
        // Same branch, different commit
        changedFiles = await getChangedFilesBetweenCommits(
          this.rootDir,
          this.currentState.commit,
          newState.commit,
        );
      }

      // Update current state
      this.currentState = newState;
      await this.saveState(newState);

      return changedFiles;
    } catch (error) {
      console.error(`[Lien] Failed to detect git changes: ${error}`);
      return null;
    }
  }

  /**
   * Gets the current git state.
   * Useful for status display.
   */
  getState(): GitState | null {
    return this.currentState;
  }

  /**
   * Manually updates the saved state.
   * Useful after manual reindexing to sync state.
   */
  async updateState(): Promise<void> {
    try {
      this.currentState = await this.getCurrentGitState();
      await this.saveState(this.currentState);
    } catch (error) {
      console.error(`[Lien] Failed to update git state: ${error}`);
    }
  }
}
