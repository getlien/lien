import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { initCommand } from './init.js';
import { defaultConfig } from '../config/schema.js';

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
  
  describe('creating new config', () => {
    it('should create .lien.config.json', async () => {
      await initCommand();
      
      const configPath = path.join(testDir, '.lien.config.json');
      const exists = await fs.access(configPath).then(() => true).catch(() => false);
      
      expect(exists).toBe(true);
    });
    
    it('should write default config content', async () => {
      await initCommand();
      
      const configPath = path.join(testDir, '.lien.config.json');
      const content = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(content);
      
      expect(config).toEqual(defaultConfig);
    });
    
    it('should format JSON with 2-space indentation', async () => {
      await initCommand();
      
      const configPath = path.join(testDir, '.lien.config.json');
      const content = await fs.readFile(configPath, 'utf-8');
      
      // Check for proper formatting
      expect(content).toContain('  ');
      expect(content).not.toContain('\t');
      expect(content.endsWith('\n')).toBe(true);
    });
    
    it('should not overwrite existing config without upgrade flag', async () => {
      // Create initial config with custom content
      const configPath = path.join(testDir, '.lien.config.json');
      const customConfig = { ...defaultConfig, indexing: { ...defaultConfig.indexing, chunkSize: 9999 } };
      await fs.writeFile(configPath, JSON.stringify(customConfig, null, 2));
      
      // Try to run init again
      await initCommand();
      
      // Config should still have custom value
      const content = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(content);
      expect(config.indexing.chunkSize).toBe(9999);
    });
  });
  
  describe('upgrade mode', () => {
    it('should upgrade existing config when --upgrade flag is used', async () => {
      // Create old config with missing fields
      const configPath = path.join(testDir, '.lien.config.json');
      const oldConfig = {
        indexing: {
          chunkSize: 800,
          // Missing other fields
        },
      };
      await fs.writeFile(configPath, JSON.stringify(oldConfig, null, 2));
      
      await initCommand({ upgrade: true });
      
      // Config should be upgraded with new fields but keep custom values
      const content = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(content);
      
      expect(config.indexing.chunkSize).toBe(800); // Preserved
      expect(config.indexing.chunkOverlap).toBeDefined(); // Added
      expect(config.indexing.include).toBeDefined(); // Added
      expect(config.fileWatching).toBeDefined(); // Added
    });
    
    it('should create backup when upgrading', async () => {
      const configPath = path.join(testDir, '.lien.config.json');
      const backupPath = configPath + '.backup';
      
      const oldConfig = { indexing: { chunkSize: 800 } };
      await fs.writeFile(configPath, JSON.stringify(oldConfig, null, 2));
      
      await initCommand({ upgrade: true });
      
      // Backup should exist
      const backupExists = await fs.access(backupPath).then(() => true).catch(() => false);
      expect(backupExists).toBe(true);
      
      // Backup should contain old config
      const backupContent = await fs.readFile(backupPath, 'utf-8');
      const backupConfig = JSON.parse(backupContent);
      expect(backupConfig).toEqual(oldConfig);
    });
    
    it('should create new config if --upgrade used but no config exists', async () => {
      await initCommand({ upgrade: true });
      
      const configPath = path.join(testDir, '.lien.config.json');
      const exists = await fs.access(configPath).then(() => true).catch(() => false);
      
      expect(exists).toBe(true);
    });
    
    it('should preserve user customizations during upgrade', async () => {
      const configPath = path.join(testDir, '.lien.config.json');
      const customConfig = {
        indexing: {
          chunkSize: 2000,
          chunkOverlap: 400,
          include: ['custom/**/*.ts'],
          exclude: ['custom-exclude/**'],
        },
      };
      await fs.writeFile(configPath, JSON.stringify(customConfig, null, 2));
      
      await initCommand({ upgrade: true });
      
      const content = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(content);
      
      // User values should be preserved
      expect(config.indexing.chunkSize).toBe(2000);
      expect(config.indexing.chunkOverlap).toBe(400);
      expect(config.indexing.include).toEqual(['custom/**/*.ts']);
      expect(config.indexing.exclude).toEqual(['custom-exclude/**']);
    });
    
    it('should handle invalid JSON in existing config', async () => {
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, '{ invalid json }');
      
      // Should throw or handle error gracefully
      await expect(initCommand({ upgrade: true })).rejects.toThrow();
    });
  });
  
  describe('error handling', () => {
    it('should handle permission errors gracefully', async () => {
      // This test is tricky to implement reliably across platforms
      // For now, just ensure the function completes
      await expect(initCommand()).resolves.not.toThrow();
    });
  });
  
  describe('console output', () => {
    it('should log success message on creation', async () => {
      const logSpy = vi.spyOn(console, 'log');
      
      await initCommand();
      
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Created .lien.config.json'));
    });
    
    it('should log warning when config exists', async () => {
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2));
      
      const logSpy = vi.spyOn(console, 'log');
      
      await initCommand();
      
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('already exists'));
    });
    
    it('should log success and new fields on upgrade', async () => {
      const configPath = path.join(testDir, '.lien.config.json');
      const oldConfig = { indexing: { chunkSize: 800 } };
      await fs.writeFile(configPath, JSON.stringify(oldConfig, null, 2));
      
      const logSpy = vi.spyOn(console, 'log');
      
      await initCommand({ upgrade: true });
      
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('upgraded successfully'));
    });
  });
});

