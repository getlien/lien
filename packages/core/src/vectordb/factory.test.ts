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
    constructor(
      _url: string,
      _apiKey: string | undefined,
      _orgId: string,
      _projectRoot: string,
      _branch: string,
      _commitSha: string
    ) {
      // Mock constructor accepts same parameters as real QdrantDB
    }
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

    it('should throw error when git commands fail (fail-fast)', async () => {
      vi.mocked(getCurrentBranch).mockRejectedValue(new Error('Git branch detection failed'));
      vi.mocked(getCurrentCommit).mockRejectedValue(new Error('Git commit detection failed'));

      await expect(createVectorDB(testDir)).rejects.toThrow(
        /Qdrant backend requires a valid git branch and commit SHA[\s\S]*Failed to detect current branch and\/or commit from git/
      );
    });

    it('should throw error when branch is empty string', async () => {
      vi.mocked(getCurrentBranch).mockResolvedValue('');
      vi.mocked(getCurrentCommit).mockResolvedValue('abc123');

      await expect(createVectorDB(testDir)).rejects.toThrow(
        'Qdrant backend requires a valid git branch for proper data isolation'
      );
    });

    it('should throw error when commitSha is empty string', async () => {
      vi.mocked(getCurrentBranch).mockResolvedValue('main');
      vi.mocked(getCurrentCommit).mockResolvedValue('');

      await expect(createVectorDB(testDir)).rejects.toThrow(
        'Qdrant backend requires a valid git commit SHA for proper data isolation'
      );
    });

    it('should throw error when branch is whitespace only', async () => {
      vi.mocked(getCurrentBranch).mockResolvedValue('   ');
      vi.mocked(getCurrentCommit).mockResolvedValue('abc123');

      await expect(createVectorDB(testDir)).rejects.toThrow(
        'Qdrant backend requires a valid git branch for proper data isolation'
      );
    });

    it('should throw error when commitSha is whitespace only', async () => {
      vi.mocked(getCurrentBranch).mockResolvedValue('main');
      vi.mocked(getCurrentCommit).mockResolvedValue('\t  \n');

      await expect(createVectorDB(testDir)).rejects.toThrow(
        'Qdrant backend requires a valid git commit SHA for proper data isolation'
      );
    });

    it('should not silently fall back to LanceDB when Qdrant is explicitly configured', async () => {
      vi.mocked(extractOrgIdFromGit).mockRejectedValue(new Error('Git remote not found'));

      await expect(createVectorDB(testDir)).rejects.toThrow();
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
        '/test/.lien/config.json'
      );
      vi.mocked(loadGlobalConfig).mockRejectedValue(error);

      await expect(createVectorDB(testDir)).rejects.toThrow(ConfigValidationError);
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

