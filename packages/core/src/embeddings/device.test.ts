import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveEmbeddingDevice } from './device.js';

describe('resolveEmbeddingDevice', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.LIEN_EMBEDDING_DEVICE;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return null when no config and no env var', () => {
    expect(resolveEmbeddingDevice()).toBeNull();
  });

  it('should return null when config device is cpu', () => {
    expect(resolveEmbeddingDevice({ embeddings: { device: 'cpu' } })).toBeNull();
  });

  it('should return null when no config provided', () => {
    expect(resolveEmbeddingDevice(undefined)).toBeNull();
  });

  it('should return null for empty config', () => {
    expect(resolveEmbeddingDevice({})).toBeNull();
  });

  it('should return webgpu when config device is gpu', () => {
    expect(resolveEmbeddingDevice({ embeddings: { device: 'gpu' } })).toBe('webgpu');
  });

  it('should prefer env var over config', () => {
    process.env.LIEN_EMBEDDING_DEVICE = 'cpu';
    expect(resolveEmbeddingDevice({ embeddings: { device: 'gpu' } })).toBeNull();
  });

  it('should return webgpu when env var is gpu', () => {
    process.env.LIEN_EMBEDDING_DEVICE = 'gpu';
    expect(resolveEmbeddingDevice()).toBe('webgpu');
  });

  it('should handle env var with extra whitespace', () => {
    process.env.LIEN_EMBEDDING_DEVICE = '  GPU  ';
    expect(resolveEmbeddingDevice()).toBe('webgpu');
  });

  it('should handle env var with mixed case', () => {
    process.env.LIEN_EMBEDDING_DEVICE = 'Gpu';
    expect(resolveEmbeddingDevice()).toBe('webgpu');
  });

  it('should throw for invalid value in config', () => {
    expect(() => resolveEmbeddingDevice({ embeddings: { device: 'invalid' as any } })).toThrow(
      'Invalid embedding device: "invalid"',
    );
  });

  it('should throw for invalid env var value', () => {
    process.env.LIEN_EMBEDDING_DEVICE = 'tpu';
    expect(() => resolveEmbeddingDevice()).toThrow('Invalid embedding device: "tpu"');
  });
});
