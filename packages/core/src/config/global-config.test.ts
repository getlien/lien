import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { loadGlobalConfig, ConfigValidationError } from './global-config.js';

describe('loadGlobalConfig', () => {
  const originalEnv = process.env;
  
  beforeEach(() => {
    // Reset environment before each test
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.LIEN_BACKEND;
    delete process.env.LIEN_QDRANT_URL;
    delete process.env.LIEN_QDRANT_API_KEY;
  });
  
  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Environment variable handling (loadConfigFromEnv)', () => {
    it('should return null when LIEN_BACKEND is not set', async () => {
      // Mock fs.readFile to simulate missing config file
      vi.spyOn(fs, 'readFile').mockRejectedValue({ code: 'ENOENT' } as NodeJS.ErrnoException);
      
      const config = await loadGlobalConfig();
      
      // Should fall back to defaults
      expect(config).toEqual({ backend: 'lancedb' });
    });

    it('should return config with backend only when LIEN_BACKEND is set to lancedb', async () => {
      process.env.LIEN_BACKEND = 'lancedb';
      
      const config = await loadGlobalConfig();
      
      expect(config).toEqual({ backend: 'lancedb' });
    });

    it('should return complete qdrant config when all environment variables are set', async () => {
      process.env.LIEN_BACKEND = 'qdrant';
      process.env.LIEN_QDRANT_URL = 'http://localhost:6333';
      process.env.LIEN_QDRANT_API_KEY = 'test-api-key';
      
      const config = await loadGlobalConfig();
      
      expect(config).toEqual({
        backend: 'qdrant',
        qdrant: {
          url: 'http://localhost:6333',
          apiKey: 'test-api-key',
        },
      });
    });

    it('should return qdrant config without apiKey when only URL is set', async () => {
      process.env.LIEN_BACKEND = 'qdrant';
      process.env.LIEN_QDRANT_URL = 'http://localhost:6333';
      
      const config = await loadGlobalConfig();
      
      expect(config).toEqual({
        backend: 'qdrant',
        qdrant: {
          url: 'http://localhost:6333',
          apiKey: undefined,
        },
      });
    });

    it('should throw ConfigValidationError when LIEN_BACKEND is qdrant but LIEN_QDRANT_URL is missing', async () => {
      process.env.LIEN_BACKEND = 'qdrant';
      // LIEN_QDRANT_URL is not set
      
      await expect(loadGlobalConfig()).rejects.toThrow(ConfigValidationError);
      await expect(loadGlobalConfig()).rejects.toThrow('requires LIEN_QDRANT_URL');
    });

    it('should throw ConfigValidationError when LIEN_BACKEND has an invalid value', async () => {
      process.env.LIEN_BACKEND = 'invalid';
      
      await expect(loadGlobalConfig()).rejects.toThrow(ConfigValidationError);
      await expect(loadGlobalConfig()).rejects.toThrow('Invalid LIEN_BACKEND');
      await expect(loadGlobalConfig()).rejects.toThrow('invalid');
    });
  });

  describe('Config file parsing (parseConfigFile)', () => {
    const configPath = path.join(os.homedir(), '.lien', 'config.json');
    
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should successfully parse valid JSON config', async () => {
      const validConfig = { backend: 'lancedb' as const };
      vi.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify(validConfig));
      
      const config = await loadGlobalConfig();
      
      expect(config).toEqual(validConfig);
    });

    it('should throw ConfigValidationError with helpful message for invalid JSON syntax', async () => {
      vi.spyOn(fs, 'readFile').mockResolvedValue('{ invalid json }');
      
      await expect(loadGlobalConfig()).rejects.toThrow(ConfigValidationError);
      await expect(loadGlobalConfig()).rejects.toThrow('Failed to parse global config file');
      await expect(loadGlobalConfig()).rejects.toThrow('Syntax error');
    });

    it('should include the configPath in the error message', async () => {
      vi.spyOn(fs, 'readFile').mockResolvedValue('{ invalid json }');
      
      try {
        await loadGlobalConfig();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigValidationError);
        expect((error as ConfigValidationError).configPath).toBe(configPath);
        expect((error as Error).message).toContain(configPath);
      }
    });
  });

  describe('Config validation (validateConfig)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should throw ConfigValidationError for invalid backend values', async () => {
      vi.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify({ backend: 'invalid' }));
      
      await expect(loadGlobalConfig()).rejects.toThrow(ConfigValidationError);
      await expect(loadGlobalConfig()).rejects.toThrow('Invalid backend in global config');
      await expect(loadGlobalConfig()).rejects.toThrow('invalid');
    });

    it('should throw ConfigValidationError when backend is qdrant but qdrant config object is missing', async () => {
      vi.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify({ 
        backend: 'qdrant'
        // qdrant config object is completely missing
      }));
      
      await expect(loadGlobalConfig()).rejects.toThrow(ConfigValidationError);
      await expect(loadGlobalConfig()).rejects.toThrow('requires a "qdrant" configuration section');
    });

    it('should throw ConfigValidationError when backend is qdrant but qdrant.url is missing', async () => {
      vi.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify({ 
        backend: 'qdrant',
        qdrant: { apiKey: 'test-key' } // url is missing
      }));
      
      await expect(loadGlobalConfig()).rejects.toThrow(ConfigValidationError);
      await expect(loadGlobalConfig()).rejects.toThrow('requires qdrant.url');
    });

    it('should pass validation for valid lancedb configuration', async () => {
      vi.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify({ backend: 'lancedb' }));
      
      const config = await loadGlobalConfig();
      
      expect(config).toEqual({ backend: 'lancedb' });
    });

    it('should pass validation for valid qdrant configuration', async () => {
      const validConfig = {
        backend: 'qdrant' as const,
        qdrant: {
          url: 'http://localhost:6333',
          apiKey: 'test-key',
        },
      };
      vi.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify(validConfig));
      
      const config = await loadGlobalConfig();
      
      expect(config).toEqual(validConfig);
    });
  });

  describe('File not found behavior', () => {
    it('should return default config when config file does not exist', async () => {
      vi.spyOn(fs, 'readFile').mockRejectedValue({ code: 'ENOENT' } as NodeJS.ErrnoException);
      
      const config = await loadGlobalConfig();
      
      expect(config).toEqual({ backend: 'lancedb' });
    });
  });

  describe('Precedence order', () => {
    it('should prefer environment variables over config file', async () => {
      process.env.LIEN_BACKEND = 'lancedb';

      // Mock config file with different backend
      vi.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify({
        backend: 'qdrant',
        qdrant: { url: 'http://localhost:6333' }
      }));

      const config = await loadGlobalConfig();

      // Env var overrides backend, but file config's qdrant section is preserved
      expect(config.backend).toBe('lancedb');
    });
  });
});

