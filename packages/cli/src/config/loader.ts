import fs from 'fs/promises';
import path from 'path';
import { LienConfig, defaultConfig } from './schema.js';
import { deepMergeConfig } from './merge.js';

export async function loadConfig(rootDir: string = process.cwd()): Promise<LienConfig> {
  const configPath = path.join(rootDir, '.lien.config.json');
  
  try {
    const configContent = await fs.readFile(configPath, 'utf-8');
    const userConfig = JSON.parse(configContent) as Partial<LienConfig>;
    
    // Use the shared merge function for consistency
    return deepMergeConfig(defaultConfig, userConfig);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Config doesn't exist, return defaults
      return defaultConfig;
    }
    throw error;
  }
}

export async function configExists(rootDir: string = process.cwd()): Promise<boolean> {
  const configPath = path.join(rootDir, '.lien.config.json');
  try {
    await fs.access(configPath);
    return true;
  } catch {
    return false;
  }
}

