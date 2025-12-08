import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { defaultConfig, LienConfig, FrameworkInstance, FrameworkConfig } from '../config/schema.js';
import { showCompactBanner } from '../utils/banner.js';
import { MigrationManager } from '../config/migration-manager.js';
import { detectAllFrameworks } from '../frameworks/detector-service.js';
import { getFrameworkDetector } from '../frameworks/registry.js';
import { DetectionResult } from '../frameworks/types.js';

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
      const migrationManager = new MigrationManager(rootDir);
      await migrationManager.upgradeInteractive();
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

/** Default generic framework config for projects without detected frameworks */
function createGenericFramework(): FrameworkInstance {
  return {
    name: 'generic',
    path: '.',
    enabled: true,
    config: {
      include: ['**/*.{ts,tsx,js,jsx,py,php,go,rs,java,c,cpp,cs}'],
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
    },
  };
}

/** Handle case when no frameworks are detected - returns null if user aborts */
async function handleNoFrameworksDetected(options: InitOptions): Promise<FrameworkInstance[] | null> {
  console.log(chalk.yellow('\n⚠️  No frameworks detected'));
  
  if (!options.yes) {
    const { useGeneric } = await inquirer.prompt([{
      type: 'confirm',
      name: 'useGeneric',
      message: 'Create a generic config (index all supported file types)?',
      default: true,
    }]);
    
    if (!useGeneric) {
      console.log(chalk.dim('Aborted.'));
      return null;
    }
  } else {
    // Log in non-interactive mode so users know what's happening
    console.log(chalk.dim('Creating generic config (no frameworks detected)...'));
  }
  
  return [createGenericFramework()];
}

/** Display detected frameworks to console */
function displayDetectedFrameworks(detections: DetectionResult[]) {
  console.log(chalk.green(`\n✓ Found ${detections.length} framework(s):\n`));
  
  for (const det of detections) {
    const pathDisplay = det.path === '.' ? 'root' : det.path;
    console.log(chalk.bold(`  ${det.name}`), chalk.dim(`(${det.confidence} confidence)`));
    console.log(chalk.dim(`    Location: ${pathDisplay}`));
    
    if (det.evidence.length > 0) {
      det.evidence.forEach((e) => console.log(chalk.dim(`    • ${e}`)));
    }
    console.log();
  }
}

/** Prompt user to confirm framework configuration */
async function confirmFrameworkConfiguration(options: InitOptions): Promise<boolean> {
  if (options.yes) return true;
  
  const { confirm } = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirm',
    message: 'Configure these frameworks?',
    default: true,
  }]);
  
  return confirm;
}

/** Generate config for a single detected framework */
async function generateSingleFrameworkConfig(
  det: { name: string; path: string },
  rootDir: string,
  options: InitOptions
): Promise<FrameworkInstance | null> {
  const detector = getFrameworkDetector(det.name);
  if (!detector) {
    console.warn(chalk.yellow(`⚠️  No detector found for ${det.name}, skipping`));
    return null;
  }
  
  const frameworkConfig = await detector.generateConfig(rootDir, det.path);
  
  // Optional customization in interactive mode
  let finalConfig = frameworkConfig;
  const pathDisplay = det.path === '.' ? 'root' : det.path;
  
  if (!options.yes) {
    const { customize } = await inquirer.prompt([{
      type: 'confirm',
      name: 'customize',
      message: `Customize ${det.name} settings?`,
      default: false,
    }]);
    
    if (customize) {
      const customized = await promptForCustomization(det.name, frameworkConfig);
      finalConfig = { ...frameworkConfig, ...customized };
    } else {
      console.log(chalk.dim(`  → Using defaults for ${det.name} at ${pathDisplay}`));
    }
  } else {
    // Log in non-interactive mode so users know what's happening
    console.log(chalk.dim(`  → Using defaults for ${det.name} at ${pathDisplay}`));
  }
  
  return {
    name: det.name,
    path: det.path,
    enabled: true,
    config: finalConfig,
  };
}

