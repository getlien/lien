import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createVectorDB } from './factory.js';
import { loadGlobalConfig, extractOrgIdFromGit } from '../config/global-config.js';
import { getCurrentBranch, getCurrentCommit } from '../git/utils.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Mock dependencies - must be hoisted
vi.mock('../config/global-config.js');
vi.mock('../git/utils.js');
vi.mock('./lancedb.js', () => ({
  VectorDB: class MockVectorDB {
    dbPath = '/test/path';
    async initialize() {}
  },
}));
vi.mock('./qdrant.js', () => ({
  QdrantDB: class MockQdrantDB {
    dbPath = '/test/path';
    async initialize() {}
    constructor() {}
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
      } as any);

      const db = await createVectorDB(testDir);
      expect(db).toBeDefined();
    });

    it('should create LanceDB instance when backend is undefined (default)', async () => {
      vi.mocked(loadGlobalConfig).mockResolvedValue({
        backend: undefined,
      } as any);

      const db = await createVectorDB(testDir);
      expect(db).toBeDefined();
    });
  });

  describe('Qdrant backend', () => {
    beforeEach(() => {
      vi.mocked(loadGlobalConfig).mockResolvedValue({
        backend: 'qdrant',
        qdrant: {
          url: 'http://localhost:6333',
        },
      } as any);
      vi.mocked(extractOrgIdFromGit).mockResolvedValue('test-org');
      vi.mocked(getCurrentBranch).mockResolvedValue('main');
      vi.mocked(getCurrentCommit).mockResolvedValue('abc123');
    });

    it('should successfully extract branch and commit from git', async () => {
      const db = await createVectorDB(testDir);
      
      expect(extractOrgIdFromGit).toHaveBeenCalledWith(testDir);
      expect(getCurrentBranch).toHaveBeenCalledWith(testDir);
      expect(getCurrentCommit).toHaveBeenCalledWith(testDir);
      expect(db).toBeDefined();
    });

    it('should throw error when qdrant config is missing', async () => {
      vi.mocked(loadGlobalConfig).mockResolvedValue({
        backend: 'qdrant',
        qdrant: undefined,
      } as any);

      await expect(createVectorDB(testDir)).rejects.toThrow(
        'Qdrant backend requires qdrant configuration in global config'
      );
    });

    it('should throw error when orgId cannot be extracted', async () => {
      vi.mocked(extractOrgIdFromGit).mockResolvedValue(null);

      await expect(createVectorDB(testDir)).rejects.toThrow(
        'Qdrant backend requires a git repository with a remote URL'
      );
    });

    it('should log warning and use fallbacks when git commands fail', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      vi.mocked(getCurrentBranch).mockRejectedValue(new Error('Git error'));
      vi.mocked(getCurrentCommit).mockRejectedValue(new Error('Git error'));

      const db = await createVectorDB(testDir);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Lien] Warning: Failed to detect git branch/commit')
      );
      expect(db).toBeDefined();
      
      consoleSpy.mockRestore();
    });

    it('should not silently fall back to LanceDB when Qdrant is explicitly configured', async () => {
      vi.mocked(extractOrgIdFromGit).mockRejectedValue(new Error('Git remote not found'));

      await expect(createVectorDB(testDir)).rejects.toThrow();
    });
  });

  describe('Error handling', () => {
    it('should fall back to LanceDB when config loading fails', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      vi.mocked(loadGlobalConfig).mockRejectedValue(new Error('Config file not found'));

      const db = await createVectorDB(testDir);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Lien] Failed to load global config')
      );
      expect(db).toBeDefined();
      
      consoleSpy.mockRestore();
    });

    it('should throw error for unknown backend', async () => {
      vi.mocked(loadGlobalConfig).mockResolvedValue({
        backend: 'unknown-backend',
      } as any);

      await expect(createVectorDB(testDir)).rejects.toThrow(
        'Unknown storage backend: unknown-backend'
      );
    });
  });
});

