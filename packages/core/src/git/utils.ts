import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

/**
 * Checks if a directory is a git repository.
 *
 * @param rootDir - Directory to check
 * @returns true if directory is a git repo, false otherwise
 */
export async function isGitRepo(rootDir: string): Promise<boolean> {
  try {
    const gitDir = path.join(rootDir, '.git');
    await fs.access(gitDir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gets the current git branch name.
 *
 * @param rootDir - Root directory of the git repository
 * @returns Branch name (e.g., "main", "feature-branch")
 * @throws Error if not a git repo or git command fails
 */
export async function getCurrentBranch(rootDir: string): Promise<string> {
  try {
    const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', {
      cwd: rootDir,
      timeout: 5000, // 5 second timeout
    });
    return stdout.trim();
  } catch (error) {
    throw new Error(`Failed to get current branch: ${error}`);
  }
}

/**
 * Gets the current git commit SHA (HEAD).
 *
 * @param rootDir - Root directory of the git repository
 * @returns Commit SHA (full 40-character hash)
 * @throws Error if not a git repo or git command fails
 */
export async function getCurrentCommit(rootDir: string): Promise<string> {
  try {
    const { stdout } = await execAsync('git rev-parse HEAD', {
      cwd: rootDir,
      timeout: 5000,
    });
    return stdout.trim();
  } catch (error) {
    throw new Error(`Failed to get current commit: ${error}`);
  }
}

/**
 * Gets the list of files that changed between two git references.
 *
 * @param rootDir - Root directory of the git repository
 * @param fromRef - Starting reference (branch name, commit SHA, or tag)
 * @param toRef - Ending reference (branch name, commit SHA, or tag)
 * @returns Array of file paths (relative to repo root) that changed
 * @throws Error if git command fails
 */
export async function getChangedFiles(
  rootDir: string,
  fromRef: string,
  toRef: string,
): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`git diff --name-only ${fromRef}...${toRef}`, {
      cwd: rootDir,
      timeout: 10000, // 10 second timeout for diffs
    });

    const files = stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(file => path.join(rootDir, file)); // Convert to absolute paths

    return files;
  } catch (error) {
    throw new Error(`Failed to get changed files: ${error}`);
  }
}

/**
 * Gets the list of files that changed in a specific commit.
 *
 * @param rootDir - Root directory of the git repository
 * @param commitSha - Commit SHA to check
 * @returns Array of file paths (absolute) that changed in this commit
 * @throws Error if git command fails
 */
export async function getChangedFilesInCommit(
  rootDir: string,
  commitSha: string,
): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`git diff-tree --no-commit-id --name-only -r ${commitSha}`, {
      cwd: rootDir,
      timeout: 10000,
    });

    const files = stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(file => path.join(rootDir, file)); // Convert to absolute paths

    return files;
  } catch (error) {
    throw new Error(`Failed to get changed files in commit: ${error}`);
  }
}

/**
 * Gets the list of files that changed between two commits.
 * More efficient than getChangedFiles for commit-to-commit comparisons.
 *
 * @param rootDir - Root directory of the git repository
 * @param fromCommit - Starting commit SHA
 * @param toCommit - Ending commit SHA
 * @returns Array of file paths (absolute) that changed between commits
 * @throws Error if git command fails
 */
export async function getChangedFilesBetweenCommits(
  rootDir: string,
  fromCommit: string,
  toCommit: string,
): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`git diff --name-only ${fromCommit} ${toCommit}`, {
      cwd: rootDir,
      timeout: 10000,
    });

    const files = stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(file => path.join(rootDir, file)); // Convert to absolute paths

    return files;
  } catch (error) {
    throw new Error(`Failed to get changed files between commits: ${error}`);
  }
}

/**
 * Checks if git is installed and available.
 *
 * @returns true if git is available, false otherwise
 */
export async function isGitAvailable(): Promise<boolean> {
  try {
    await execAsync('git --version', { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}
