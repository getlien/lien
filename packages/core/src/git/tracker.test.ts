import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { GitStateTracker } from './tracker.js';

const execAsync = promisify(exec);

describe('GitStateTracker', () => {
  let testDir: string;
  let indexPath: string;
  let isGitInstalled = false;

  beforeEach(async () => {
    // Check if git is available
    try {
      await execAsync('git --version');
      isGitInstalled = true;
    } catch {
      isGitInstalled = false;
    }

    // Create test directories in system temp
    testDir = path.join(os.tmpdir(), 'lien-test-git-tracker-' + Date.now());
    indexPath = path.join(testDir, '.lien');
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(indexPath, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('initialize', () => {
    it('should return null for non-git repository', async () => {
      const tracker = new GitStateTracker(testDir, indexPath);
      const result = await tracker.initialize();

      expect(result).toBeNull();
      expect(tracker.getState()).toBeNull();
    });

    it('should return null on first run', async () => {
      if (!isGitInstalled) {
        console.log('Skipping test - git not installed');
        return;
      }

      // Initialize git repo
      await execAsync('git init', { cwd: testDir });
      await execAsync('git config user.email "test@example.com"', { cwd: testDir });
      await execAsync('git config user.name "Test User"', { cwd: testDir });

      // Create initial commit
      const testFile = path.join(testDir, 'test.txt');
      await fs.writeFile(testFile, 'test');
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "Initial commit"', { cwd: testDir });

      const tracker = new GitStateTracker(testDir, indexPath);
      const result = await tracker.initialize();

      expect(result).toBeNull(); // First run, no previous state
      expect(tracker.getState()).not.toBeNull();
      expect(tracker.getState()?.branch).toBeTruthy();
      expect(tracker.getState()?.commit).toBeTruthy();
    });

    it('should detect changes when commit changes', async () => {
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

      // First initialization
      const tracker1 = new GitStateTracker(testDir, indexPath);
      const result1 = await tracker1.initialize();
      expect(result1).toBeNull(); // No previous state

      // Second commit
      const file2 = path.join(testDir, 'file2.txt');
      await fs.writeFile(file2, 'content2');
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "Second commit"', { cwd: testDir });

      // Second initialization (simulating restart)
      const tracker2 = new GitStateTracker(testDir, indexPath);
      const result2 = await tracker2.initialize();

      expect(result2).not.toBeNull();
      expect(Array.isArray(result2)).toBe(true);
      expect(result2!.length).toBeGreaterThan(0);
      expect(result2!.some(f => f.endsWith('file2.txt'))).toBe(true);
    });

    it('should persist state across instances', async () => {
      if (!isGitInstalled) {
        console.log('Skipping test - git not installed');
        return;
      }

      // Initialize git repo
      await execAsync('git init', { cwd: testDir });
      await execAsync('git config user.email "test@example.com"', { cwd: testDir });
      await execAsync('git config user.name "Test User"', { cwd: testDir });

      // Create commit
      const testFile = path.join(testDir, 'test.txt');
      await fs.writeFile(testFile, 'test');
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "Initial commit"', { cwd: testDir });

      // First tracker
      const tracker1 = new GitStateTracker(testDir, indexPath);
      await tracker1.initialize();
      const state1 = tracker1.getState();

      // Second tracker (new instance)
      const tracker2 = new GitStateTracker(testDir, indexPath);
      await tracker2.initialize();
      const state2 = tracker2.getState();

      // Compare without timestamp (timestamps will differ slightly)
      expect(state2?.branch).toBe(state1?.branch);
      expect(state2?.commit).toBe(state1?.commit);
    });
  });

  describe('detectChanges', () => {
    it('should return null when no changes', async () => {
      if (!isGitInstalled) {
        console.log('Skipping test - git not installed');
        return;
      }

      // Initialize git repo
      await execAsync('git init', { cwd: testDir });
      await execAsync('git config user.email "test@example.com"', { cwd: testDir });
      await execAsync('git config user.name "Test User"', { cwd: testDir });

      // Create commit
      const testFile = path.join(testDir, 'test.txt');
      await fs.writeFile(testFile, 'test');
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "Initial commit"', { cwd: testDir });

      const tracker = new GitStateTracker(testDir, indexPath);
      await tracker.initialize();

      const result = await tracker.detectChanges();
      expect(result).toBeNull();
    });

    it('should detect new commits', async () => {
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

      const tracker = new GitStateTracker(testDir, indexPath);
      await tracker.initialize();

      // Second commit
      const file2 = path.join(testDir, 'file2.txt');
      await fs.writeFile(file2, 'content2');
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "Second commit"', { cwd: testDir });

      const changedFiles = await tracker.detectChanges();

      expect(changedFiles).not.toBeNull();
      expect(Array.isArray(changedFiles)).toBe(true);
      expect(changedFiles!.length).toBeGreaterThan(0);
      expect(changedFiles!.some(f => f.endsWith('file2.txt'))).toBe(true);
    });

    it('should return null for non-git repo', async () => {
      const tracker = new GitStateTracker(testDir, indexPath);
      const result = await tracker.detectChanges();

      expect(result).toBeNull();
    });
  });

  describe('updateState', () => {
    it('should update and persist state', async () => {
      if (!isGitInstalled) {
        console.log('Skipping test - git not installed');
        return;
      }

      // Initialize git repo
      await execAsync('git init', { cwd: testDir });
      await execAsync('git config user.email "test@example.com"', { cwd: testDir });
      await execAsync('git config user.name "Test User"', { cwd: testDir });

      // Create commit
      const testFile = path.join(testDir, 'test.txt');
      await fs.writeFile(testFile, 'test');
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "Initial commit"', { cwd: testDir });

      const tracker = new GitStateTracker(testDir, indexPath);
      await tracker.updateState();

      const state = tracker.getState();
      expect(state).not.toBeNull();
      expect(state?.branch).toBeTruthy();
      expect(state?.commit).toBeTruthy();

      // Verify persistence - compare fields without timestamp
      const tracker2 = new GitStateTracker(testDir, indexPath);
      await tracker2.initialize();
      expect(tracker2.getState()?.branch).toBe(state?.branch);
      expect(tracker2.getState()?.commit).toBe(state?.commit);
    });
  });

  describe('getState', () => {
    it('should return null before initialization', () => {
      const tracker = new GitStateTracker(testDir, indexPath);
      expect(tracker.getState()).toBeNull();
    });

    it('should return current state after initialization', async () => {
      if (!isGitInstalled) {
        console.log('Skipping test - git not installed');
        return;
      }

      // Initialize git repo
      await execAsync('git init', { cwd: testDir });
      await execAsync('git config user.email "test@example.com"', { cwd: testDir });
      await execAsync('git config user.name "Test User"', { cwd: testDir });

      // Create commit
      const testFile = path.join(testDir, 'test.txt');
      await fs.writeFile(testFile, 'test');
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "Initial commit"', { cwd: testDir });

      const tracker = new GitStateTracker(testDir, indexPath);
      await tracker.initialize();

      const state = tracker.getState();
      expect(state).not.toBeNull();
      expect(state).toHaveProperty('branch');
      expect(state).toHaveProperty('commit');
      expect(state).toHaveProperty('timestamp');
    });
  });
});
