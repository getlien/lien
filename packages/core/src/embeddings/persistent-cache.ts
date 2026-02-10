import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { EmbeddingService } from './types.js';
import { EMBEDDING_DIMENSIONS } from '../constants.js';

export interface PersistentCacheOptions {
  /** Base path for cache files (without extension). Files created: {cachePath}.json and {cachePath}.bin */
  cachePath: string;
  /** Maximum number of entries (default: 50000) */
  maxEntries?: number;
  /** Embedding dimensions (default: EMBEDDING_DIMENSIONS = 384) */
  dimensions?: number;
  /** Model name for cache invalidation */
  modelName?: string;
}

interface CacheIndex {
  version: 1;
  modelName: string;
  dimensions: number;
  entries: Record<string, { slot: number; lastAccess: number }>;
  nextSlot: number;
  freeSlots: number[];
}

const DEFAULT_MAX_ENTRIES = 50000;
const INITIAL_ALLOCATED_SLOTS = 1000;

export class PersistentEmbeddingCache {
  private entries: Map<string, { slot: number; lastAccess: number }>;
  private accessCounter: number;
  private data: Buffer;
  private freeSlots: number[];
  private nextSlot: number;
  private dirty: boolean;
  private _hitCount: number;
  private _missCount: number;
  private allocatedSlots: number;

  private readonly cachePath: string;
  private readonly maxEntries: number;
  private readonly dimensions: number;
  private readonly modelName: string;
  private readonly bytesPerVector: number;

  constructor(options: PersistentCacheOptions) {
    this.cachePath = options.cachePath;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.dimensions = options.dimensions ?? EMBEDDING_DIMENSIONS;
    this.modelName = options.modelName ?? 'default';
    this.bytesPerVector = this.dimensions * 4; // Float32 = 4 bytes

    this.entries = new Map();
    this.accessCounter = 0;
    this.freeSlots = [];
    this.nextSlot = 0;
    this.dirty = false;
    this._hitCount = 0;
    this._missCount = 0;
    this.allocatedSlots = Math.min(INITIAL_ALLOCATED_SLOTS, this.maxEntries);
    this.data = Buffer.alloc(this.allocatedSlots * this.bytesPerVector);
  }

  async initialize(): Promise<void> {
    const indexPath = this.cachePath + '.json';
    const dataPath = this.cachePath + '.bin';

    try {
      const indexData = await fs.readFile(indexPath, 'utf-8');
      const index: CacheIndex = JSON.parse(indexData);

      // Clear cache if version, model name, or dimensions mismatch
      if (index.version !== 1 || index.modelName !== this.modelName || index.dimensions !== this.dimensions) {
        await this.deleteFiles();
        this.clear();
        return;
      }

      // Restore entries
      this.entries = new Map(Object.entries(index.entries));
      this.nextSlot = index.nextSlot;
      this.freeSlots = index.freeSlots;

      // Find max access counter to resume from
      this.accessCounter = 0;
      for (const entry of this.entries.values()) {
        if (entry.lastAccess > this.accessCounter) {
          this.accessCounter = entry.lastAccess;
        }
      }

      // Load binary data
      const binData = await fs.readFile(dataPath);
      this.allocatedSlots = Math.max(
        INITIAL_ALLOCATED_SLOTS,
        this.nextSlot,
        this.entries.size
      );
      // Ensure allocated slots can hold at least what we need
      while (this.allocatedSlots < this.nextSlot) {
        this.allocatedSlots *= 2;
      }
      this.data = Buffer.alloc(this.allocatedSlots * this.bytesPerVector);
      binData.copy(this.data, 0, 0, Math.min(binData.length, this.data.length));

      this.dirty = false;
    } catch {
      // Files don't exist or are corrupted — start fresh
      this.clear();
    }
  }

  computeHash(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
  }

  get(hash: string): Float32Array | undefined {
    const entry = this.entries.get(hash);
    if (!entry) {
      this._missCount++;
      return undefined;
    }

    this._hitCount++;
    entry.lastAccess = ++this.accessCounter;
    this.dirty = true;

    const offset = entry.slot * this.bytesPerVector;
    const result = new Float32Array(this.dimensions);
    for (let i = 0; i < this.dimensions; i++) {
      result[i] = this.data.readFloatLE(offset + i * 4);
    }
    return result;
  }

  set(hash: string, embedding: Float32Array): void {
    if (embedding.length !== this.dimensions) {
      throw new Error(`Embedding dimension mismatch: expected ${this.dimensions}, got ${embedding.length}`);
    }

    // If already exists, update in place
    const existing = this.entries.get(hash);
    if (existing) {
      existing.lastAccess = ++this.accessCounter;
      this.writeVector(existing.slot, embedding);
      this.dirty = true;
      return;
    }

    // Evict if at capacity
    if (this.entries.size >= this.maxEntries) {
      this.evictOldest();
    }

    // Allocate a slot
    let slot: number;
    if (this.freeSlots.length > 0) {
      slot = this.freeSlots.pop()!;
    } else {
      slot = this.nextSlot++;
    }

    // Grow buffer if needed
    this.ensureCapacity(slot);

    this.entries.set(hash, { slot, lastAccess: ++this.accessCounter });
    this.writeVector(slot, embedding);
    this.dirty = true;
  }

