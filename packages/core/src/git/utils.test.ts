import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  isGitRepo,
  getCurrentBranch,
  getCurrentCommit,
  getChangedFiles,
  getChangedFilesInCommit,
  getChangedFilesBetweenCommits,
  isGitAvailable,
} from './utils.js';

const execAsync = promisify(exec);

describe('Git Utils', () => {
  let testDir: string;
  let isGitInstalled = false;

  beforeEach(async () => {
    // Check if git is available
    try {
      await execAsync('git --version');
      isGitInstalled = true;
    } catch {
      isGitInstalled = false;
    }

    // Create test directory in system temp
    testDir = path.join(os.tmpdir(), 'lien-test-git-' + Date.now());
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('isGitAvailable', () => {
    it('should detect if git is available', async () => {
      const available = await isGitAvailable();
      expect(typeof available).toBe('boolean');
      expect(available).toBe(isGitInstalled);
    });
  });

  describe('isGitRepo', () => {
    it('should return false for non-git directory', async () => {
      const result = await isGitRepo(testDir);
      expect(result).toBe(false);
    });

    it('should return true for git repository', async () => {
      if (!isGitInstalled) {
        console.log('Skipping test - git not installed');
        return;
      }

      // Initialize git repo
      await execAsync('git init', { cwd: testDir });

      const result = await isGitRepo(testDir);
      expect(result).toBe(true);
    });

    it('should handle non-existent directory gracefully', async () => {
      const nonExistent = path.join(testDir, 'does-not-exist');
      const result = await isGitRepo(nonExistent);
      expect(result).toBe(false);
    });
  });

  describe('getCurrentBranch', () => {
    it('should get current branch name', async () => {
      if (!isGitInstalled) {
        console.log('Skipping test - git not installed');
        return;
      }

      // Initialize git repo with initial commit
      await execAsync('git init', { cwd: testDir });
      await execAsync('git config user.email "test@example.com"', { cwd: testDir });
      await execAsync('git config user.name "Test User"', { cwd: testDir });

      // Create initial commit
      const testFile = path.join(testDir, 'test.txt');
      await fs.writeFile(testFile, 'test');
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "Initial commit"', { cwd: testDir });

      const branch = await getCurrentBranch(testDir);
      expect(branch).toBeTruthy();
      expect(typeof branch).toBe('string');
      // Default branch could be 'main' or 'master' depending on git config
      expect(['main', 'master']).toContain(branch);
    });

    it('should throw error for non-git directory', async () => {
      if (!isGitInstalled) {
        console.log('Skipping test - git not installed');
        return;
      }

      // The testDir might be inside the workspace git repo, so create a truly isolated temp dir
      const isolatedDir = path.join('/tmp', 'test-git-isolated-' + Date.now());
      await fs.mkdir(isolatedDir, { recursive: true });

      try {
        await expect(getCurrentBranch(isolatedDir)).rejects.toThrow();
      } finally {
        await fs.rm(isolatedDir, { recursive: true, force: true });
      }
    });
  });

  describe('getCurrentCommit', () => {
    it('should get current commit SHA', async () => {
      if (!isGitInstalled) {
        console.log('Skipping test - git not installed');
        return;
      }

      // Initialize git repo with initial commit
      await execAsync('git init', { cwd: testDir });
      await execAsync('git config user.email "test@example.com"', { cwd: testDir });
      await execAsync('git config user.name "Test User"', { cwd: testDir });

      // Create initial commit
      const testFile = path.join(testDir, 'test.txt');
      await fs.writeFile(testFile, 'test');
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "Initial commit"', { cwd: testDir });

      const commit = await getCurrentCommit(testDir);
      expect(commit).toBeTruthy();
      expect(typeof commit).toBe('string');
      expect(commit).toHaveLength(40); // Full SHA is 40 characters
      expect(commit).toMatch(/^[0-9a-f]{40}$/); // Hex string
    });

    it('should throw error for non-git directory', async () => {
      if (!isGitInstalled) {
        console.log('Skipping test - git not installed');
        return;
      }

      // Create an isolated temp dir outside the git repo
      const isolatedDir = path.join('/tmp', 'test-git-isolated-' + Date.now());
      await fs.mkdir(isolatedDir, { recursive: true });

      try {
        await expect(getCurrentCommit(isolatedDir)).rejects.toThrow();
      } finally {
        await fs.rm(isolatedDir, { recursive: true, force: true });
      }
    });
  });

  describe('getChangedFilesBetweenCommits', () => {
    it('should get changed files between two commits', async () => {
      if (!isGitInstalled) {
        console.log('Skipping test - git not installed');
        return;
      }

      // Initialize git repo
      await execAsync('git init', { cwd: testDir });
      await execAsync('git config user.email "test@example.com"', { cwd: testDir });
      await execAsync('git config user.name "Test User"', { cwd: testDir });

      // First commit
      const file1 = path.join(testDir, 'file1.txt');
      await fs.writeFile(file1, 'content1');
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "First commit"', { cwd: testDir });
      const commit1 = await getCurrentCommit(testDir);

      // Second commit with new file
      const file2 = path.join(testDir, 'file2.txt');
      await fs.writeFile(file2, 'content2');
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "Second commit"', { cwd: testDir });
      const commit2 = await getCurrentCommit(testDir);

      // Get changed files
      const changedFiles = await getChangedFilesBetweenCommits(testDir, commit1, commit2);

      expect(changedFiles).toBeTruthy();
      expect(Array.isArray(changedFiles)).toBe(true);
      expect(changedFiles.length).toBeGreaterThan(0);
      expect(changedFiles.some(f => f.endsWith('file2.txt'))).toBe(true);
    });

    it('should return empty array for identical commits', async () => {
      if (!isGitInstalled) {
        console.log('Skipping test - git not installed');
        return;
      }

      // Initialize git repo with commit
      await execAsync('git init', { cwd: testDir });
      await execAsync('git config user.email "test@example.com"', { cwd: testDir });
      await execAsync('git config user.name "Test User"', { cwd: testDir });

      const file1 = path.join(testDir, 'file1.txt');
      await fs.writeFile(file1, 'content1');
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "First commit"', { cwd: testDir });
      const commit = await getCurrentCommit(testDir);

      const changedFiles = await getChangedFilesBetweenCommits(testDir, commit, commit);
      expect(changedFiles).toEqual([]);
    });
  });

  describe('getChangedFilesInCommit', () => {
    it('should get files changed in a specific commit', async () => {
      if (!isGitInstalled) {
        console.log('Skipping test - git not installed');
        return;
      }

      // Initialize git repo
      await execAsync('git init', { cwd: testDir });
      await execAsync('git config user.email "test@example.com"', { cwd: testDir });
      await execAsync('git config user.name "Test User"', { cwd: testDir });

      // Need an initial commit first
      const initialFile = path.join(testDir, 'initial.txt');
      await fs.writeFile(initialFile, 'initial');
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "Initial commit"', { cwd: testDir });

      // Now create second commit with multiple files
      const file1 = path.join(testDir, 'file1.txt');
      const file2 = path.join(testDir, 'file2.txt');
      await fs.writeFile(file1, 'content1');
      await fs.writeFile(file2, 'content2');
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "Add files"', { cwd: testDir });
      const commit = await getCurrentCommit(testDir);

      const changedFiles = await getChangedFilesInCommit(testDir, commit);

      expect(changedFiles).toBeTruthy();
      expect(Array.isArray(changedFiles)).toBe(true);
      expect(changedFiles.length).toBeGreaterThanOrEqual(2);
      expect(changedFiles.some(f => f.endsWith('file1.txt'))).toBe(true);
      expect(changedFiles.some(f => f.endsWith('file2.txt'))).toBe(true);
    });
  });

  describe('git ref validation', () => {
    it('should reject refs starting with "-" in getChangedFiles', async () => {
      await expect(getChangedFiles(testDir, '--evil', 'main')).rejects.toThrow(
        'must not start with "-"',
      );
      await expect(getChangedFiles(testDir, 'main', '-evil')).rejects.toThrow(
        'must not start with "-"',
      );
    });

    it('should reject refs starting with "-" in getChangedFilesInCommit', async () => {
      await expect(getChangedFilesInCommit(testDir, '--exec=evil')).rejects.toThrow(
        'must not start with "-"',
      );
    });

    it('should reject refs starting with "-" in getChangedFilesBetweenCommits', async () => {
      await expect(getChangedFilesBetweenCommits(testDir, '--flag', 'abc123')).rejects.toThrow(
        'must not start with "-"',
      );
      await expect(getChangedFilesBetweenCommits(testDir, 'abc123', '-flag')).rejects.toThrow(
        'must not start with "-"',
      );
    });
  });

  describe('getChangedFiles', () => {
    it('should get changed files between branches', async () => {
      if (!isGitInstalled) {
        console.log('Skipping test - git not installed');
        return;
      }

      // Initialize git repo
      await execAsync('git init', { cwd: testDir });
      await execAsync('git config user.email "test@example.com"', { cwd: testDir });
      await execAsync('git config user.name "Test User"', { cwd: testDir });

      // Initial commit on main
      const file1 = path.join(testDir, 'file1.txt');
      await fs.writeFile(file1, 'content1');
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "Initial commit"', { cwd: testDir });

      // Get main branch name
      const mainBranch = await getCurrentBranch(testDir);

      // Create feature branch and add file
      await execAsync('git checkout -b feature', { cwd: testDir });
      const file2 = path.join(testDir, 'file2.txt');
      await fs.writeFile(file2, 'feature content');
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "Add feature file"', { cwd: testDir });

      // Get changed files between branches
      const changedFiles = await getChangedFiles(testDir, mainBranch, 'feature');

      expect(changedFiles).toBeTruthy();
      expect(Array.isArray(changedFiles)).toBe(true);
      expect(changedFiles.some(f => f.endsWith('file2.txt'))).toBe(true);
    });

    it('lists branch-exclusive files in both diff directions (tip-to-tip)', async () => {
      // Regression for #556 round 2: getChangedFiles must use direct tip-to-tip
      // (two-dot) semantics, not three-dot. Three-dot would silently omit files
      // that exist only on the FROM branch when diffing FROM...TO.
      if (!isGitInstalled) {
        console.log('Skipping test - git not installed');
        return;
      }

      await execAsync('git init', { cwd: testDir });
      await execAsync('git config user.email "test@example.com"', { cwd: testDir });
      await execAsync('git config user.name "Test User"', { cwd: testDir });

      // main has nothing yet — empty initial commit so a branch can exist.
      await execAsync('git commit --allow-empty -m "init"', { cwd: testDir });
      const mainBranch = await getCurrentBranch(testDir);

      // feature adds foo.txt.
      await execAsync('git checkout -b feature', { cwd: testDir });
      await fs.writeFile(path.join(testDir, 'foo.txt'), 'hello');
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "add foo.txt"', { cwd: testDir });

      // feature -> main: foo.txt exists on feature but not main. Direct tip-to-tip
      // diff lists foo.txt as a deletion. Three-dot diff would return empty
      // because main added nothing relative to merge base.
      const featureToMain = await getChangedFiles(testDir, 'feature', mainBranch);
      expect(featureToMain.some(f => f.endsWith('foo.txt'))).toBe(true);

      // main -> feature: foo.txt also shows up (added on feature).
      const mainToFeature = await getChangedFiles(testDir, mainBranch, 'feature');
      expect(mainToFeature.some(f => f.endsWith('foo.txt'))).toBe(true);
    });
  });
});
