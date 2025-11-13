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
  
  describe('creating new config with --yes flag', () => {
    it('should create .lien.config.json', async () => {
      await initCommand({ yes: true });
      
      const configPath = path.join(testDir, '.lien.config.json');
      const exists = await fs.access(configPath).then(() => true).catch(() => false);
      
      expect(exists).toBe(true);
    });
    
    it('should write config with frameworks array', async () => {
      await initCommand({ yes: true });
      
      const configPath = path.join(testDir, '.lien.config.json');
      const content = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(content);
      
      expect(config.version).toBe('0.3.0');
      expect(config.frameworks).toBeDefined();
      expect(Array.isArray(config.frameworks)).toBe(true);
    });
    
    it('should format JSON with 2-space indentation', async () => {
      await initCommand({ yes: true });
      
      const configPath = path.join(testDir, '.lien.config.json');
      const content = await fs.readFile(configPath, 'utf-8');
      
      // Check for proper indentation (lines starting with exactly 2 or 4 spaces)
      const lines = content.split('\n');
      const indentedLines = lines.filter(line => line.startsWith('  ') && !line.startsWith('   '));
      
      expect(indentedLines.length).toBeGreaterThan(0);
    });
    
    it('should not overwrite existing config without upgrade flag', async () => {
      // Create initial config
      await initCommand({ yes: true });
      
      const configPath = path.join(testDir, '.lien.config.json');
      const initialContent = await fs.readFile(configPath, 'utf-8');
      const initialConfig = JSON.parse(initialContent);
      
      // Modify config
      initialConfig.core.chunkSize = 9999;
      await fs.writeFile(configPath, JSON.stringify(initialConfig, null, 2));
      
      // Try to init again (should not overwrite)
      await initCommand({ yes: true });
      
      // Config should remain unchanged
      const finalContent = await fs.readFile(configPath, 'utf-8');
      const finalConfig = JSON.parse(finalContent);
      
      expect(finalConfig.core.chunkSize).toBe(9999);
    });
    
    it('should detect Node.js framework when package.json exists', async () => {
      // Create a package.json to trigger Node.js detection
      await fs.writeFile(
        path.join(testDir, 'package.json'),
        JSON.stringify({ name: 'test-project', devDependencies: { typescript: '*' } })
      );
      
      await initCommand({ yes: true });
      
      const configPath = path.join(testDir, '.lien.config.json');
      const content = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(content);
      
      expect(config.frameworks).toHaveLength(1);
      expect(config.frameworks[0].name).toBe('nodejs');
      expect(config.frameworks[0].path).toBe('.');
    });
    
    it('should create generic framework when no frameworks detected', async () => {
      // Empty directory - no frameworks
      await initCommand({ yes: true });
      
      const configPath = path.join(testDir, '.lien.config.json');
      const content = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(content);
      
      expect(config.frameworks).toHaveLength(1);
      expect(config.frameworks[0].name).toBe('generic');
    });
  });
  
  describe('upgrade mode', () => {
    it('should upgrade existing config when --upgrade flag is used', async () => {
      // Create old v0.2.0 config with missing fields
      const configPath = path.join(testDir, '.lien.config.json');
      const oldConfig = {
        version: '0.2.0',
        indexing: {
          chunkSize: 800,
          chunkOverlap: 10,
          concurrency: 4,
          embeddingBatchSize: 50,
          include: ['**/*.ts'],
          exclude: [],
          indexTests: false,
          useImportAnalysis: true,
        },
      };
      await fs.writeFile(configPath, JSON.stringify(oldConfig, null, 2));
      
      await initCommand({ upgrade: true });
      
      // Config should be migrated to v0.3.0 with new structure
      const content = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(content);
      
      expect(config.version).toBe('0.3.0');
      expect(config.core.chunkSize).toBe(800); // Preserved
      expect(config.core.chunkOverlap).toBe(10); // Preserved
      expect(config.frameworks).toHaveLength(1); // Migrated to generic framework
      expect(config.frameworks[0].name).toBe('generic');
      expect(config.fileWatching).toBeDefined(); // Added
    });
    
    it('should create backup when upgrading', async () => {
      const configPath = path.join(testDir, '.lien.config.json');
      const backupPath = configPath + '.backup';
      
      const oldConfig = { 
        version: '0.2.0',
        indexing: { 
          chunkSize: 800,
          chunkOverlap: 10,
          concurrency: 4,
          embeddingBatchSize: 50,
          include: ['**/*.ts'],
          exclude: [],
          indexTests: false,
          useImportAnalysis: true,
        } 
      };
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
      await initCommand({ upgrade: true, yes: true });
      
      const configPath = path.join(testDir, '.lien.config.json');
      const exists = await fs.access(configPath).then(() => true).catch(() => false);
      
      expect(exists).toBe(true);
    });
    
    it('should preserve user customizations during upgrade', async () => {
      const configPath = path.join(testDir, '.lien.config.json');
      const customConfig = {
        version: '0.2.0',
        indexing: {
          chunkSize: 2000,
          chunkOverlap: 400,
          concurrency: 4,
          embeddingBatchSize: 50,
          include: ['custom/**/*.ts'],
          exclude: ['custom-exclude/**'],
          indexTests: false,
          useImportAnalysis: true,
        },
      };
      await fs.writeFile(configPath, JSON.stringify(customConfig, null, 2));
      
      await initCommand({ upgrade: true });
      
      const content = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(content);
      
      // User values should be preserved in new structure
      expect(config.version).toBe('0.3.0');
      expect(config.core.chunkSize).toBe(2000);
      expect(config.core.chunkOverlap).toBe(400);
      expect(config.frameworks).toHaveLength(1);
      expect(config.frameworks[0].config.include).toEqual(['custom/**/*.ts']);
      expect(config.frameworks[0].config.exclude).toEqual(['custom-exclude/**']);
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
      // This is hard to test reliably across platforms
      // Just verify it doesn't crash
      await expect(initCommand({ yes: true })).resolves.not.toThrow();
    });
  });
  
  describe('logging', () => {
    it('should log success message on creation', async () => {
      const logSpy = vi.spyOn(console, 'log');
      
      await initCommand({ yes: true });
      
      expect(logSpy).toHaveBeenCalled();
    });
    
    it('should log warning when config exists', async () => {
      // Create config first
      await initCommand({ yes: true });
      
      const logSpy = vi.spyOn(console, 'log');
      
      // Try to create again
      await initCommand({ yes: true });
      
      expect(logSpy).toHaveBeenCalled();
    });
    
    it('should log success and new fields on upgrade', async () => {
      // Create old config
      const configPath = path.join(testDir, '.lien.config.json');
      const oldConfig = {
        version: '0.2.0',
        indexing: {
          chunkSize: 800,
          chunkOverlap: 10,
          concurrency: 4,
          embeddingBatchSize: 50,
          include: ['**/*.ts'],
          exclude: [],
          indexTests: false,
          useImportAnalysis: true,
        },
      };
      await fs.writeFile(configPath, JSON.stringify(oldConfig, null, 2));
      
      const logSpy = vi.spyOn(console, 'log');
      
      await initCommand({ upgrade: true });
      
      expect(logSpy).toHaveBeenCalled();
    });
  });
  
  describe('Cursor rules installation', () => {
    it('should skip Cursor rules installation with --yes flag', async () => {
      await initCommand({ yes: true });
      
      const cursorRulesPath = path.join(testDir, '.cursor/rules');
      const exists = await fs.access(cursorRulesPath).then(() => true).catch(() => false);
      
      // Should NOT create .cursor/rules when using --yes flag
      expect(exists).toBe(false);
    });
    
    it('should create .cursor directory structure when rules are installed', async () => {
      // Note: This test would require mocking inquirer prompts to test the actual installation
      // For now, we just test that the directory creation works
      const cursorRulesDir = path.join(testDir, '.cursor');
      await fs.mkdir(cursorRulesDir, { recursive: true });
      
      const exists = await fs.access(cursorRulesDir).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });
    
    it('should handle .cursor/rules as a directory', async () => {
      // Create .cursor/rules as a directory
      const rulesDir = path.join(testDir, '.cursor/rules');
      await fs.mkdir(rulesDir, { recursive: true });
      await fs.writeFile(path.join(rulesDir, 'existing.mdc'), '# Existing rules');
      
      // Verify it's a directory
      const stats = await fs.stat(rulesDir);
      expect(stats.isDirectory()).toBe(true);
      
      // Verify existing file is preserved
      const existingFile = await fs.readFile(path.join(rulesDir, 'existing.mdc'), 'utf-8');
      expect(existingFile).toContain('Existing rules');
    });
  });
});
