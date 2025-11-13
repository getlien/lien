import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { defaultConfig, LienConfig } from '../config/schema.js';
import { deepMergeConfig, detectNewFields } from '../config/merge.js';
import { showCompactBanner } from '../utils/banner.js';
import { needsMigration, migrateConfig } from '../config/migration.js';

export async function initCommand(options: { upgrade?: boolean } = {}) {
  const configPath = path.join(process.cwd(), '.lien.config.json');
  
  try {
    // Check if config already exists
    let configExists = false;
    try {
      await fs.access(configPath);
      configExists = true;
    } catch {
      // File doesn't exist
    }
    
    // Handle different scenarios
    if (configExists && !options.upgrade) {
      console.log(chalk.yellow('⚠️  .lien.config.json already exists'));
      console.log(chalk.dim('Run'), chalk.bold('lien init --upgrade'), chalk.dim('to merge new config options'));
      return;
    }
    
    if (!configExists && options.upgrade) {
      console.log(chalk.yellow('⚠️  No config file found. Creating new one...'));
      // Fall through to create new config
    }
    
    if (configExists && options.upgrade) {
      await upgradeConfig(configPath);
      return;
    }
    
    // Show banner for new initialization
    if (!configExists) {
      showCompactBanner();
      console.log(chalk.bold('Initializing Lien...\n'));
    }
    
    // Create new config file
    await fs.writeFile(
      configPath,
      JSON.stringify(defaultConfig, null, 2) + '\n',
      'utf-8'
    );
    
    console.log(chalk.green('✓ Created .lien.config.json'));
    console.log(chalk.dim('\nNext steps:'));
    console.log(chalk.dim('  1. Run'), chalk.bold('lien serve'), chalk.dim('to start the MCP server (auto-indexes on first run)'));
    console.log(chalk.dim('  2. Configure Cursor to use the MCP server'));
  } catch (error) {
    console.error(chalk.red('Error creating config file:'), error);
    process.exit(1);
  }
}

async function upgradeConfig(configPath: string) {
  try {
    // 1. Backup existing config
    const backupPath = `${configPath}.backup`;
    await fs.copyFile(configPath, backupPath);
    
    // 2. Read existing config
    const existingContent = await fs.readFile(configPath, 'utf-8');
    const existingConfig = JSON.parse(existingContent);
    
    let upgradedConfig: LienConfig;
    let migrated = false;
    
    // 3. Check if migration is needed (v0.2.0 -> v0.3.0)
    if (needsMigration(existingConfig)) {
      console.log(chalk.blue('🔄 Migrating config from v0.2.0 to v0.3.0...'));
      upgradedConfig = migrateConfig(existingConfig);
      migrated = true;
    } else {
      // Just merge with defaults for v0.3.0 configs
      const newFields = detectNewFields(existingConfig, defaultConfig);
      upgradedConfig = deepMergeConfig(defaultConfig, existingConfig as Partial<LienConfig>);
      
      if (newFields.length > 0) {
        console.log(chalk.dim('\nNew options added:'));
        newFields.forEach(field => console.log(chalk.dim('  •'), chalk.bold(field)));
      }
    }
    
    // 4. Write upgraded config
    await fs.writeFile(
      configPath,
      JSON.stringify(upgradedConfig, null, 2) + '\n',
      'utf-8'
    );
    
    // 5. Show results
    console.log(chalk.green('✓ Config upgraded successfully'));
    console.log(chalk.dim('Backup saved to:'), backupPath);
    
    if (migrated) {
      console.log(chalk.dim('\n📝 Your config now uses the framework-based structure.'));
    }
  } catch (error) {
    console.error(chalk.red('Error upgrading config:'), error);
    throw error;
  }
}

