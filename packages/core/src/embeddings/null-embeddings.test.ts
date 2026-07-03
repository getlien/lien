import { describe, it, expect } from 'vitest';
import { NullEmbeddings } from './null-embeddings.js';
import { EMBEDDING_DIMENSION } from './types.js';

describe('NullEmbeddings', () => {
  it('initializes without doing anything observable (no model download, no worker)', async () => {
    const service = new NullEmbeddings();
    await expect(service.initialize()).resolves.toBeUndefined();
  });

  it('embed() returns a zero-filled vector of the correct dimension', async () => {
    const service = new NullEmbeddings();
    const vector = await service.embed('some code');

    expect(vector).toBeInstanceOf(Float32Array);
    expect(vector.length).toBe(EMBEDDING_DIMENSION);
    expect(Array.from(vector).every(v => v === 0)).toBe(true);
  });

  it('embed() does not need initialize() to have been called first', async () => {
    const service = new NullEmbeddings();
    const vector = await service.embed('uninitialized call');

    expect(vector.length).toBe(EMBEDDING_DIMENSION);
  });

  it('embedBatch() returns one zero vector per input text, in order', async () => {
    const service = new NullEmbeddings();
    const texts = ['a', 'b', 'c'];
    const vectors = await service.embedBatch(texts);

    expect(vectors).toHaveLength(texts.length);
    vectors.forEach(vector => {
      expect(vector.length).toBe(EMBEDDING_DIMENSION);
      expect(Array.from(vector).every(v => v === 0)).toBe(true);
    });
  });

  it('embedBatch() returns an empty array for an empty input', async () => {
    const service = new NullEmbeddings();
    const vectors = await service.embedBatch([]);

    expect(vectors).toEqual([]);
  });

  it('dispose() resolves without error', async () => {
    const service = new NullEmbeddings();
    await expect(service.dispose()).resolves.toBeUndefined();
  });
});
