import { Command, Option } from 'commander';
import { DEFAULT_STALE_DAYS } from '@liendev/core';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { statusCommand } from './status.js';
import { indexCommand } from './index-cmd.js';
import { serveCommand } from './serve.js';
import { complexityCommand } from './complexity.js';
import { healthCommand } from './health-cmd.js';
import { reviewCommand } from './review-cmd.js';
import { deltaCommand } from './delta-cmd.js';
import { apiDeltaCommand } from './api-delta-cmd.js';
import { statsCommand } from './stats-cmd.js';
import { configSetCommand, configGetCommand, configListCommand } from './config.js';
import { pathCommand } from './path-cmd.js';
import { annotateCli } from './annotate-cmd.js';
import { gcCommand } from './gc.js';
import { noteEditCommand, noteRunCommand, reportCommand } from './verify-tests-cmd.js';
import { recapCommand } from './recap-cmd.js';

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
  .command('index')
  .description('Index the codebase for lexical (FTS5) search and dependency analysis')
  .option('-f, --force', 'Force full reindex (skip incremental)')
  .option('-v, --verbose', 'Show detailed logging during indexing')
  .option(
    '--allow-unsafe-root',
    'Allow indexing your home directory or a filesystem root (dangerous, see #1025)',
  )
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

program
  .command('api-delta')
  .description(
    'Flag exported-symbol signature changes/removals in the working tree (vs HEAD) — advisory, not a gate',
  )
  .option('--format <type>', 'Output format: text, json', 'text')
  .option('--file <path>', 'Analyze only this file vs HEAD (fast path for a single-file check)')
  .option(
    '--base <ref>',
    'Compare the working tree against this ref instead of HEAD (e.g. origin/main in CI)',
  )
  .action(apiDeltaCommand);

program
  .command('stats')
  .description(
    'Local nudge-loop metrics: lien delta runs, crossings, and functions resolved after being flagged',
  )
  .option('--format <type>', 'Output format: text, json', 'text')
  .action(statsCommand);

program
  .command('recap')
  .description(
    'Session risk-ledger recap: re-raise UNRESOLVED risk from this session (unrun tests, live complexity crossings, unacted get_dependents warnings) as one advisory',
  )
  .option('--session <id>', 'Session ID to recap')
  .option('--format <type>', 'Output format: text, json', 'text')
  .option(
    '--hooks-dir <path>',
    "Calling script's own directory, for the test-verify shown event's build stamp",
  )
  .action(recapCommand);

const configCmd = program
  .command('config')
  .description(
    'Manage global configuration (~/.lien/config.json — currently just the storage backend). ' +
      'Per-project config (./.lien.config.json) only supports complexity.thresholds and is not ' +
      'managed by this command — edit the file directly.',
  );

configCmd
  .command('set <key> <value>')
  // Every key in ALLOWED_KEYS (config.ts) is global-only today — the former
  // project-scoped key (embeddings.enabled) was retired with embeddings, and
  // this command has no other way to reach ./.lien.config.json (see the
  // parent `config` command's description above). Don't reintroduce
  // "project" language here without also adding a project-scoped key to
  // ALLOWED_KEYS.
  .description("Set a global config value (see 'lien config list' for valid keys)")
  .action(configSetCommand);

configCmd.command('get <key>').description('Get a config value').action(configGetCommand);

configCmd.command('list').description('Show all current config').action(configListCommand);

program
  .command('path')
  .description('Print Lien storage paths and supported extensions')
  .option('--store', 'Print the storage root for the current repo')
  .option('--extensions', 'Print the indexed-file extensions, one per line')
  .option('--root', 'Print the resolved project root (walks up for .git)')
  .action(pathCommand);

program
  .command('annotate <file>')
  .description('Print a short impact summary for a single file')
  .option('--tests-only', 'Print only the post-edit test-association reminder line')
  .option(
    '--min-risk <level>',
    'Habituation-guard risk floor: only annotate when blast-radius risk is >= this ' +
      'level (low|medium|high|critical), unless there is a complexity/headroom concern. ' +
      'Default: no floor (low).',
  )
  .action(annotateCli);

const verifyTestsCmd = program
  .command('verify-tests')
  .description(
    'Session-scoped did-you-run-the-tests ledger — record edits/test-runs and report unverified files',
  );

// Session/file/command are plain (not required) options: every subcommand is
// its own fail-open no-op when one is missing (see verify-tests-cmd.ts), so a
// hard commander usage error here would contradict this feature's fail-open
// contract. The fail-open shape exists because this was hook-driven plumbing;
// the hooks that drove it are gone, so nothing calls these but a human.
verifyTestsCmd
  .command('note-edit')
  .description('Record that a file was edited and print its test-association reminder')
  .option('--session <id>', 'Session ID to record under')
  .option('--file <path>', 'File that was edited')
  .option('--format <type>', 'Output format: text, json', 'text')
  .action(noteEditCommand);

verifyTestsCmd
  .command('note-run')
  .description('Record a Bash command as a test run, if it looks like one (silent)')
  .option('--session <id>', 'Session ID to record under')
  .option('--command <cmd>', 'The Bash command that was run')
  .action(noteRunCommand);

verifyTestsCmd
  .command('report')
  .description(
    'Report edited files whose associated tests were never observed running this session',
  )
  .option('--session <id>', 'Session ID to report on')
  .option('--format <type>', 'Output format: text, json', 'text')
  .action(reportCommand);

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
