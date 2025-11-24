import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { LienConfig, defaultConfig } from './schema.js';
import { needsMigration, migrateConfig, migrateConfigFile } from './migration.js';
import { deepMergeConfig, detectNewFields } from './merge.js';
import { CURRENT_CONFIG_VERSION } from '../constants.js';

/**
 * Result of a migration operation
 */
export interface MigrationResult {
  migrated: boolean;
  backupPath?: string;
  config: LienConfig;
  newFields?: string[];
}

/**
 * Centralized migration orchestration service
 * 
 * Handles all config migration scenarios:
 * - Auto-migration during config loading
 * - Interactive upgrade via CLI
 * - Migration status checking
 */
export class MigrationManager {
  constructor(private readonly rootDir: string = process.cwd()) {}
  
  /**
   * Get the config file path
   */
  private getConfigPath(): string {
    return path.join(this.rootDir, '.lien.config.json');
  }
  
  /**
   * Check if the current config needs migration
   */
  async needsMigration(): Promise<boolean> {
    try {
      const configPath = this.getConfigPath();
      const content = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(content);
      return needsMigration(config);
    } catch (error) {
      // If config doesn't exist or can't be read, no migration needed
      return false;
    }
  }
  
  /**
   * Perform silent migration (for auto-migration during load)
   * Returns the migrated config without user interaction
   */
  async autoMigrate(): Promise<LienConfig> {
    const result = await migrateConfigFile(this.rootDir);
    
    if (result.migrated && result.backupPath) {
      const backupFilename = path.basename(result.backupPath);
      console.log(`✅ Migration complete! Backup saved as ${backupFilename}`);
      console.log('📝 Your config now uses the framework-based structure.');
    }
    
    return result.config;
  }
  
  /**
   * Perform interactive upgrade (for CLI upgrade command)
   * Provides detailed feedback and handles edge cases
   */
  async upgradeInteractive(): Promise<void> {
    const configPath = this.getConfigPath();
    
    try {
      // 1. Read existing config
      const existingContent = await fs.readFile(configPath, 'utf-8');
      const existingConfig = JSON.parse(existingContent);
      
      // 2. Check if any changes are needed
      const migrationNeeded = needsMigration(existingConfig);
      const newFields = migrationNeeded ? [] : detectNewFields(existingConfig, defaultConfig);
      const hasChanges = migrationNeeded || newFields.length > 0;
      
      if (!hasChanges) {
        console.log(chalk.green('✓ Config is already up to date'));
        console.log(chalk.dim('No changes needed'));
        return;
      }
      
      // 3. Backup existing config (only if changes are needed)
      const backupPath = `${configPath}.backup`;
      await fs.copyFile(configPath, backupPath);
      
      // 4. Perform upgrade
      let upgradedConfig: LienConfig;
      let migrated = false;
      
      if (migrationNeeded) {
        console.log(chalk.blue(`🔄 Migrating config from v0.2.0 to v${CURRENT_CONFIG_VERSION}...`));
        upgradedConfig = migrateConfig(existingConfig);
        migrated = true;
      } else {
        // Just merge with defaults for current version configs
        upgradedConfig = deepMergeConfig(defaultConfig, existingConfig as Partial<LienConfig>);
        
        console.log(chalk.dim('\nNew options added:'));
        newFields.forEach(field => console.log(chalk.dim('  •'), chalk.bold(field)));
      }
      
      // 5. Write upgraded config
      await fs.writeFile(
        configPath,
        JSON.stringify(upgradedConfig, null, 2) + '\n',
        'utf-8'
      );
      
      // 6. Show results
      console.log(chalk.green('✓ Config upgraded successfully'));
      console.log(chalk.dim('Backup saved to:'), backupPath);
      
      if (migrated) {
        console.log(chalk.dim('\n📝 Your config now uses the framework-based structure.'));
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.log(chalk.red('Error: No config file found'));
        console.log(chalk.dim('Run'), chalk.bold('lien init'), chalk.dim('to create a config file'));
        return;
      }
      throw error;
    }
  }
  
  /**
   * Perform migration and return result
   * Used when programmatic access to migration result is needed
   */
  async migrate(): Promise<MigrationResult> {
    return migrateConfigFile(this.rootDir);
  }
}

