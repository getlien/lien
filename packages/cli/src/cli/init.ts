import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { showCompactBanner } from '../utils/banner.js';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface InitOptions {
  upgrade?: boolean;
  yes?: boolean;
  path?: string;
}

export async function initCommand(options: InitOptions = {}) {
  showCompactBanner();
  
  console.log(chalk.bold('\nLien Initialization\n'));
  console.log(chalk.green('✓ No per-project configuration needed!'));
  console.log(chalk.dim('\nLien now uses:'));
  console.log(chalk.dim('  • Auto-detected frameworks'));
  console.log(chalk.dim('  • Sensible defaults for all settings'));
  console.log(chalk.dim('  • Global config (optional) at ~/.lien/config.json'));
  
  console.log(chalk.bold('\nNext steps:'));
  console.log(chalk.dim('  1. Run'), chalk.bold('lien index'), chalk.dim('to index your codebase'));
  console.log(chalk.dim('  2. Run'), chalk.bold('lien serve'), chalk.dim('to start the MCP server'));
  
  console.log(chalk.bold('\nGlobal Configuration (optional):'));
  console.log(chalk.dim('  To use Qdrant backend, create ~/.lien/config.json:'));
  console.log(chalk.dim('  {'));
  console.log(chalk.dim('    "backend": "qdrant",'));
  console.log(chalk.dim('    "qdrant": {'));
  console.log(chalk.dim('      "url": "http://localhost:6333",'));
  console.log(chalk.dim('      "apiKey": "optional-api-key"'));
  console.log(chalk.dim('    }'));
  console.log(chalk.dim('  }'));
  console.log(chalk.dim('\n  Or use environment variables:'));
  console.log(chalk.dim('    LIEN_BACKEND=qdrant'));
  console.log(chalk.dim('    LIEN_QDRANT_URL=http://localhost:6333'));
  console.log(chalk.dim('    LIEN_QDRANT_API_KEY=your-key'));
  
  // Check if old config exists and warn
  const rootDir = options.path || process.cwd();
  const configPath = path.join(rootDir, '.lien.config.json');
  try {
    await fs.access(configPath);
    console.log(chalk.yellow('\n⚠️  Note: .lien.config.json found but no longer used'));
    console.log(chalk.dim('  You can safely delete it.'));
  } catch {
    // Config doesn't exist - that's fine
  }
  
  // Optional Cursor rules installation
  await promptAndInstallCursorRules(rootDir, options);
}

/** Path type returned by getPathType */
type PathType = 'directory' | 'file' | 'other' | 'none';

/**
 * Check if path is a directory, file, other type, or doesn't exist.
 * Note: Symlinks are followed (fs.stat behavior), so a symlink pointing
 * to a file returns 'file', and a symlink to a directory returns 'directory'.
 * Returns:
 * - 'directory' if path is a directory (or symlink to directory)
 * - 'file' if path is a regular file (or symlink to file)
 * - 'other' if path exists but is not a file or directory (e.g., socket, block device)
 * - 'none' if path does not exist
 */
async function getPathType(filepath: string): Promise<PathType> {
  try {
    const stats = await fs.stat(filepath);
    if (stats.isDirectory()) return 'directory';
    if (stats.isFile()) return 'file';
    // Path exists but is not a regular file or directory (socket, block device, etc.)
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
    
    // Clean up any stale backup from a previous failed run
    try {
      await fs.unlink(backupPath);
    } catch {
      // Backup doesn't exist, proceed normally
    }
    
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
      // Rename failed - attempt to restore from backup
      try {
        await fs.rename(backupPath, rulesPath);
      } catch (restoreErr) {
        console.log(chalk.red('❌ Failed to restore original .cursor/rules from backup after failed conversion.'));
        console.log(chalk.red(`   - Original error: ${renameErr instanceof Error ? renameErr.message : renameErr}`));
        console.log(chalk.red(`   - Restore error: ${restoreErr instanceof Error ? restoreErr.message : restoreErr}`));
        console.log(chalk.red(`   - Backup file location: ${backupPath}`));
        throw new Error('Failed to convert .cursor/rules to directory and failed to restore from backup. Manual recovery needed.');
      }
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
  const targetPath = path.join(rulesPath, 'lien.mdc');
  
  // Check if lien.mdc already exists to avoid overwriting user customizations
  try {
    await fs.access(targetPath);
    console.log(chalk.dim('lien.mdc already exists in .cursor/rules/, skipping...'));
    return;
  } catch {
    // File doesn't exist, proceed with copy
  }
  
  await fs.copyFile(templatePath, targetPath);
  console.log(chalk.green('✓ Installed Cursor rules as .cursor/rules/lien.mdc'));
}

/**
 * Handle case when .cursor/rules is an existing file.
 * Design: --yes auto-accepts prompts that ADD things (fresh install), but does NOT
 * auto-modify existing user files. This is intentionally different from fresh setup
 * to avoid unexpected changes to user's existing rules in CI/automated contexts.
 */
async function handleExistingRulesFile(rulesPath: string, templatePath: string, options: InitOptions) {
  // In non-interactive mode, preserve existing file (don't auto-modify user files)
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

/**
 * Handle case when .cursor/rules exists but is neither a regular file nor directory.
 * Note: Symlinks are followed by fs.stat and classified based on their target,
 * so this only applies to special file types like sockets, block devices, etc.
 */
async function handleInvalidRulesPath(): Promise<void> {
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

  const handlers: Record<PathType, () => Promise<void> | void> = {
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
  
  try {
    await installCursorRulesFiles(rootDir, options);
  } catch (error) {
    console.log(chalk.yellow('⚠️  Could not install Cursor rules'));
    console.log(chalk.dim(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
    console.log(chalk.dim('You can manually copy CURSOR_RULES_TEMPLATE.md to .cursor/rules/lien.mdc'));
  }
}

