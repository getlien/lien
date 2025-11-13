import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { defaultConfig, LienConfig, FrameworkInstance } from '../config/schema.js';
import { deepMergeConfig, detectNewFields } from '../config/merge.js';
import { showCompactBanner } from '../utils/banner.js';
import { needsMigration, migrateConfig } from '../config/migration.js';
import { detectAllFrameworks } from '../frameworks/detector-service.js';
import { getFrameworkDetector } from '../frameworks/registry.js';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface InitOptions {
  upgrade?: boolean;
  yes?: boolean;
  path?: string;
}

export async function initCommand(options: InitOptions = {}) {
  const rootDir = options.path || process.cwd();
  const configPath = path.join(rootDir, '.lien.config.json');
  
  try {
    // Check if config already exists
    let configExists = false;
    try {
      await fs.access(configPath);
      configExists = true;
    } catch {
      // File doesn't exist
    }
    
    // Handle upgrade scenario
    if (configExists && options.upgrade) {
      await upgradeConfig(configPath);
      return;
    }
    
    // Warn if config exists and not upgrading
    if (configExists && !options.upgrade) {
      console.log(chalk.yellow('⚠️  .lien.config.json already exists'));
      console.log(chalk.dim('Run'), chalk.bold('lien init --upgrade'), chalk.dim('to merge new config options'));
      return;
    }
    
    // Create new config with framework detection
    if (!configExists) {
      await createNewConfig(rootDir, options);
    }
  } catch (error) {
    console.error(chalk.red('Error creating config file:'), error);
    process.exit(1);
  }
}

