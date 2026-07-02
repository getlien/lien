import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createVectorDB } from './factory.js';
import { loadGlobalConfig } from '../config/global-config.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Mock dependencies - must be hoisted
vi.mock('../config/global-config.js');
vi.mock('./lancedb.js', () => ({
  VectorDB: class MockVectorDB {
    dbPath = '/test/path';
    async initialize() {}
  },
}));

describe('createVectorDB', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-'));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('LanceDB backend', () => {
    it('should create LanceDB instance when backend is lancedb', async () => {
      vi.mocked(loadGlobalConfig).mockResolvedValue({
        backend: 'lancedb',
      });

      const db = await createVectorDB(testDir);
      expect(db).toBeDefined();
    });

    it('should create LanceDB instance when backend is undefined (default)', async () => {
      vi.mocked(loadGlobalConfig).mockResolvedValue({
        backend: undefined,
      });

      const db = await createVectorDB(testDir);
      expect(db).toBeDefined();
    });
  });

  describe('Error handling', () => {
    it('should silently fall back to LanceDB when config file does not exist (normal for CLI)', async () => {
      const error = new Error('ENOENT: Config file not found') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      vi.mocked(loadGlobalConfig).mockRejectedValue(error);

      const db = await createVectorDB(testDir);

      expect(db).toBeDefined();
      // No console output expected - this is normal behavior
    });

    it('should fail hard when config file exists but has errors (fail-fast)', async () => {
      const { ConfigValidationError } = await import('../config/global-config.js');
      const error = new ConfigValidationError(
        'Failed to parse global config file.\nConfig file: /test/.lien/config.json\nSyntax error: JSON syntax error',
        '/test/.lien/config.json',
      );
      vi.mocked(loadGlobalConfig).mockRejectedValue(error);

      await expect(createVectorDB(testDir)).rejects.toThrow(ConfigValidationError);
    });

    it('should wrap unexpected config-load errors with a helpful message', async () => {
      vi.mocked(loadGlobalConfig).mockRejectedValue(new Error('Permission denied'));

      await expect(createVectorDB(testDir)).rejects.toThrow('Failed to load global config file');
    });
  });
});
