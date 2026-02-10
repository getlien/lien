import type { GlobalConfig } from '../config/global-config.js';

export type EmbeddingDevice = 'webgpu' | null;

/**
 * Resolve the embedding device from env var override or global config.
 *
 * Returns 'webgpu' when GPU is requested, or null for CPU (default).
 * Env var LIEN_EMBEDDING_DEVICE takes precedence over global config.
 */
export function resolveEmbeddingDevice(globalConfig?: GlobalConfig): EmbeddingDevice {
  const envValue = process.env.LIEN_EMBEDDING_DEVICE?.toLowerCase().trim();
  const value = envValue || globalConfig?.embeddings?.device;

  if (!value || value === 'cpu') return null;
  if (value === 'gpu') return 'webgpu';

  throw new Error(`Invalid embedding device: "${value}". Valid values: cpu, gpu`);
}