/** Generate configs for all detected frameworks - returns null if user aborts */
async function handleFrameworksDetected(
  detections: DetectionResult[],
  rootDir: string,
  options: InitOptions
): Promise<FrameworkInstance[] | null> {
  displayDetectedFrameworks(detections);
  
  if (!await confirmFrameworkConfiguration(options)) {
    console.log(chalk.dim('Aborted.'));
    return null;
  }
  
  const frameworks: FrameworkInstance[] = [];
  for (const det of detections) {
    const framework = await generateSingleFrameworkConfig(det, rootDir, options);
    if (framework) frameworks.push(framework);
  }
  
  // Handle edge case where all framework configs failed to generate
  if (frameworks.length === 0) {
    console.log(chalk.yellow('\n⚠️  No framework configs could be generated'));
    return null;
  }
  
  return frameworks;
}

/**
 * Check if path is a directory, file, other type, or doesn't exist.
 * Returns:
 * - 'directory' if path is a directory
 * - 'file' if path is a regular file
 * - 'other' if path exists but is not a file or directory (e.g., symlink, socket)
 * - 'none' if path does not exist
 */
async function getPathType(filepath: string): Promise<'directory' | 'file' | 'other' | 'none'> {
  try {
    const stats = await fs.stat(filepath);
    if (stats.isDirectory()) return 'directory';
    if (stats.isFile()) return 'file';
    // Path exists but is not a regular file or directory (symlink, socket, etc.)
    return 'other';
  } catch {
    // Doesn't exist
    return 'none';
  }
}

