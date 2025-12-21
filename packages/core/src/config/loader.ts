import fs from 'fs/promises';
import path from 'path';
import { LienConfig, defaultConfig } from './schema.js';
import { deepMergeConfig } from './merge.js';

/**
 * @deprecated Per-project config is no longer required. Lien now uses global config, environment variables, and auto-detection.
 * This function is kept for backward compatibility only.
 * @see loadGlobalConfig in config/global-config.ts
 */
export async function loadConfig(rootDir: string = process.cwd()): Promise<LienConfig> {
  const configPath = path.join(rootDir, '.lien.config.json');
  
  try {
    const configContent = await fs.readFile(configPath, 'utf-8');
    const userConfig = JSON.parse(configContent);
    
    // Just merge with defaults - no migration needed
    return deepMergeConfig(defaultConfig, userConfig as Partial<LienConfig>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Config doesn't exist, return defaults
      return defaultConfig;
    }
    throw error;
  }
}

/**
 * @deprecated Use ConfigService.exists() instead. This function is kept for backward compatibility.
 * @see ConfigService
 */
export async function configExists(rootDir: string = process.cwd()): Promise<boolean> {
  const configPath = path.join(rootDir, '.lien.config.json');
  try {
    await fs.access(configPath);
    return true;
  } catch {
    return false;
  }
}

