import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { detectFileType, detectLanguage, scanCodebase } from './scanner.js';

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

describe('detectFileType', () => {
  it('should export detectLanguage as a backwards-compat alias', () => {
    expect(detectLanguage).toBe(detectFileType);
  });

  it('should detect TypeScript files', () => {
    expect(detectFileType('test.ts')).toBe('typescript');
    expect(detectFileType('Component.tsx')).toBe('typescript');
    expect(detectFileType('/path/to/file.ts')).toBe('typescript');
  });

  it('should detect JavaScript files', () => {
    expect(detectFileType('test.js')).toBe('javascript');
    expect(detectFileType('Component.jsx')).toBe('javascript');
    expect(detectFileType('index.mjs')).toBe('javascript');
    expect(detectFileType('config.cjs')).toBe('javascript');
  });

  it('should detect Python files', () => {
    expect(detectFileType('script.py')).toBe('python');
    expect(detectFileType('__init__.py')).toBe('python');
  });

  it('should detect Rust files', () => {
    expect(detectFileType('main.rs')).toBe('rust');
    expect(detectFileType('lib.rs')).toBe('rust');
  });

  it('should detect Go files', () => {
    expect(detectFileType('main.go')).toBe('go');
    expect(detectFileType('server.go')).toBe('go');
  });

  it('should detect Java files', () => {
    expect(detectFileType('Main.java')).toBe('java');
    expect(detectFileType('Application.java')).toBe('java');
  });

  it('should detect C files', () => {
    expect(detectFileType('main.c')).toBe('c');
    expect(detectFileType('utils.c')).toBe('c');
    expect(detectFileType('header.h')).toBe('c'); // .h defaults to C
  });

  it('should detect C++ files', () => {
    expect(detectFileType('main.cpp')).toBe('cpp');
    expect(detectFileType('utils.cc')).toBe('cpp');
    expect(detectFileType('header.hpp')).toBe('cpp');
    expect(detectFileType('header.cxx')).toBe('cpp');
  });

  it('should detect PHP files', () => {
    expect(detectFileType('index.php')).toBe('php');
    expect(detectFileType('Router.php')).toBe('php');
  });

  it('should detect Vue files', () => {
    expect(detectFileType('App.vue')).toBe('vue');
    expect(detectFileType('UserList.vue')).toBe('vue');
  });

  it('should detect Ruby files', () => {
    expect(detectFileType('app.rb')).toBe('ruby');
    expect(detectFileType('script.rb')).toBe('ruby');
  });

  it('should detect Swift files', () => {
    expect(detectFileType('Main.swift')).toBe('swift');
    expect(detectFileType('ViewController.swift')).toBe('swift');
  });

  it('should detect Kotlin files', () => {
    expect(detectFileType('Main.kt')).toBe('kotlin');
    expect(detectFileType('Activity.kt')).toBe('kotlin');
  });

  it('should detect C# files', () => {
    expect(detectFileType('Program.cs')).toBe('csharp');
    expect(detectFileType('Controller.cs')).toBe('csharp');
  });

  it('should detect Scala files', () => {
    expect(detectFileType('Main.scala')).toBe('scala');
    expect(detectFileType('App.scala')).toBe('scala');
  });

  it('should detect Liquid files', () => {
    expect(detectFileType('product.liquid')).toBe('liquid');
    expect(detectFileType('theme.liquid')).toBe('liquid');
    expect(detectFileType('header.liquid')).toBe('liquid');
  });

  it('should return unknown for unrecognized extensions', () => {
    expect(detectFileType('file.txt')).toBe('unknown');
    expect(detectFileType('image.png')).toBe('unknown');
    expect(detectFileType('data.json')).toBe('unknown');
  });

  it('should handle files without extensions', () => {
    expect(detectFileType('Makefile')).toBe('unknown');
    expect(detectFileType('README')).toBe('unknown');
  });

  it('should handle paths with multiple dots', () => {
    expect(detectFileType('file.test.ts')).toBe('typescript');
    expect(detectFileType('component.spec.js')).toBe('javascript');
  });

  it('should be case-insensitive', () => {
    expect(detectFileType('File.TS')).toBe('typescript');
    expect(detectFileType('Script.PY')).toBe('python');
    expect(detectFileType('Main.JAVA')).toBe('java');
  });

  it('should handle relative and absolute paths', () => {
    expect(detectFileType('../src/index.ts')).toBe('typescript');
    expect(detectFileType('/usr/local/bin/script.py')).toBe('python');
    expect(detectFileType('./components/Button.tsx')).toBe('typescript');
  });
});

