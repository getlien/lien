import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { ConfigService } from './service.js';
import { LienConfig, LegacyLienConfig, defaultConfig } from './schema.js';
import { ConfigError } from '../errors/index.js';

// Get current version from package.json dynamically
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  await fs.readFile(path.join(__dirname, '../../package.json'), 'utf-8')
);
const CURRENT_VERSION = packageJson.version;

describe('ConfigService', () => {
  let service: ConfigService;
  let testDir: string;
  
  beforeEach(async () => {
    service = new ConfigService();
    // Create a temporary test directory
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-config-test-'));
  });
  
  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });
  
  describe('exists', () => {
    it('should return false when config does not exist', async () => {
      const exists = await service.exists(testDir);
      expect(exists).toBe(false);
    });
    
    it('should return true when config exists', async () => {
      // Create a config file
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2));
      
      const exists = await service.exists(testDir);
      expect(exists).toBe(true);
    });
  });
  
  describe('load', () => {
    it('should return default config when file does not exist', async () => {
      const config = await service.load(testDir);
      expect(config).toEqual(defaultConfig);
    });
    
    it('should load and merge user config with defaults', async () => {
      const userConfig: Partial<LienConfig> = {
        version: '0.3.0',
        core: {
          chunkSize: 100,
          chunkOverlap: 20,
          concurrency: 8,
          embeddingBatchSize: 75,
        },
        frameworks: [],
      };
      
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, JSON.stringify(userConfig, null, 2));
      
      const config = await service.load(testDir);
      
      expect(config.core.chunkSize).toBe(100);
      expect(config.core.chunkOverlap).toBe(20);
      expect(config.mcp).toEqual(defaultConfig.mcp); // Should merge with defaults
    });
    
    it('should throw ConfigError for invalid JSON', async () => {
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, '{ invalid json }');
      
      await expect(service.load(testDir)).rejects.toThrow(ConfigError);
      await expect(service.load(testDir)).rejects.toThrow('Invalid JSON syntax');
    });
    
    it('should automatically migrate v0.2.0 config', async () => {
      const legacyConfig: Partial<LegacyLienConfig> = {
        version: '0.2.0',
        indexing: {
          include: ['**/*.ts'],
          exclude: ['**/node_modules/**'],
          chunkSize: 100,
          chunkOverlap: 15,
          concurrency: 6,
          embeddingBatchSize: 60,
        },
        mcp: {
          port: 7133,
          transport: 'stdio',
          autoIndexOnFirstRun: true,
        },
        gitDetection: {
          enabled: true,
          pollIntervalMs: 5000,
        },
        fileWatching: {
          enabled: false,
          debounceMs: 1000,
        },
      };
      
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, JSON.stringify(legacyConfig, null, 2));
      
      const config = await service.load(testDir);
      
      // Migration removed - just merges with defaults
      // Old indexing field is ignored, uses defaults
      expect(config.core.chunkSize).toBe(defaultConfig.core.chunkSize);
    });
  });
  
  describe('save', () => {
    it('should save valid config to file', async () => {
      const config: LienConfig = {
        ...defaultConfig,
        core: {
          ...defaultConfig.core,
          chunkSize: 120,
        },
      };
      
      await service.save(testDir, config);
      
      const configPath = path.join(testDir, '.lien.config.json');
      const savedContent = await fs.readFile(configPath, 'utf-8');
      const savedConfig = JSON.parse(savedContent);
      
      expect(savedConfig.core.chunkSize).toBe(120);
    });
    
    it('should throw ConfigError when trying to save invalid config', async () => {
      const invalidConfig = {
        ...defaultConfig,
        core: {
          ...defaultConfig.core,
          chunkSize: -10, // Invalid: must be positive
        },
      };
      
      await expect(service.save(testDir, invalidConfig)).rejects.toThrow(ConfigError);
      await expect(service.save(testDir, invalidConfig)).rejects.toThrow('invalid configuration');
    });
    
    it('should format JSON with proper indentation', async () => {
      await service.save(testDir, defaultConfig);
      
      const configPath = path.join(testDir, '.lien.config.json');
      const content = await fs.readFile(configPath, 'utf-8');
      
      // Should be formatted with 2-space indentation
      // Version field removed - no longer in config
      expect(content).toContain('"core"');
      expect(content.endsWith('\n')).toBe(true);
    });
  });
  
  // Migration tests removed - migration no longer exists
  
  describe('validate', () => {
    it('should validate correct modern config', () => {
      const result = service.validate(defaultConfig);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
    
    it('should reject non-object config', () => {
      const result = service.validate('not an object');
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Configuration must be an object');
    });
    
    it('should reject config without version', () => {
      // Version field removed - no longer validated
      const invalidConfig = { ...defaultConfig };
      delete (invalidConfig as any).core;
      
      const result = service.validate(invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
    
    it('should reject invalid chunk size', () => {
      const invalidConfig: LienConfig = {
        ...defaultConfig,
        core: {
          ...defaultConfig.core,
          chunkSize: -5,
        },
      };
      
      const result = service.validate(invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('chunkSize'))).toBe(true);
    });
    
    it('should reject invalid concurrency', () => {
      const invalidConfig: LienConfig = {
        ...defaultConfig,
        core: {
          ...defaultConfig.core,
          concurrency: 20, // Too high (max 16)
        },
      };
      
      const result = service.validate(invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('concurrency'))).toBe(true);
    });
    
    it('should reject invalid MCP port', () => {
      const invalidConfig: LienConfig = {
        ...defaultConfig,
        mcp: {
          ...defaultConfig.mcp,
          port: 500, // Too low (min 1024)
        },
      };
      
      const result = service.validate(invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('port'))).toBe(true);
    });
    
    it('should reject invalid transport type', () => {
      const invalidConfig: LienConfig = {
        ...defaultConfig,
        mcp: {
          ...defaultConfig.mcp,
          transport: 'invalid' as any,
        },
      };
      
      const result = service.validate(invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('transport'))).toBe(true);
    });
    
    it('should warn about very small chunk size', () => {
      const config: LienConfig = {
        ...defaultConfig,
        core: {
          ...defaultConfig.core,
          chunkSize: 30, // Valid but small
        },
      };
      
      const result = service.validate(config);
      
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('very small'))).toBe(true);
    });
    
    it('should warn about very large chunk size', () => {
      const config: LienConfig = {
        ...defaultConfig,
        core: {
          ...defaultConfig.core,
          chunkSize: 600, // Valid but large
        },
      };
      
      const result = service.validate(config);
      
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('very large'))).toBe(true);
    });
    
    it('should warn about legacy config format', () => {
      const legacyConfig: LegacyLienConfig = {
        version: '0.2.0',
        indexing: {
          include: ['**/*.ts'],
          exclude: [],
          chunkSize: 75,
          chunkOverlap: 10,
          concurrency: 4,
          embeddingBatchSize: 50,
        },
        mcp: {
          port: 7133,
          transport: 'stdio',
          autoIndexOnFirstRun: true,
        },
        gitDetection: {
          enabled: true,
          pollIntervalMs: 5000,
        },
        fileWatching: {
          enabled: false,
          debounceMs: 1000,
        },
      };
      
      const result = service.validate(legacyConfig);
      
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('legacy'))).toBe(true);
    });
  });
  
  describe('validatePartial', () => {
    it('should validate partial config with only core settings', () => {
      const partialConfig: Partial<LienConfig> = {
        core: {
          chunkSize: 100,
          chunkOverlap: 15,
          concurrency: 6,
          embeddingBatchSize: 60,
        },
      };
      
      const result = service.validatePartial(partialConfig);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
    
    it('should reject invalid values in partial config', () => {
      const partialConfig: Partial<LienConfig> = {
        core: {
          chunkSize: -10, // Invalid
          chunkOverlap: 10,
          concurrency: 4,
          embeddingBatchSize: 50,
        },
      };
      
      const result = service.validatePartial(partialConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('chunkSize'))).toBe(true);
    });
    
    it('should allow missing fields in partial config', () => {
      const partialConfig: Partial<LienConfig> = {
        mcp: {
          port: 8000,
          transport: 'stdio',
          autoIndexOnFirstRun: false,
        },
      };
      
      const result = service.validatePartial(partialConfig);
      
      expect(result.valid).toBe(true);
    });
  });
  
  describe('integration', () => {
    it('should handle full lifecycle: save, load, validate', async () => {
      const customConfig: LienConfig = {
        ...defaultConfig,
        core: {
          ...defaultConfig.core,
          chunkSize: 100,
        },
        mcp: {
          ...defaultConfig.mcp,
          port: 8000,
        },
      };
      
      // Save
      await service.save(testDir, customConfig);
      
      // Load
      const loadedConfig = await service.load(testDir);
      
      // Validate
      const validation = service.validate(loadedConfig);
      
      expect(validation.valid).toBe(true);
      expect(loadedConfig.core.chunkSize).toBe(100);
      expect(loadedConfig.mcp.port).toBe(8000);
    });
    
    it('should handle migration workflow', async () => {
      // Create legacy config
      const legacyConfig: LegacyLienConfig = {
        version: '0.2.0',
        indexing: {
          include: ['**/*.ts', '**/*.js'],
          exclude: ['**/node_modules/**'],
          chunkSize: 90,
          chunkOverlap: 12,
          concurrency: 6,
          embeddingBatchSize: 55,
        },
        mcp: {
          port: 7200,
          transport: 'stdio',
          autoIndexOnFirstRun: false,
        },
        gitDetection: {
          enabled: false,
          pollIntervalMs: 3000,
        },
        fileWatching: {
          enabled: true,
          debounceMs: 500,
        },
      };
      
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, JSON.stringify(legacyConfig, null, 2));
      
      // Load config - migration removed, just merges with defaults
      const config = await service.load(testDir);

      // Migration removed - old indexing field ignored, uses defaults for core settings
      expect(config.core.chunkSize).toBe(defaultConfig.core.chunkSize);
      expect(config.mcp.port).toBe(7200);
      expect(config.gitDetection.enabled).toBe(false);
      expect(config.fileWatching.enabled).toBe(true);
    });
  });
});

