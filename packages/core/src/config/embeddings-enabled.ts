import type { LienConfig } from './schema.js';
import { configService } from './service.js';

/**
 * Resolve whether embeddings are enabled for a project, from
 * `.lien.config.json`'s `embeddings.enabled` (default: true).
 *
 * A malformed or unreadable project config must never block indexing,
 * serving, or status reporting — on any config error this falls back to
 * "enabled", matching the default every user got before this setting
 * existed (the project config file was not read at all until this
 * feature shipped, so a stale/invalid one must stay a no-op).
 *
 * @param rootDir - Project root to load `.lien.config.json` from
 * @param preloadedConfig - Optional already-loaded config, to skip the
 *   disk read (e.g. when a caller already has `IndexingOptions.config`)
 */
export async function resolveEmbeddingsEnabled(
  rootDir: string,
  preloadedConfig?: LienConfig,
): Promise<boolean> {
  try {
    const config = preloadedConfig ?? (await configService.load(rootDir));
    return config.embeddings?.enabled !== false;
  } catch {
    return true;
  }
}
