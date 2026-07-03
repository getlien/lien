import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { resolveEmbeddingsEnabled } from './embeddings-enabled.js';
import { defaultConfig } from './schema.js';
import type { LienConfig } from './schema.js';

describe('resolveEmbeddingsEnabled', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-embeddings-enabled-test-'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it('defaults to true when no project config exists', async () => {
    await expect(resolveEmbeddingsEnabled(testDir)).resolves.toBe(true);
  });

  it('returns false when embeddings.enabled is explicitly false in .lien.config.json', async () => {
    const configPath = path.join(testDir, '.lien.config.json');
    const config: LienConfig = { ...defaultConfig, embeddings: { enabled: false } };
    await fs.writeFile(configPath, JSON.stringify(config));

    await expect(resolveEmbeddingsEnabled(testDir)).resolves.toBe(false);
  });

  it('returns true when embeddings.enabled is explicitly true', async () => {
    const configPath = path.join(testDir, '.lien.config.json');
    const config: LienConfig = { ...defaultConfig, embeddings: { enabled: true } };
    await fs.writeFile(configPath, JSON.stringify(config));

    await expect(resolveEmbeddingsEnabled(testDir)).resolves.toBe(true);
  });

  it('falls back to true (not throw) for a malformed config file', async () => {
    const configPath = path.join(testDir, '.lien.config.json');
    await fs.writeFile(configPath, '{ not valid json');

    await expect(resolveEmbeddingsEnabled(testDir)).resolves.toBe(true);
  });

  it('uses a preloaded config instead of reading from disk', async () => {
    // No file on disk at all — if this reads the preloaded config value
    // rather than hitting the filesystem, it must return false here.
    const preloaded: LienConfig = { ...defaultConfig, embeddings: { enabled: false } };

    await expect(resolveEmbeddingsEnabled(testDir, preloaded)).resolves.toBe(false);
  });
});