describe('scanCodebase', () => {
  let testDir: string;

  afterEach(async () => {
    if (!testDir) return;
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // Regression test for the .claude/worktrees exclusion (ALWAYS_IGNORE_PATTERNS
  // in gitignore.ts). That exclusion is matched against path.relative(rootDir, file),
  // so it must only fire when .claude/worktrees is BELOW the scan root — never when
  // a worktree itself IS the scan root. Guards against a future over-broad rewrite
  // (e.g. absolute-path matching, or a wider '**/.claude/**' pattern) silently making
  // Lien unable to index a repo checked out under .claude/worktrees/.
  it('excludes a nested .claude/worktrees checkout when scanning the parent, but fully indexes it when scanned as its own root', async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-scanner-worktrees-'));

    const worktreeDir = path.join(testDir, '.claude', 'worktrees', 'agent-x');

    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(testDir, 'src', 'real.ts'), 'export const real = true;\n');

    await fs.mkdir(path.join(worktreeDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(worktreeDir, 'src', 'foo.ts'), 'export const foo = true;\n');
    await fs.writeFile(path.join(worktreeDir, 'package.json'), '{"name":"agent-x"}\n');

    // 1. Scanning the parent repo excludes the nested worktree entirely.
    const parentFiles = await scanCodebase({ rootDir: testDir });
    const parentRelative = parentFiles.map(f => path.relative(testDir, f));

    expect(parentRelative).toContain(path.join('src', 'real.ts'));
    expect(parentRelative).not.toContain(
      path.join('.claude', 'worktrees', 'agent-x', 'src', 'foo.ts'),
    );
    expect(parentRelative.some(f => f.includes('.claude'))).toBe(false);

    // 2. Scanning the worktree AS ITS OWN ROOT is unaffected by the exclusion —
    // relative paths from this root never contain '.claude/worktrees', so the
    // pattern does not fire and the worktree is fully indexed.
    const worktreeFiles = await scanCodebase({ rootDir: worktreeDir });
    const worktreeRelative = worktreeFiles.map(f => path.relative(worktreeDir, f));

    expect(worktreeRelative).toContain(path.join('src', 'foo.ts'));
  });

  // Regression lock for the dot-directory glob gap: glob's default `dot:false`
  // means a bare `**/*.yml` never descends into `.github/`, so the default
  // (no includePatterns) fallback must carry an explicit `.github/**` entry
  // for CI workflow YAML to be scanned at all.
  it('includes .github/workflows/*.yml under the default (no includePatterns) fallback', async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-scanner-github-yaml-'));

    await fs.mkdir(path.join(testDir, '.github', 'workflows'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, '.github', 'workflows', 'ci.yml'),
      'name: CI\non: push\n',
    );

    const files = await scanCodebase({ rootDir: testDir });
    const relative = files.map(f => path.relative(testDir, f));

    expect(relative).toContain(path.join('.github', 'workflows', 'ci.yml'));
  });
});

