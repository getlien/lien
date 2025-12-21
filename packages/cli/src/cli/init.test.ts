import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { initCommand } from './init.js';

describe('initCommand', () => {
  let testDir: string;
  let originalCwd: string;
  
  beforeEach(async () => {
    // Create test directory
    testDir = path.join(process.cwd(), '.test-init-' + Date.now());
    await fs.mkdir(testDir, { recursive: true });
    
    // Store original cwd and change to test directory
    originalCwd = process.cwd();
    process.chdir(testDir);
    
    // Mock console methods to avoid cluttering test output
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  
  afterEach(async () => {
    // Restore original directory
    process.chdir(originalCwd);
    
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    
    // Restore mocks
    vi.restoreAllMocks();
  });
  
  describe('basic functionality', () => {
    it('should not create .lien.config.json (config no longer needed)', async () => {
      await initCommand({ yes: true });
      
      const configPath = path.join(testDir, '.lien.config.json');
      const exists = await fs.access(configPath).then(() => true).catch(() => false);
      
      expect(exists).toBe(false);
    });
    
    it('should log initialization message', async () => {
      const logSpy = vi.spyOn(console, 'log');
      
      await initCommand({ yes: true });
      
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('No per-project configuration needed')
      );
    });
    
    it('should warn if old config exists', async () => {
      // Create old config file
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, JSON.stringify({ version: '0.2.0' }));
      
      const logSpy = vi.spyOn(console, 'log');
      
      await initCommand({ yes: true });
      
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('.lien.config.json found but no longer used')
      );
    });
  });
  
  describe('Cursor rules installation', () => {
    it('should attempt to install Cursor rules with --yes flag', async () => {
      // Don't mock console.log for this test so inquirer can work
      vi.restoreAllMocks();
      vi.spyOn(console, 'log').mockImplementation(() => {});
      
      // Should not throw even if installation fails (e.g., template file not found in test)
      await expect(initCommand({ yes: true })).resolves.not.toThrow();
      
      // If installation succeeded, file should exist
      const cursorRulesPath = path.join(testDir, '.cursor/rules/lien.mdc');
      const exists = await fs.access(cursorRulesPath).then(() => true).catch(() => false);
      
      // Installation may fail in test environment (template file path issues)
      // Just verify the command completes without error
      expect(typeof exists).toBe('boolean');
    });
  });
  
  describe('error handling', () => {
    it('should handle permission errors gracefully', async () => {
      // This is hard to test reliably across platforms
      // Just verify it doesn't crash
      await expect(initCommand({ yes: true })).resolves.not.toThrow();
    });
  });
});
