import { Command, Option } from 'commander';
import { DEFAULT_STALE_DAYS } from '@liendev/core';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initCommand } from './init.js';
import { statusCommand } from './status.js';
import { indexCommand } from './index-cmd.js';
import { serveCommand } from './serve.js';
import { complexityCommand } from './complexity.js';
import { deltaCommand } from './delta-cmd.js';
import { configSetCommand, configGetCommand, configListCommand } from './config.js';
import { pathCommand } from './path-cmd.js';
import { annotateCommand } from './annotate-cmd.js';
import { gcCommand } from './gc.js';

// Get version from package.json dynamically
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

let packageJson;
try {
  packageJson = require(join(__dirname, '../package.json'));
} catch {
  packageJson = require(join(__dirname, '../../package.json'));
}

export const program = new Command();

program
  .name('lien')
  .description('Local lexical code search and dependency analysis for AI assistants via MCP')
  .version(packageJson.version);

program
  .command('init')
  .description('Initialize Lien in the current directory')
  .addOption(
    new Option('-e, --editor <editor>', 'Editor to configure MCP for').choices([
      'cursor',
      'claude-code',
      'windsurf',
      'opencode',
      'kilo-code',
      'antigravity',
    ]),
  )
  .option('-p, --path <path>', 'Path to initialize (defaults to current directory)')
  .option(
    '--legacy',
    'Use legacy per-project setup for Claude Code instead of recommending the plugin',
  )
  .action(initCommand);

program
  .command('index')
  .description('Index the codebase for lexical (FTS5) search and dependency analysis')
  .option('-f, --force', 'Force full reindex (skip incremental)')
  .option('-v, --verbose', 'Show detailed logging during indexing')
  .action(indexCommand);

program
  .command('serve')
  .description(
    'Start the MCP server (works with Cursor, Claude Code, Windsurf, and any MCP client)',
  )
  .option('-p, --port <port>', 'Port number (for future use)', '7133')
  .option('--no-watch', 'Disable file watching for this session')
  .addOption(
    new Option('-w, --watch', '[DEPRECATED] File watching is now enabled by default').hideHelp(),
  )
  .option('-r, --root <path>', 'Root directory to serve (defaults to current directory)')
  .action(serveCommand);

program
  .command('status')
  .description('Show indexing status and statistics')
  .option('-v, --verbose', 'Show detailed settings')
  .option('--format <type>', 'Output format: text, json', 'text')
  .action(statusCommand);

program
  .command('complexity')
  .description('Analyze code complexity')
  .option('--files <paths...>', 'Specific files to analyze')
  .option('--format <type>', 'Output format: text, json, sarif', 'text')
  .option('--fail-on <severity>', 'Exit 1 if violations: error, warning')
  .action(complexityCommand);

program
  .command('delta')
  .description(
    'Flag NEW complexity threshold crossings in the working tree (vs HEAD) before commit',
  )
  .option('--format <type>', 'Output format: text, json', 'text')
  .option('--threshold <n>', 'Override cyclomatic + cognitive thresholds (default: from config)')
  .option('--soft', 'Advisory mode: always exit 0 (still prints the report)')
  .option('--file <path>', 'Analyze only this file vs HEAD (fast path for edit hooks)')
  .option(
    '--base <ref>',
    'Compare the working tree against this ref instead of HEAD (e.g. origin/main in CI)',
  )
  .action(deltaCommand);

const configCmd = program
  .command('config')
  .description('Manage configuration (global: ~/.lien/config.json, project: ./.lien.config.json)');

configCmd
  .command('set <key> <value>')
  .description('Set a config value (global or project, depending on the key)')
  .action(configSetCommand);

configCmd.command('get <key>').description('Get a config value').action(configGetCommand);

configCmd.command('list').description('Show all current config').action(configListCommand);

program
  .command('path')
  .description('Print Lien storage paths and supported extensions (for hook scripts)')
  .option('--store', 'Print the storage root for the current repo')
  .option('--extensions', 'Print the indexed-file extensions, one per line')
  .option('--root', 'Print the resolved project root (walks up for .git)')
  .action(pathCommand);

program
  .command('annotate <file>')
  .description('Print a short impact summary for a single file (for hook annotation)')
  .action(annotateCommand);

program
  .command('gc')
  .description('Garbage-collect stale/orphaned index directories under ~/.lien/indices')
  .option('--dry-run', 'List candidates with size and reason; delete nothing')
  .option(
    '--stale [days]',
    `Also remove indices not accessed in N days (default ${DEFAULT_STALE_DAYS})`,
  )
  .option('--format <type>', 'Output format: text, json', 'text')
  .option('-v, --verbose', 'Show detailed error output')
  .action(gcCommand);

program.action(() => {
  program.help();
});

program.addHelpText('beforeAll', `Quick start: run 'lien serve' in your project directory\n`);