async function createNewConfig(rootDir: string, options: InitOptions) {
  // Show banner for new initialization
  showCompactBanner();
  console.log(chalk.bold('Initializing Lien...\n'));
  
  // 1. Run framework detection
  console.log(chalk.dim('🔍 Detecting frameworks in'), chalk.bold(rootDir));
  const detections = await detectAllFrameworks(rootDir);
  
  let frameworks: FrameworkInstance[] = [];
  
  if (detections.length === 0) {
    console.log(chalk.yellow('\n⚠️  No frameworks detected'));
    
    if (!options.yes) {
      const { useGeneric } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'useGeneric',
          message: 'Create a generic config (index all supported file types)?',
          default: true,
        },
      ]);
      
      if (!useGeneric) {
        console.log(chalk.dim('Aborted.'));
        return;
      }
    }
    
    // Create generic framework
    frameworks.push({
      name: 'generic',
      path: '.',
      enabled: true,
      config: {
        include: ['**/*.{ts,tsx,js,jsx,py,go,rs,java,c,cpp,cs}'],
        exclude: [
          '**/node_modules/**',
          '**/dist/**',
          '**/build/**',
          '**/.git/**',
          '**/coverage/**',
          '**/.next/**',
          '**/.nuxt/**',
          '**/vendor/**',
        ],
        testPatterns: {
          directories: ['**/__tests__/**', '**/tests/**', '**/test/**'],
          extensions: ['.test.', '.spec.'],
          prefixes: ['test_', 'test-'],
          suffixes: ['_test', '-test', '.test', '.spec'],
          frameworks: [],
        },
      },
    });
  } else {
    // 2. Display detected frameworks
    console.log(chalk.green(`\n✓ Found ${detections.length} framework(s):\n`));
    
    for (const det of detections) {
      const pathDisplay = det.path === '.' ? 'root' : det.path;
      console.log(chalk.bold(`  ${det.name}`), chalk.dim(`(${det.confidence} confidence)`));
      console.log(chalk.dim(`    Location: ${pathDisplay}`));
      
      if (det.evidence.length > 0) {
        det.evidence.forEach((e) => {
          console.log(chalk.dim(`    • ${e}`));
        });
      }
      console.log();
    }
    
    // 3. Interactive confirmation
    if (!options.yes) {
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'Configure these frameworks?',
          default: true,
        },
      ]);
      
      if (!confirm) {
        console.log(chalk.dim('Aborted.'));
        return;
      }
    }
    
    // 4. Generate configs for each detected framework
    for (const det of detections) {
      const detector = getFrameworkDetector(det.name);
      if (!detector) {
        console.warn(chalk.yellow(`⚠️  No detector found for ${det.name}, skipping`));
        continue;
      }
      
      // Generate default config
      const frameworkConfig = await detector.generateConfig(rootDir, det.path);
      
      // Optional: Ask to customize (only in interactive mode)
      let shouldCustomize = false;
      if (!options.yes) {
        const { customize } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'customize',
            message: `Customize ${det.name} settings?`,
            default: false,
          },
        ]);
        shouldCustomize = customize;
      }
      
      let finalConfig = frameworkConfig;
      if (shouldCustomize) {
        finalConfig = await promptForCustomization(det.name, frameworkConfig);
      } else {
        const pathDisplay = det.path === '.' ? 'root' : det.path;
        console.log(chalk.dim(`  → Using defaults for ${det.name} at ${pathDisplay}`));
      }
      
      frameworks.push({
        name: det.name,
        path: det.path,
        enabled: true,
        config: finalConfig,
      });
    }
  }
  
  // 5. Ask about Cursor rules installation
  if (!options.yes) {
    const { installCursorRules } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'installCursorRules',
        message: 'Install recommended Cursor rules?',
        default: true,
      },
    ]);
    
    if (installCursorRules) {
      try {
        const cursorRulesDir = path.join(rootDir, '.cursor');
        await fs.mkdir(cursorRulesDir, { recursive: true });
        
        // Find template - it's in the package root (same dir as package.json)
        // When compiled: everything bundles to dist/index.js, so __dirname is dist/
        // Go up one level from dist/ to reach package root
        const templatePath = path.join(__dirname, '../CURSOR_RULES_TEMPLATE.md');
        
        const rulesPath = path.join(cursorRulesDir, 'rules');
        let targetPath: string;
        let isDirectory = false;
        let isFile = false;

        try {
          const stats = await fs.stat(rulesPath);
          isDirectory = stats.isDirectory();
          isFile = stats.isFile();
        } catch {
          // Doesn't exist, that's fine
        }

        if (isDirectory) {
          // .cursor/rules is already a directory, create lien.mdc inside it
          targetPath = path.join(rulesPath, 'lien.mdc');
          await fs.copyFile(templatePath, targetPath);
          console.log(chalk.green('✓ Installed Cursor rules as .cursor/rules/lien.mdc'));
        } else if (isFile) {
          // .cursor/rules exists as a file - ask to convert to directory structure
          const { convertToDir } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'convertToDir',
              message: 'Existing .cursor/rules file found. Convert to directory and preserve your rules?',
              default: true,
            },
          ]);

          if (convertToDir) {
            // Convert file to directory structure
            // 1. Read existing rules
            const existingRules = await fs.readFile(rulesPath, 'utf-8');
            // 2. Delete the file
            await fs.unlink(rulesPath);
            // 3. Create rules as a directory
            await fs.mkdir(rulesPath);
            // 4. Save original rules as custom.md
            await fs.writeFile(path.join(rulesPath, 'custom.md'), existingRules);
            // 5. Add Lien rules as lien.mdc
            await fs.copyFile(templatePath, path.join(rulesPath, 'lien.mdc'));
            console.log(chalk.green('✓ Converted .cursor/rules to directory'));
            console.log(chalk.green('  - Your original rules: .cursor/rules/custom.md'));
            console.log(chalk.green('  - Lien rules: .cursor/rules/lien.mdc'));
          } else {
            console.log(chalk.dim('Skipped Cursor rules installation (preserving existing file)'));
          }
        } else {
          // .cursor/rules doesn't exist, create it as a file
          targetPath = rulesPath;
          await fs.copyFile(templatePath, targetPath);
          console.log(chalk.green('✓ Installed Cursor rules as .cursor/rules'));
        }
      } catch (error) {
        console.log(chalk.yellow('⚠️  Could not install Cursor rules'));
        console.log(chalk.dim(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
        console.log(chalk.dim('You can manually copy CURSOR_RULES_TEMPLATE.md to .cursor/rules'));
      }
    }
  }
  
  // 6. Build final config
  const config: LienConfig = {
    ...defaultConfig,
    frameworks,
  };
  
  // 7. Write config
  const configPath = path.join(rootDir, '.lien.config.json');
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  
  // 8. Show success message
  console.log(chalk.green('\n✓ Created .lien.config.json'));
  console.log(chalk.green(`✓ Configured ${frameworks.length} framework(s)`));
  console.log(chalk.dim('\nNext steps:'));
  console.log(chalk.dim('  1. Run'), chalk.bold('lien index'), chalk.dim('to index your codebase'));
  console.log(chalk.dim('  2. Run'), chalk.bold('lien serve'), chalk.dim('to start the MCP server'));
  console.log(chalk.dim('  3. Configure Cursor to use the MCP server (see README.md)'));
}

async function promptForCustomization(frameworkName: string, config: any): Promise<any> {
  console.log(chalk.bold(`\nCustomizing ${frameworkName} settings:`));
  
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'include',
      message: 'File patterns to include (comma-separated):',
      default: config.include.join(', '),
      filter: (input: string) => input.split(',').map(s => s.trim()),
    },
    {
      type: 'input',
      name: 'exclude',
      message: 'File patterns to exclude (comma-separated):',
      default: config.exclude.join(', '),
      filter: (input: string) => input.split(',').map(s => s.trim()),
    },
    {
      type: 'confirm',
      name: 'indexTests',
      message: 'Index test files?',
      default: config.testPatterns.directories.length === 0,
    },
  ]);
  
  return {
    include: answers.include,
    exclude: answers.exclude,
    testPatterns: answers.indexTests
      ? {
          directories: [],
          extensions: [],
          prefixes: [],
          suffixes: [],
          frameworks: [],
        }
      : config.testPatterns,
  };
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