/** Convert existing rules file to directory structure safely using backup */
async function convertRulesFileToDirectory(rulesPath: string, templatePath: string) {
  const existingRules = await fs.readFile(rulesPath, 'utf-8');
  const parentDir = path.dirname(rulesPath);
  const baseName = path.basename(rulesPath);
  
  // Create temp directory with new content
  const tempDir = await fs.mkdtemp(path.join(parentDir, baseName + '_tmp_'));
  const backupPath = rulesPath + '.backup';
  
  try {
    // Write files to temp directory first
    await fs.writeFile(path.join(tempDir, 'project.mdc'), existingRules);
    await fs.copyFile(templatePath, path.join(tempDir, 'lien.mdc'));
    
    // Rename original to backup (preserves data if rename fails)
    await fs.rename(rulesPath, backupPath);
    
    try {
      // Move temp dir to final location
      await fs.rename(tempDir, rulesPath);
      // Success - remove backup (non-critical, so don't fail if this errors)
      try {
        await fs.unlink(backupPath);
      } catch {
        console.log(chalk.yellow('⚠️  Could not remove backup file, but conversion succeeded'));
        console.log(chalk.dim(`Backup file: ${backupPath}`));
      }
    } catch (renameErr) {
      // Rename failed - restore from backup
      await fs.rename(backupPath, rulesPath);
      throw renameErr;
    }
    
    console.log(chalk.green('✓ Converted .cursor/rules to directory'));
    console.log(chalk.green('  - Your project rules: .cursor/rules/project.mdc'));
    console.log(chalk.green('  - Lien rules: .cursor/rules/lien.mdc'));
  } catch (err) {
    // Clean up temp dir if it still exists
    try { await fs.rm(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    throw err;
  }
}

/** Handle case when .cursor/rules is an existing directory */
async function handleExistingRulesDirectory(rulesPath: string, templatePath: string) {
  await fs.copyFile(templatePath, path.join(rulesPath, 'lien.mdc'));
  console.log(chalk.green('✓ Installed Cursor rules as .cursor/rules/lien.mdc'));
}

/** Handle case when .cursor/rules is an existing file */
async function handleExistingRulesFile(rulesPath: string, templatePath: string, options: InitOptions) {
  // In non-interactive mode, preserve existing file (conservative approach)
  if (options.yes) {
    console.log(chalk.dim('Skipped Cursor rules installation (preserving existing .cursor/rules file)'));
    return;
  }

  // In interactive mode, prompt user for conversion
  const { convertToDir } = await inquirer.prompt([{
    type: 'confirm',
    name: 'convertToDir',
    message: 'Existing .cursor/rules file found. Convert to directory and preserve your rules?',
    default: true,
  }]);

  if (convertToDir) {
    await convertRulesFileToDirectory(rulesPath, templatePath);
  } else {
    console.log(chalk.dim('Skipped Cursor rules installation (preserving existing file)'));
  }
}

/** Handle case when .cursor/rules is not a file or directory (symlink, socket, etc.) */
function handleInvalidRulesPath() {
  console.log(chalk.yellow('⚠️  .cursor/rules exists but is not a regular file or directory'));
  console.log(chalk.dim('Skipped Cursor rules installation'));
}

/** Handle case when .cursor/rules doesn't exist - create fresh */
async function handleFreshRulesInstall(rulesPath: string, templatePath: string) {
  await fs.mkdir(rulesPath, { recursive: true });
  await fs.copyFile(templatePath, path.join(rulesPath, 'lien.mdc'));
  console.log(chalk.green('✓ Installed Cursor rules as .cursor/rules/lien.mdc'));
}

/** Install Cursor rules based on existing .cursor/rules state */
async function installCursorRulesFiles(rootDir: string, options: InitOptions) {
  const cursorRulesDir = path.join(rootDir, '.cursor');
  await fs.mkdir(cursorRulesDir, { recursive: true });
  
  const templatePath = path.join(__dirname, '../CURSOR_RULES_TEMPLATE.md');
  const rulesPath = path.join(cursorRulesDir, 'rules');
  const pathType = await getPathType(rulesPath);

  const handlers: Record<typeof pathType, () => Promise<void> | void> = {
    directory: () => handleExistingRulesDirectory(rulesPath, templatePath),
    file: () => handleExistingRulesFile(rulesPath, templatePath, options),
    other: () => handleInvalidRulesPath(),
    none: () => handleFreshRulesInstall(rulesPath, templatePath),
  };

  await handlers[pathType]();
}

/** Prompt and install Cursor rules if user agrees (auto-install in --yes mode) */
async function promptAndInstallCursorRules(rootDir: string, options: InitOptions) {
  // In --yes mode, install by default (accepting the prompt)
  // In interactive mode, ask user
  const shouldInstall = options.yes || (await inquirer.prompt([{
    type: 'confirm',
    name: 'installCursorRules',
    message: 'Install recommended Cursor rules?',
    default: true,
  }])).installCursorRules;
  
  if (!shouldInstall) return;
  
  if (options.yes) {
    console.log(chalk.dim('Installing Cursor rules (auto-accepted due to --yes)...'));
  }
  
  try {
    await installCursorRulesFiles(rootDir, options);
  } catch (error) {
    console.log(chalk.yellow('⚠️  Could not install Cursor rules'));
    console.log(chalk.dim(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
    console.log(chalk.dim('You can manually copy CURSOR_RULES_TEMPLATE.md to .cursor/rules/lien.mdc'));
  }
}

/** Write config file and show success message */
async function writeConfigAndShowSuccess(rootDir: string, frameworks: FrameworkInstance[]) {
  const config: LienConfig = { ...defaultConfig, frameworks };
  const configPath = path.join(rootDir, '.lien.config.json');
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  
  console.log(chalk.green('\n✓ Created .lien.config.json'));
  console.log(chalk.green(`✓ Configured ${frameworks.length} framework(s)`));
  console.log(chalk.dim('\nNext steps:'));
  console.log(chalk.dim('  1. Run'), chalk.bold('lien index'), chalk.dim('to index your codebase'));
  console.log(chalk.dim('  2. Run'), chalk.bold('lien serve'), chalk.dim('to start the MCP server'));
  console.log(chalk.dim('  3. Configure Cursor to use the MCP server (see README.md)'));
}

/** Create a new Lien configuration for the project */
async function createNewConfig(rootDir: string, options: InitOptions) {
  showCompactBanner();
  console.log(chalk.bold('Initializing Lien...\n'));
  
  // Detect frameworks
  console.log(chalk.dim('🔍 Detecting frameworks in'), chalk.bold(rootDir));
  const detections = await detectAllFrameworks(rootDir);
  
  // Build framework configs based on detection results
  const frameworks = detections.length === 0
    ? await handleNoFrameworksDetected(options)
    : await handleFrameworksDetected(detections, rootDir, options);
  
  if (!frameworks) return; // User aborted
  
  // Optional Cursor rules installation
  await promptAndInstallCursorRules(rootDir, options);
  
  // Write config and show success
  await writeConfigAndShowSuccess(rootDir, frameworks);
}

async function promptForCustomization(frameworkName: string, config: FrameworkConfig): Promise<Partial<FrameworkConfig>> {
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
  ]);
  
  return {
    include: answers.include,
    exclude: answers.exclude,
  };
}

// Removed: upgradeConfig function is now handled by MigrationManager.upgradeInteractive()