// Regression tests for #899 (hardcoded `build/**` swallows a real, tracked
// `build`-named source directory) and #900 (a stale bare-name `.gitignore`
// pattern shadows a real, tracked source subtree). Fix: in a git repository,
// union the lexical scan with `git ls-files` so tracked files are always
// indexable -- see `rescueTrackedFiles` / `getGitTrackedFiles`.
describe('scanCodebase — git-tracked-file rescue (#899, #900)', () => {
  let testDir: string;

  afterEach(async () => {
    if (!testDir) return;
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('rescues a tracked file at depth inside a directory literally named "build" (#899)', async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-scanner-tracked-build-'));

    await fs.mkdir(path.join(testDir, 'internal', 'build'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'internal', 'build', 'build.go'),
      'package build\n\nvar Version = "dev"\n',
    );
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(testDir, 'src', 'real.ts'), 'export const real = true;\n');

    await initGitRepo(testDir);
    await gitCommitAll(testDir);

    const files = await scanCodebase({ rootDir: testDir });
    const relative = files.map(f => path.relative(testDir, f).replace(/\\/g, '/'));

    expect(relative).toContain('internal/build/build.go');
    expect(relative).toContain('src/real.ts');
  });

  it('rescues tracked files shadowed by a bare-name .gitignore pattern (#900)', async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-scanner-tracked-bare-gh-'));

    await fs.mkdir(path.join(testDir, 'cmd', 'gh'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'cmd', 'gh', 'main.go'),
      'package main\n\nfunc main() {}\n',
    );
    await fs.mkdir(path.join(testDir, 'internal', 'gh'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'internal', 'gh', 'gh.go'),
      'package gh\n\ntype Config interface{}\n',
    );

    await initGitRepo(testDir);
    // Commit BEFORE the .gitignore line exists -- otherwise `git add` would
    // itself refuse to stage these paths, which wouldn't exercise the bug at
    // all. The real-world shape (#900) is a bare, slash-free pattern (which
    // legitimately matches a path component named "gh" at any depth, per
    // git semantics) added *after* the files it now shadows were tracked.
    await gitCommitAll(testDir);
    await fs.writeFile(path.join(testDir, '.gitignore'), 'gh\n');
    await gitCommitAll(testDir, 'add stale gh ignore pattern');

    const files = await scanCodebase({ rootDir: testDir });
    const relative = files.map(f => path.relative(testDir, f).replace(/\\/g, '/'));

    expect(relative).toContain('cmd/gh/main.go');
    expect(relative).toContain('internal/gh/gh.go');
  });

  it('does not rescue untracked files under a hardcoded-ignored path (tracked-vs-untracked distinction)', async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-scanner-untracked-build-'));

    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(testDir, 'src', 'real.ts'), 'export const real = true;\n');

    await initGitRepo(testDir);
    await gitCommitAll(testDir);

    // Created AFTER the commit -- genuinely untracked generated output,
    // exactly the case ALWAYS_IGNORE_PATTERNS' build/** exists to exclude.
    await fs.mkdir(path.join(testDir, 'build'), { recursive: true });
    await fs.writeFile(path.join(testDir, 'build', 'output.js'), 'console.log("generated");\n');

    const files = await scanCodebase({ rootDir: testDir });
    const relative = files.map(f => path.relative(testDir, f).replace(/\\/g, '/'));

    expect(relative).toContain('src/real.ts');
    expect(relative).not.toContain('build/output.js');
  });

  it('does not rescue untracked files shadowed by a bare-name .gitignore pattern', async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-scanner-untracked-bare-gh-'));

    await fs.writeFile(path.join(testDir, '.gitignore'), 'gh\n');
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(testDir, 'src', 'real.ts'), 'export const real = true;\n');

    await initGitRepo(testDir);
    await gitCommitAll(testDir);

    // Created AFTER the commit -- a genuine local build artifact the
    // .gitignore line is meant to hide, never added to git.
    await fs.mkdir(path.join(testDir, 'cmd', 'gh'), { recursive: true });
    await fs.writeFile(path.join(testDir, 'cmd', 'gh', 'main.go'), 'package main\n');

    const files = await scanCodebase({ rootDir: testDir });
    const relative = files.map(f => path.relative(testDir, f).replace(/\\/g, '/'));

    expect(relative).toContain('src/real.ts');
    expect(relative).not.toContain('cmd/gh/main.go');
  });

  it('never rescues node_modules even if git tracks it (hard non-negotiable carve-out)', async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-scanner-tracked-node-modules-'));

    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(testDir, 'src', 'real.ts'), 'export const real = true;\n');

    // A misconfigured repo that committed its dependency tree -- git is
    // perfectly capable of tracking this; Lien must never index it anyway.
    await fs.mkdir(path.join(testDir, 'node_modules', 'leftpad'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'node_modules', 'leftpad', 'index.js'),
      'module.exports = () => {};\n',
    );

    await initGitRepo(testDir);
    await gitCommitAll(testDir);

    const files = await scanCodebase({ rootDir: testDir });
    const relative = files.map(f => path.relative(testDir, f).replace(/\\/g, '/'));

    expect(relative).toContain('src/real.ts');
    expect(relative).not.toContain('node_modules/leftpad/index.js');
  });

  it('keeps pure lexical behavior for non-git directories (build/** stays excluded)', async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-scanner-nongit-build-'));

    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(testDir, 'src', 'real.ts'), 'export const real = true;\n');
    await fs.mkdir(path.join(testDir, 'build'), { recursive: true });
    await fs.writeFile(path.join(testDir, 'build', 'output.js'), 'console.log("generated");\n');

    // No git init -- this directory is not a git repo at all.
    const files = await scanCodebase({ rootDir: testDir });
    const relative = files.map(f => path.relative(testDir, f).replace(/\\/g, '/'));

    expect(relative).toContain('src/real.ts');
    expect(relative).not.toContain('build/output.js');
  });
});
