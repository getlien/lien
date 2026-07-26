import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createGitignoreFilter } from './gitignore.js';

const execFileAsync = promisify(execFile);

/** Initialize a git repo with a fixed identity, for tracked-file rescue tests. */
async function initGitRepo(dir: string): Promise<void> {
  await execFileAsync('git', ['init', '-q'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: dir });
}

/** Stage and commit everything currently on disk. */
async function gitCommitAll(dir: string, message = 'initial commit'): Promise<void> {
  await execFileAsync('git', ['add', '-A'], { cwd: dir });
  await execFileAsync('git', ['commit', '-q', '-m', message], { cwd: dir });
}

describe('createGitignoreFilter', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-gitignore-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should filter paths matching .gitignore patterns', async () => {
    await fs.writeFile(path.join(testDir, '.gitignore'), '.wip/\ndist/\n');

    const isIgnored = await createGitignoreFilter(testDir);

    expect(isIgnored('.wip/report.md')).toBe(true);
    expect(isIgnored('.wip/notes.txt')).toBe(true);
    expect(isIgnored('dist/index.js')).toBe(true);
    expect(isIgnored('src/index.ts')).toBe(false);
    expect(isIgnored('README.md')).toBe(false);
  });

  it('should handle glob patterns in .gitignore', async () => {
    await fs.writeFile(path.join(testDir, '.gitignore'), '*.log\nbuild/**\n');

    const isIgnored = await createGitignoreFilter(testDir);

    expect(isIgnored('error.log')).toBe(true);
    expect(isIgnored('logs/debug.log')).toBe(true);
    expect(isIgnored('build/output.js')).toBe(true);
    expect(isIgnored('src/app.ts')).toBe(false);
  });

  it('should only apply built-in patterns when no .gitignore exists', async () => {
    const isIgnored = await createGitignoreFilter(testDir);

    // User-defined patterns are not applied
    expect(isIgnored('.wip/report.md')).toBe(false);
    expect(isIgnored('src/index.ts')).toBe(false);

    // Built-in patterns still apply
    expect(isIgnored('node_modules/foo/index.js')).toBe(true);
    expect(isIgnored('.lien/indices/abc')).toBe(true);
    expect(isIgnored('dist/index.js')).toBe(true);
    expect(isIgnored('build/main.js')).toBe(true);
  });

  it('should handle comments and blank lines in .gitignore', async () => {
    await fs.writeFile(
      path.join(testDir, '.gitignore'),
      '# Build output\ndist/\n\n# Temp files\n*.tmp\n',
    );

    const isIgnored = await createGitignoreFilter(testDir);

    expect(isIgnored('dist/bundle.js')).toBe(true);
    expect(isIgnored('cache.tmp')).toBe(true);
    expect(isIgnored('src/index.ts')).toBe(false);
  });

  it('should always ignore node_modules, vendor, .git, .lien, dist, build, and minified assets', async () => {
    const isIgnored = await createGitignoreFilter(testDir);

    expect(isIgnored('node_modules/express/index.js')).toBe(true);
    expect(isIgnored('src/node_modules/lib/foo.js')).toBe(true);
    expect(isIgnored('vendor/autoload.php')).toBe(true);
    expect(isIgnored('.git/HEAD')).toBe(true);
    expect(isIgnored('.lien/indices/abc123')).toBe(true);
    expect(isIgnored('dist/bundle.js')).toBe(true);
    expect(isIgnored('build/output.js')).toBe(true);
    expect(isIgnored('lib/app.min.js')).toBe(true);
    expect(isIgnored('styles/main.min.css')).toBe(true);
  });

  it('should always ignore Claude Code agent worktrees (.claude/worktrees)', async () => {
    const isIgnored = await createGitignoreFilter(testDir);

    // Direct child of the project root — the exact incident shape (full
    // nested repo clone with source files under packages/*/src)
    expect(isIgnored('.claude/worktrees/agent-x/packages/cli/src/foo.ts')).toBe(true);
    expect(isIgnored('.claude/worktrees/agent-x/package.json')).toBe(true);
    // Nested under a subdirectory (monorepo-in-monorepo scenario)
    expect(isIgnored('packages/app/.claude/worktrees/agent-y/src/index.ts')).toBe(true);
    // Sibling .claude paths that are NOT worktrees are unaffected — only
    // the worktrees subdirectory (full repo clones) is excluded
    expect(isIgnored('.claude/settings.json')).toBe(false);
    expect(isIgnored('.claude/agents/reviewer.md')).toBe(false);
  });

  it('should not allow .gitignore negations to override built-in patterns', async () => {
    await fs.writeFile(
      path.join(testDir, '.gitignore'),
      '!node_modules/\n!.lien/\n!vendor/\n!.git/\n!.claude/\n',
    );

    const isIgnored = await createGitignoreFilter(testDir);

    expect(isIgnored('node_modules/express/index.js')).toBe(true);
    expect(isIgnored('.lien/indices/abc123')).toBe(true);
    expect(isIgnored('vendor/autoload.php')).toBe(true);
    expect(isIgnored('.git/HEAD')).toBe(true);
    expect(isIgnored('.claude/worktrees/agent-x/src/index.ts')).toBe(true);
  });

  it('should handle negation patterns', async () => {
    await fs.writeFile(path.join(testDir, '.gitignore'), '*.log\n!important.log\n');

    const isIgnored = await createGitignoreFilter(testDir);

    expect(isIgnored('debug.log')).toBe(true);
    expect(isIgnored('important.log')).toBe(false);
  });

  describe('nested .gitignore support', () => {
    it('should apply nested .gitignore patterns scoped to their directory', async () => {
      // Root has no .gitignore, nested package does
      await fs.mkdir(path.join(testDir, 'packages/app'), { recursive: true });
      await fs.writeFile(path.join(testDir, 'packages/app/.gitignore'), 'generated/\n');

      const isIgnored = await createGitignoreFilter(testDir);

      // Nested pattern applies within packages/app/
      expect(isIgnored('packages/app/generated/types.ts')).toBe(true);
      // Same pattern does NOT apply at root level
      expect(isIgnored('generated/types.ts')).toBe(false);
      // Nor in a different package
      expect(isIgnored('packages/other/generated/types.ts')).toBe(false);
    });

    it('should combine root and nested .gitignore patterns', async () => {
      await fs.writeFile(path.join(testDir, '.gitignore'), '*.log\n');
      await fs.mkdir(path.join(testDir, 'packages/app'), { recursive: true });
      await fs.writeFile(path.join(testDir, 'packages/app/.gitignore'), 'generated/\n');

      const isIgnored = await createGitignoreFilter(testDir);

      // Root pattern applies everywhere
      expect(isIgnored('debug.log')).toBe(true);
      expect(isIgnored('packages/app/error.log')).toBe(true);
      // Nested pattern applies within its scope
      expect(isIgnored('packages/app/generated/foo.ts')).toBe(true);
      // Regular files are not ignored
      expect(isIgnored('packages/app/src/index.ts')).toBe(false);
    });

    it('should handle multiple levels of nesting', async () => {
      await fs.writeFile(path.join(testDir, '.gitignore'), '*.log\n');
      await fs.mkdir(path.join(testDir, 'packages/app/src'), { recursive: true });
      await fs.writeFile(path.join(testDir, 'packages/.gitignore'), 'tmp/\n');
      await fs.writeFile(path.join(testDir, 'packages/app/.gitignore'), 'generated/\n');

      const isIgnored = await createGitignoreFilter(testDir);

      // Root: *.log
      expect(isIgnored('error.log')).toBe(true);
      // packages/: tmp/ (matches tmp/ at any depth within packages/ scope, per git semantics)
      expect(isIgnored('packages/tmp/cache.txt')).toBe(true);
      expect(isIgnored('packages/app/tmp/cache.txt')).toBe(true);
      // But tmp/ does NOT apply outside packages/ scope
      expect(isIgnored('tmp/cache.txt')).toBe(false);
      // packages/app/: generated/
      expect(isIgnored('packages/app/generated/types.ts')).toBe(true);
      // Unaffected paths
      expect(isIgnored('packages/app/src/index.ts')).toBe(false);
    });

    it('should not scan inside ALWAYS_IGNORE directories during discovery', async () => {
      // Even if node_modules has a .gitignore, it should not be discovered
      await fs.mkdir(path.join(testDir, 'node_modules/pkg'), { recursive: true });
      await fs.writeFile(path.join(testDir, 'node_modules/.gitignore'), '!*\n');
      await fs.mkdir(path.join(testDir, 'src'), { recursive: true });

      const isIgnored = await createGitignoreFilter(testDir);

      // node_modules is still ignored (ALWAYS_IGNORE takes precedence)
      expect(isIgnored('node_modules/pkg/index.js')).toBe(true);
      // src files are not ignored
      expect(isIgnored('src/index.ts')).toBe(false);
    });

    it('should work with no .gitignore files at all (backwards compat)', async () => {
      await fs.mkdir(path.join(testDir, 'src'), { recursive: true });

      const isIgnored = await createGitignoreFilter(testDir);

      // Built-in patterns still apply
      expect(isIgnored('node_modules/foo/index.js')).toBe(true);
      expect(isIgnored('.git/HEAD')).toBe(true);
      // Regular files are not ignored
      expect(isIgnored('src/index.ts')).toBe(false);
    });

    it('should work with only root .gitignore (backwards compat)', async () => {
      await fs.writeFile(path.join(testDir, '.gitignore'), '.wip/\n*.tmp\n');
      await fs.mkdir(path.join(testDir, 'src'), { recursive: true });

      const isIgnored = await createGitignoreFilter(testDir);

      expect(isIgnored('.wip/report.md')).toBe(true);
      expect(isIgnored('cache.tmp')).toBe(true);
      expect(isIgnored('src/index.ts')).toBe(false);
    });
  });

  // Regression tests for #899/#900: the watcher path (createGitignoreFilter)
  // must apply the same git-tracked-file exemption as the full scan
  // (scanCodebase), or a file present after `lien index -f` could
  // mysteriously disappear once the watcher reindexes it incrementally.
  describe('git-tracked-file rescue (#899, #900)', () => {
    it('rescues a tracked file at depth inside a directory literally named "build" (#899)', async () => {
      await fs.mkdir(path.join(testDir, 'internal', 'build'), { recursive: true });
      await fs.writeFile(
        path.join(testDir, 'internal', 'build', 'build.go'),
        'package build\n\nvar Version = "dev"\n',
      );

      await initGitRepo(testDir);
      await gitCommitAll(testDir);

      const isIgnored = await createGitignoreFilter(testDir);

      expect(isIgnored('internal/build/build.go')).toBe(false);
      // Sibling ALWAYS_IGNORE_PATTERNS behavior is unaffected
      expect(isIgnored('dist/bundle.js')).toBe(true);
    });

    it('rescues tracked files shadowed by a bare-name .gitignore pattern (#900)', async () => {
      await fs.mkdir(path.join(testDir, 'cmd', 'gh'), { recursive: true });
      await fs.writeFile(path.join(testDir, 'cmd', 'gh', 'main.go'), 'package main\n');
      await fs.mkdir(path.join(testDir, 'internal', 'gh'), { recursive: true });
      await fs.writeFile(path.join(testDir, 'internal', 'gh', 'gh.go'), 'package gh\n');

      await initGitRepo(testDir);
      // Commit BEFORE the .gitignore line exists -- otherwise `git add`
      // would itself refuse to stage these paths, which wouldn't exercise
      // the bug at all. The real-world shape (#900) is a pattern added
      // *after* the files it now shadows were already tracked.
      await gitCommitAll(testDir);
      await fs.writeFile(path.join(testDir, '.gitignore'), 'gh\n');
      await gitCommitAll(testDir, 'add stale gh ignore pattern');

      const isIgnored = await createGitignoreFilter(testDir);

      expect(isIgnored('cmd/gh/main.go')).toBe(false);
      expect(isIgnored('internal/gh/gh.go')).toBe(false);
    });

    it('does not rescue untracked files under a hardcoded-ignored path (tracked-vs-untracked distinction)', async () => {
      await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
      await fs.writeFile(path.join(testDir, 'src', 'real.ts'), 'export const real = true;\n');

      await initGitRepo(testDir);
      await gitCommitAll(testDir);

      // Never added to git -- genuinely untracked generated output.
      const isIgnored = await createGitignoreFilter(testDir);

      expect(isIgnored('build/output.js')).toBe(true);
      expect(isIgnored('src/real.ts')).toBe(false);
    });

    it('does not rescue untracked files shadowed by a bare-name .gitignore pattern', async () => {
      await fs.writeFile(path.join(testDir, '.gitignore'), 'gh\n');
      await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
      await fs.writeFile(path.join(testDir, 'src', 'real.ts'), 'export const real = true;\n');

      await initGitRepo(testDir);
      await gitCommitAll(testDir);

      // Never added to git -- a genuine local artifact the pattern targets.
      const isIgnored = await createGitignoreFilter(testDir);

      expect(isIgnored('cmd/gh/main.go')).toBe(true);
      expect(isIgnored('src/real.ts')).toBe(false);
    });

    it('never rescues node_modules even if git tracks it (hard non-negotiable carve-out)', async () => {
      await fs.mkdir(path.join(testDir, 'node_modules', 'leftpad'), { recursive: true });
      await fs.writeFile(
        path.join(testDir, 'node_modules', 'leftpad', 'index.js'),
        'module.exports = () => {};\n',
      );

      await initGitRepo(testDir);
      await gitCommitAll(testDir);

      const isIgnored = await createGitignoreFilter(testDir);

      expect(isIgnored('node_modules/leftpad/index.js')).toBe(true);
    });
  });
});
