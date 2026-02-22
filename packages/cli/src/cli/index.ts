import { Command, Option } from 'commander';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initCommand } from './init.js';
import { statusCommand } from './status.js';
import { indexCommand } from './index-cmd.js';
import { serveCommand } from './serve.js';
import { complexityCommand } from './complexity.js';
import { reviewCommand } from './review.js';
import { configSetCommand, configGetCommand, configListCommand } from './config.js';

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
  .description('Local semantic code search for AI assistants via MCP')
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
  .action(initCommand);

program
  .command('index')
  .description('Index the codebase for semantic search')
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
  .command('review')
  .description('Run pluggable code review on changed files')
  .option('--files <paths...>', 'Specific files to analyze (skips git diff)')
  .option('--format <type>', 'Output format: text, json, sarif', 'text')
  .option('--fail-on <severity>', 'Exit 1 if findings match: error, warning')
  .option('--no-llm', 'Skip plugins that require LLM')
  .option('--model <name>', 'LLM model to use (overrides config)')
  .option('-v, --verbose', 'Show detailed logging')
  .option('--plugin <name>', 'Run only a specific plugin')
  .action(reviewCommand);

const configCmd = program
  .command('config')
  .description('Manage global configuration (~/.lien/config.json)');

configCmd
  .command('set <key> <value>')
  .description('Set a global config value')
  .action(configSetCommand);

configCmd.command('get <key>').description('Get a config value').action(configGetCommand);

configCmd.command('list').description('Show all current config').action(configListCommand);

program.action(() => {
  program.help();
});

program.addHelpText('beforeAll', `Quick start: run 'lien serve' in your project directory\n`);
