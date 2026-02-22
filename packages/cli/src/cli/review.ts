import { execFile } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import { performChunkOnlyIndex, analyzeComplexityFromChunks } from '@liendev/parser';
import {
  type ReviewContext,
  ReviewEngine,
  loadConfig,
  loadPlugins,
  resolveLLMApiKey,
  getPluginConfig,
  OpenRouterLLMClient,
  TerminalAdapter,
  SARIFAdapter,
  filterAnalyzableFiles,
  consoleLogger,
  type Logger,
} from '@liendev/review';

const execFileAsync = promisify(execFile);

interface ReviewOptions {
  files?: string[];
  format: 'text' | 'json' | 'sarif';
  failOn?: 'error' | 'warning';
  noLlm?: boolean;
  model?: string;
  verbose?: boolean;
  plugin?: string;
}

const VALID_FAIL_ON = ['error', 'warning'];
const VALID_FORMATS = ['text', 'json', 'sarif'];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateOptions(options: ReviewOptions, rootDir: string): void {
  if (options.failOn && !VALID_FAIL_ON.includes(options.failOn)) {
    console.error(
      chalk.red(
        `Error: Invalid --fail-on value "${options.failOn}". Must be either 'error' or 'warning'`,
      ),
    );
    process.exit(1);
  }

  if (!VALID_FORMATS.includes(options.format)) {
    console.error(
      chalk.red(
        `Error: Invalid --format value "${options.format}". Must be one of: text, json, sarif`,
      ),
    );
    process.exit(1);
  }

  if (options.files) {
    const missing = options.files.filter(file => {
      const fullPath = path.isAbsolute(file) ? file : path.join(rootDir, file);
      return !fs.existsSync(fullPath);
    });
    if (missing.length > 0) {
      console.error(chalk.red(`Error: File${missing.length > 1 ? 's' : ''} not found:`));
      missing.forEach(file => console.error(chalk.red(`  - ${file}`)));
      process.exit(1);
    }
  }
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

async function getDefaultBranch(rootDir: string): Promise<string> {
  // Try common remotes
  for (const remote of ['origin', 'upstream']) {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--verify', `${remote}/main`], {
        cwd: rootDir,
        timeout: 5000,
      });
      if (stdout.trim()) return `${remote}/main`;
    } catch {
      /* try next */
    }

    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--verify', `${remote}/master`], {
        cwd: rootDir,
        timeout: 5000,
      });
      if (stdout.trim()) return `${remote}/master`;
    } catch {
      /* try next */
    }
  }

  // Fall back to HEAD (compare against nothing = all files)
  return 'HEAD';
}

async function getGitChangedFiles(rootDir: string): Promise<string[]> {
  const defaultBranch = await getDefaultBranch(rootDir);

  try {
    // Files changed between default branch and HEAD
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--name-only', `${defaultBranch}...HEAD`],
      { cwd: rootDir, timeout: 10000 },
    );

    const files = stdout.trim().split('\n').filter(Boolean);

    // Also include unstaged/staged changes
    const { stdout: statusOut } = await execFileAsync('git', ['diff', '--name-only', 'HEAD'], {
      cwd: rootDir,
      timeout: 10000,
    });
    const workingFiles = statusOut.trim().split('\n').filter(Boolean);

    // Merge, deduplicate, and filter out deleted files
    const allFiles = new Set([...files, ...workingFiles]);
    return Array.from(allFiles).filter(f => fs.existsSync(path.join(rootDir, f)));
  } catch {
    // If diff fails (e.g., no commits yet), get all tracked files
    try {
      const { stdout } = await execFileAsync('git', ['ls-files'], { cwd: rootDir, timeout: 10000 });
      return stdout.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }
}