  async flush(): Promise<void> {
    if (!this.dirty && this.entries.size === 0) {
      return;
    }

    // Ensure directory exists
    const dir = path.dirname(this.cachePath);
    await fs.mkdir(dir, { recursive: true });

    const index: CacheIndex = {
      version: 1,
      modelName: this.modelName,
      dimensions: this.dimensions,
      entries: Object.fromEntries(this.entries),
      nextSlot: this.nextSlot,
      freeSlots: this.freeSlots,
    };

    const indexPath = this.cachePath + '.json';
    const dataPath = this.cachePath + '.bin';
    const indexTmp = indexPath + '.tmp';
    const dataTmp = dataPath + '.tmp';

    // Write atomically: write to .tmp then rename
    await fs.writeFile(indexTmp, JSON.stringify(index), 'utf-8');
    await fs.rename(indexTmp, indexPath);

    // Only write the used portion of the buffer
    const usedBytes = this.nextSlot * this.bytesPerVector;
    await fs.writeFile(dataTmp, this.data.subarray(0, usedBytes));
    await fs.rename(dataTmp, dataPath);

    this.dirty = false;
  }

  async dispose(): Promise<void> {
    await this.flush();
    this.entries.clear();
    this.data = Buffer.alloc(0);
    this.freeSlots = [];
    this.nextSlot = 0;
    this.accessCounter = 0;
    this.allocatedSlots = 0;
    this.dirty = false;
  }

  get size(): number {
    return this.entries.size;
  }

  get hitCount(): number {
    return this._hitCount;
  }

  get missCount(): number {
    return this._missCount;
  }

  private clear(): void {
    this.entries = new Map();
    this.accessCounter = 0;
    this.freeSlots = [];
    this.nextSlot = 0;
    this.dirty = false;
    this.allocatedSlots = Math.min(INITIAL_ALLOCATED_SLOTS, this.maxEntries);
    this.data = Buffer.alloc(this.allocatedSlots * this.bytesPerVector);
  }

  private async deleteFiles(): Promise<void> {
    try { await fs.unlink(this.cachePath + '.json'); } catch { /* ignore */ }
    try { await fs.unlink(this.cachePath + '.bin'); } catch { /* ignore */ }
  }

  private writeVector(slot: number, embedding: Float32Array): void {
    const offset = slot * this.bytesPerVector;
    for (let i = 0; i < this.dimensions; i++) {
      this.data.writeFloatLE(embedding[i], offset + i * 4);
    }
  }

  private ensureCapacity(slot: number): void {
    if (slot < this.allocatedSlots) {
      return;
    }

    // Double until we can fit the slot
    let newAllocated = this.allocatedSlots;
    while (newAllocated <= slot) {
      newAllocated = Math.min(newAllocated * 2, this.maxEntries);
      if (newAllocated <= slot) {
        // If doubling capped at maxEntries isn't enough, just use slot + 1
        newAllocated = slot + 1;
        break;
      }
    }

    const newBuffer = Buffer.alloc(newAllocated * this.bytesPerVector);
    this.data.copy(newBuffer, 0, 0, this.data.length);
    this.data = newBuffer;
    this.allocatedSlots = newAllocated;
  }

  private evictOldest(): void {
    let oldestHash: string | undefined;
    let oldestAccess = Infinity;

    for (const [hash, entry] of this.entries) {
      if (entry.lastAccess < oldestAccess) {
        oldestAccess = entry.lastAccess;
        oldestHash = hash;
      }
    }

    if (oldestHash) {
      const entry = this.entries.get(oldestHash)!;
      this.freeSlots.push(entry.slot);
      this.entries.delete(oldestHash);
    }
  }
}

/**
 * Embed texts with persistent cache lookup.
 * Computes hashes, checks cache, only embeds misses, stores results.
 */
export async function embedBatchWithCache(
  texts: string[],
  embeddings: EmbeddingService,
  cache: PersistentEmbeddingCache,
): Promise<Float32Array[]> {
  const results: Float32Array[] = new Array(texts.length);
  const uncachedTexts: string[] = [];
  const uncachedIndices: number[] = [];
  const hashes = texts.map(t => cache.computeHash(t));

  // Check cache
  for (let i = 0; i < texts.length; i++) {
    const cached = cache.get(hashes[i]);
    if (cached) {
      results[i] = cached;
    } else {
      uncachedTexts.push(texts[i]);
      uncachedIndices.push(i);
    }
  }

  // Embed misses
  if (uncachedTexts.length > 0) {
    const newEmbeddings = await embeddings.embedBatch(uncachedTexts);
    for (let i = 0; i < newEmbeddings.length; i++) {
      results[uncachedIndices[i]] = newEmbeddings[i];
      cache.set(hashes[uncachedIndices[i]], newEmbeddings[i]);
    }
  }

  return results;
}
