import fs from 'fs/promises';
import path from 'path';
import { LienConfig, defaultConfig } from './schema.js';
import { deepMergeConfig } from './merge.js';
import { needsMigration, migrateConfigFile } from './migration.js';

/**
 * @deprecated Use ConfigService.load() instead. This function is kept for backward compatibility.
 * @see ConfigService
 */
export async function loadConfig(rootDir: string = process.cwd()): Promise<LienConfig> {
  const configPath = path.join(rootDir, '.lien.config.json');
  
  try {
    const configContent = await fs.readFile(configPath, 'utf-8');
    const userConfig = JSON.parse(configContent);
    
    // Check if migration is needed
    if (needsMigration(userConfig)) {
      console.log('🔄 Migrating config from v0.2.0 to v0.3.0...');
      
      const result = await migrateConfigFile(rootDir);
      
      if (result.migrated && result.backupPath) {
        const backupFilename = path.basename(result.backupPath);
        console.log(`✅ Migration complete! Backup saved as ${backupFilename}`);
        console.log('📝 Your config now uses the framework-based structure.');
      }
      
      return result.config;
    }
    
    // Use the shared merge function for consistency
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