async function isGitRepo(rootDir: string): Promise<boolean> {
  try {
    await fs.promises.access(path.join(rootDir, '.git'));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

function createLogger(verbose: boolean): Logger {
  if (verbose) return consoleLogger;
  return {
    info: () => {},
    warning: (msg: string) => console.error(chalk.yellow(`Warning: ${msg}`)),
    error: (msg: string) => console.error(chalk.red(`Error: ${msg}`)),
    debug: () => {},
  };
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

/**
 * `lien review` — run pluggable code review on changed files.
 */
export async function reviewCommand(options: ReviewOptions): Promise<void> {
  const rootDir = process.cwd();

  try {
    validateOptions(options, rootDir);

    const verbose = options.verbose ?? false;
    const logger = createLogger(verbose);
    const spinner = options.format === 'text' ? ora() : null;

    // 1. Determine files to review
    let filesToReview: string[];

    if (options.files) {
      filesToReview = options.files;
    } else {
      // Must be a git repo
      if (!(await isGitRepo(rootDir))) {
        console.error(chalk.red('Error: Not a git repository'));
        console.log(chalk.yellow('Use --files to analyze specific files'));
        process.exit(1);
      }

      spinner?.start('Detecting changed files...');
      const changedFiles = await getGitChangedFiles(rootDir);
      const analyzable = filterAnalyzableFiles(changedFiles);

      if (analyzable.length === 0) {
        spinner?.stop();
        console.log(chalk.yellow('No changed files found. Use --files to analyze specific files.'));
        return;
      }

      filesToReview = analyzable;
      spinner?.succeed(
        `Found ${filesToReview.length} changed file${filesToReview.length === 1 ? '' : 's'}`,
      );
    }

    // 2. Load config
    const config = loadConfig(rootDir);

    // 3. Resolve LLM
    const noLlm = options.noLlm ?? false;
    const apiKey = noLlm ? undefined : resolveLLMApiKey(config);

    if (!apiKey && !noLlm) {
      if (options.format === 'text') {
        console.log(
          chalk.dim(
            'No LLM API key found. Running in --no-llm mode (complexity only).\n' +
              'Set OPENROUTER_API_KEY or configure .lien/review.yml for LLM-enriched reviews.',
          ),
        );
      }
    }

    const model = options.model ?? config.llm.model;
    const llm =
      apiKey && !noLlm
        ? new OpenRouterLLMClient({
            apiKey,
            model,
            logger,
          })
        : undefined;

    if (llm && options.model) {
      console.log(chalk.dim(`Using model: ${model}`));
    }

    // 4. Index files (chunk-only, no VectorDB)
    spinner?.start('Indexing files...');
    const indexResult = await performChunkOnlyIndex(rootDir, { filesToIndex: filesToReview });

    if (!indexResult.success || indexResult.chunks.length === 0) {
      spinner?.fail('Failed to index files');
      if (indexResult.error) logger.error(indexResult.error);
      process.exit(2);
    }
    spinner?.succeed(
      `Indexed ${indexResult.filesIndexed} file${indexResult.filesIndexed === 1 ? '' : 's'} (${indexResult.chunksCreated} chunks)`,
    );

    // 5. Run complexity analysis
    spinner?.start('Analyzing complexity...');
    const complexityReport = analyzeComplexityFromChunks(indexResult.chunks, filesToReview);
    spinner?.succeed(
      `Complexity: ${complexityReport.summary.totalViolations} violation${complexityReport.summary.totalViolations === 1 ? '' : 's'}`,
    );

    // 6. Load plugins and create engine
    spinner?.start('Running review plugins...');
    const plugins = await loadPlugins(config);
    const engine = new ReviewEngine({ verbose });

    for (const plugin of plugins) {
      engine.register(plugin);
    }

    // 7. Build review context
    const reviewContext: ReviewContext = {
      chunks: indexResult.chunks,
      changedFiles: filesToReview,
      complexityReport,
      baselineReport: null,
      deltas: null,
      config: {},
      llm,
      logger,
    };

    // Merge per-plugin config from settings
    for (const plugin of plugins) {
      const pluginConfig = getPluginConfig(config, plugin.id);
      if (Object.keys(pluginConfig).length > 0) {
        reviewContext.config = { ...reviewContext.config, ...pluginConfig };
      }
    }

    // 8. Run engine
    const findings = await engine.run(reviewContext, options.plugin);
    spinner?.succeed(
      `Review complete: ${findings.length} finding${findings.length === 1 ? '' : 's'}`,
    );

    // 9. Present results
    const adapterContext = {
      complexityReport,
      baselineReport: null,
      deltas: null,
      deltaSummary: null,
      logger,
      llmUsage: llm?.getUsage(),
      model: config.llm.model,
    };

    if (options.format === 'sarif') {
      const adapter = new SARIFAdapter();
      await adapter.present(findings, adapterContext);
    } else if (options.format === 'json') {
      console.log(JSON.stringify(findings, null, 2));
    } else {
      const adapter = new TerminalAdapter();
      await adapter.present(findings, adapterContext);
    }

    // 10. Exit code for CI
    if (options.failOn) {
      const hasMatching =
        options.failOn === 'error'
          ? findings.some(f => f.severity === 'error')
          : findings.some(f => f.severity === 'error' || f.severity === 'warning');
      if (hasMatching) process.exit(1);
    }
  } catch (error) {
    console.error(
      chalk.red('Error running review:'),
      error instanceof Error ? error.message : String(error),
    );
    process.exit(2);
  }
}
