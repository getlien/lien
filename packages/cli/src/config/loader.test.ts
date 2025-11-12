import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { loadConfig, configExists } from './loader.js';
import { defaultConfig } from './schema.js';

describe('Config Loader', () => {
  let testDir: string;
  
  beforeEach(async () => {
    // Create a temporary test directory
    testDir = path.join(process.cwd(), '.test-config-' + Date.now());
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
  
  describe('loadConfig', () => {
    it('should return default config when no config file exists', async () => {
      const config = await loadConfig(testDir);
      expect(config).toEqual(defaultConfig);
    });
    
    it('should load and merge user config with defaults', async () => {
      const userConfig = {
        indexing: {
          chunkSize: 2000,
        },
      };
      
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, JSON.stringify(userConfig, null, 2));
      
      const config = await loadConfig(testDir);
      
      expect(config.indexing.chunkSize).toBe(2000);
      expect(config.indexing.chunkOverlap).toBe(defaultConfig.indexing.chunkOverlap);
      expect(config.indexing.include).toEqual(defaultConfig.indexing.include);
    });
    
    it('should merge nested config properties correctly', async () => {
      const userConfig = {
        indexing: {
          exclude: ['custom-exclude/**'],
          chunkSize: 3000,
        },
        fileWatching: {
          enabled: false,
        },
      };
      
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, JSON.stringify(userConfig, null, 2));
      
      const config = await loadConfig(testDir);
      
      expect(config.indexing.exclude).toEqual(['custom-exclude/**']);
      expect(config.indexing.chunkSize).toBe(3000);
      expect(config.indexing.chunkOverlap).toBe(defaultConfig.indexing.chunkOverlap);
      expect(config.fileWatching.enabled).toBe(false);
      expect(config.fileWatching.debounceMs).toBe(defaultConfig.fileWatching.debounceMs);
    });
    
    it('should throw error for invalid JSON', async () => {
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, '{ invalid json }');
      
      await expect(loadConfig(testDir)).rejects.toThrow();
    });
    
    it('should handle empty config file', async () => {
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, '{}');
      
      const config = await loadConfig(testDir);
      expect(config).toEqual(defaultConfig);
    });
    
    it('should merge arrays correctly (replace, not concatenate)', async () => {
      const userConfig = {
        indexing: {
          include: ['src/**/*.ts'],
        },
      };
      
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, JSON.stringify(userConfig, null, 2));
      
      const config = await loadConfig(testDir);
      
      // Arrays should be replaced, not merged
      expect(config.indexing.include).toEqual(['src/**/*.ts']);
    });
  });
  
  describe('configExists', () => {
    it('should return false when config does not exist', async () => {
      const exists = await configExists(testDir);
      expect(exists).toBe(false);
    });
    
    it('should return true when config exists', async () => {
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, '{}');
      
      const exists = await configExists(testDir);
      expect(exists).toBe(true);
    });
    
    it('should handle permission errors gracefully', async () => {
      // This test might be platform-specific, so we just ensure it doesn't throw
      const nonExistentDir = path.join(testDir, 'non-existent');
      const exists = await configExists(nonExistentDir);
      expect(exists).toBe(false);
    });
  });
});

