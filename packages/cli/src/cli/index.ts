import { Command } from 'commander';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { complexityCommand } from './complexity.js';
import { healthCommand } from './health-cmd.js';
import { reviewCommand } from './review-cmd.js';
import { deltaCommand } from './delta-cmd.js';

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
  .command('complexity')
  .description('Analyze code complexity')
  .option('--files <paths...>', 'Specific files to analyze')
  .option('--format <type>', 'Output format: text, json, sarif', 'text')
  .option('--fail-on <severity>', 'Exit 1 if violations: error, warning')
  .action(complexityCommand);

program
  .command('health')
  .description(
    'Rank the functions that are risky to change: complexity × fan-in ÷ test coverage (advisory — never fails on findings)',
  )
  .option('--format <type>', 'Output format: text, json', 'text')
  .option('--top <n>', 'How many functions to show', '5')
  .option('--path <prefix>', 'Only show functions under this path prefix')
  .option('--include-tests', 'Rank test files too (excluded by default)')
  .action(healthCommand);

program
  .command('review')
  .description(
    'Run the deterministic signals over your changes: stale duplicate literals, unswept variants, removed exports, doc drift and more (advisory — never fails, no --fail-on)',
  )
  .option('--base <ref>', 'Compare the working tree against this ref instead of HEAD')
  .option('--format <type>', 'Output format: text, json', 'text')
  .option(
    '--no-repo-scan',
    'Skip the whole-repo scan the cross-file signals need (faster, blinder)',
  )
  .option('--include-tests', 'Review changed test files too (excluded by default)')
  .option(
    '--all-signals',
    'Run all 14 signals, not just the measured-useful default set (noisy: see the note it prints)',
  )
  .action(reviewCommand);

program
  .command('delta')
  .description(
    'Flag NEW complexity threshold crossings in the working tree (vs HEAD) before commit',
  )
  .option('--format <type>', 'Output format: text, json', 'text')
  .option('--threshold <n>', 'Override cyclomatic + cognitive thresholds (default: from config)')
  .option('--soft', 'Advisory mode: always exit 0 (still prints the report)')
  .option('--file <path>', 'Analyze only this file vs HEAD (fast path for a single-file check)')
  .option(
    '--base <ref>',
    'Compare the working tree against this ref instead of HEAD (e.g. origin/main in CI)',
  )
  .action(deltaCommand);

program.action(() => {
  program.help();
});

program.addHelpText('beforeAll', `Quick start: run 'lien health' in your project directory\n`);
