import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { getLienHome } from '@liendev/parser';
import { loadGlobalConfig, ConfigValidationError } from './global-config.js';

describe('loadGlobalConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.LIEN_BACKEND;
    // Keep retired-backend warnings out of the test output. Tests that assert
    // on the warning create their own spy against a fresh module instance.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('Environment variable handling (loadConfigFromEnv)', () => {
    it('should return null when LIEN_BACKEND is not set', async () => {
      // Mock fs.readFile to simulate missing config file
      vi.spyOn(fs, 'readFile').mockRejectedValue({ code: 'ENOENT' } as NodeJS.ErrnoException);

      const config = await loadGlobalConfig();

      // Should fall back to the default backend (sqlite)
      expect(config).toEqual({ backend: 'sqlite' });
    });

    it('should accept LIEN_BACKEND=sqlite', async () => {
      process.env.LIEN_BACKEND = 'sqlite';
      vi.spyOn(fs, 'readFile').mockRejectedValue({ code: 'ENOENT' } as NodeJS.ErrnoException);

      const config = await loadGlobalConfig();

      expect(config).toEqual({ backend: 'sqlite' });
    });

    it('should throw ConfigValidationError when LIEN_BACKEND has an invalid value', async () => {
      process.env.LIEN_BACKEND = 'invalid';
      vi.spyOn(fs, 'readFile').mockRejectedValue({ code: 'ENOENT' } as NodeJS.ErrnoException);

      await expect(loadGlobalConfig()).rejects.toThrow(ConfigValidationError);
      await expect(loadGlobalConfig()).rejects.toThrow('Invalid LIEN_BACKEND');
      await expect(loadGlobalConfig()).rejects.toThrow('invalid');
    });
  });

  describe('Config file parsing (parseConfigFile)', () => {
    const configPath = path.join(getLienHome(), '.lien', 'config.json');

    beforeEach(() => {
      vi.clearAllMocks();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('should successfully parse valid JSON config', async () => {
      const validConfig = { backend: 'sqlite' as const };
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
      vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('should throw ConfigValidationError for invalid backend values', async () => {
      vi.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify({ backend: 'invalid' }));

      await expect(loadGlobalConfig()).rejects.toThrow(ConfigValidationError);
      await expect(loadGlobalConfig()).rejects.toThrow('Invalid backend in global config');
      await expect(loadGlobalConfig()).rejects.toThrow('invalid');
    });

    it('should pass validation for valid sqlite configuration', async () => {
      vi.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify({ backend: 'sqlite' }));

      const config = await loadGlobalConfig();

      expect(config).toEqual({ backend: 'sqlite' });
    });
  });

  describe('Retired LanceDB backend (graceful degradation)', () => {
    // Import a fresh module instance so the warn-once flag is reset per test
    async function loadFreshModule() {
      vi.resetModules();
      return import('./global-config.js');
    }

    it('should fall back to sqlite when config file has backend: "lancedb"', async () => {
      const { loadGlobalConfig: load } = await loadFreshModule();
      vi.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify({ backend: 'lancedb' }));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const config = await load();

      expect(config).toEqual({ backend: 'sqlite' });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('The LanceDB backend has been retired'),
      );
    });

    it('should fall back to sqlite when LIEN_BACKEND=lancedb', async () => {
      const { loadGlobalConfig: load } = await loadFreshModule();
      process.env.LIEN_BACKEND = 'lancedb';
      vi.spyOn(fs, 'readFile').mockRejectedValue({ code: 'ENOENT' } as NodeJS.ErrnoException);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const config = await load();

      expect(config).toEqual({ backend: 'sqlite' });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('The LanceDB backend has been retired'),
      );
    });

    it('should warn only once per process for repeated loads', async () => {
      const { loadGlobalConfig: load } = await loadFreshModule();
      vi.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify({ backend: 'lancedb' }));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await load();
      await load();
      await load();

      expect(warnSpy).toHaveBeenCalledOnce();
    });
  });

  describe('Retired Qdrant settings (graceful degradation)', () => {
    // Import a fresh module instance so the warn-once flag is reset per test
    async function loadFreshModule() {
      vi.resetModules();
      return import('./global-config.js');
    }

    it('should fall back to sqlite when config file has backend: "qdrant"', async () => {
      const { loadGlobalConfig: load } = await loadFreshModule();
      vi.spyOn(fs, 'readFile').mockResolvedValue(
        JSON.stringify({
          backend: 'qdrant',
          qdrant: { url: 'http://localhost:6333', apiKey: 'test-key' },
        }),
      );
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const config = await load();

      expect(config).toEqual({ backend: 'sqlite' });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Qdrant support was removed'));
    });

    it('should strip orphaned qdrant.* keys even when backend is sqlite', async () => {
      const { loadGlobalConfig: load } = await loadFreshModule();
      vi.spyOn(fs, 'readFile').mockResolvedValue(
        JSON.stringify({
          backend: 'sqlite',
          qdrant: { url: 'http://localhost:6333' },
        }),
      );
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const config = await load();

      expect(config).toEqual({ backend: 'sqlite' });
      expect(warnSpy).toHaveBeenCalledOnce();
    });

    it('should fall back to sqlite when LIEN_BACKEND=qdrant', async () => {
      const { loadGlobalConfig: load } = await loadFreshModule();
      process.env.LIEN_BACKEND = 'qdrant';
      vi.spyOn(fs, 'readFile').mockRejectedValue({ code: 'ENOENT' } as NodeJS.ErrnoException);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const config = await load();

      expect(config).toEqual({ backend: 'sqlite' });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Qdrant support was removed'));
    });

    it('should drop retired qdrant keys when merging config updates', async () => {
      const { mergeGlobalConfig: merge } = await loadFreshModule();
      vi.spyOn(fs, 'readFile').mockResolvedValue(
        JSON.stringify({ backend: 'qdrant', qdrant: { url: 'http://localhost:6333' } }),
      );
      vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
      const writeSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const merged = await merge({ backend: 'sqlite' });

      expect(merged).toEqual({ backend: 'sqlite' });
      const written = JSON.parse((writeSpy.mock.calls[0]![1] as string).toString());
      expect(written).toEqual({ backend: 'sqlite' });
    });
  });

  describe('File not found behavior', () => {
    it('should return default config when config file does not exist', async () => {
      vi.spyOn(fs, 'readFile').mockRejectedValue({ code: 'ENOENT' } as NodeJS.ErrnoException);

      const config = await loadGlobalConfig();

      expect(config).toEqual({ backend: 'sqlite' });
    });
  });

  describe('Precedence order', () => {
    it('should prefer environment variables over config file', async () => {
      process.env.LIEN_BACKEND = 'sqlite';

      // Mock config file (env should win regardless of file contents)
      vi.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify({ backend: 'sqlite' }));

      const config = await loadGlobalConfig();

      expect(config.backend).toBe('sqlite');
    });
  });
});
