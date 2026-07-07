#!/usr/bin/env node
/**
 * Zero-dependency docs-truth linter.
 *
 * Scans git-tracked markdown files (and .cursor/rules/*.mdc) for guidance
 * that has silently drifted from reality:
 *
 *   1. Relative markdown links `[text](path)` that no longer resolve to a
 *      real file.
 *   2. Prose "ADR-XXXX" references with no matching file in
 *      docs/architecture/decisions/.
 *   3. `npm run <script>` mentions that don't resolve to a real script,
 *      either in the root package.json or in the referenced workspace's.
 *
 * Prints one `file:line: message` per violation, then a summary count.
 * Exits 1 if anything was found, 0 otherwise.
 *
 * No npm dependencies -- node:fs, node:path, node:child_process only.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();

// Paths that intentionally contain broken examples or staged test fixtures,
// not real guidance -- not worth holding to the same standard.
const EXCLUDED_PATH_PATTERNS = [
  /^lien-review-testbed\//,
  /^packages\/[^/]+\/test\/(?:.*\/)?fixtures?\//,
];

function isExcluded(relPath) {
  return EXCLUDED_PATH_PATTERNS.some(re => re.test(relPath));
}

function listTrackedDocs() {
  const out = execFileSync('git', ['ls-files', '--', '*.md', '.cursor/rules/*.mdc'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(relPath => !isExcluded(relPath));
}

const violations = [];
function report(relPath, lineNo, message) {
  violations.push(`${relPath}:${lineNo}: ${message}`);
}

// --- Check 1: relative links resolve to a real file -------------------------

const LINK_RE = /\[[^\]]*]\(([^)]+)\)/g;
const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

function checkLinks(relPath, absPath, lines) {
  lines.forEach((line, idx) => {
    for (const match of line.matchAll(LINK_RE)) {
      const rawTarget = match[1].trim();
      let target = rawTarget.split(/\s+/)[0]; // drop an optional "title" suffix
      target = target.split('#')[0]; // drop the in-page anchor
      if (!target) continue; // was a pure `#anchor` link
      if (URL_SCHEME_RE.test(target)) continue; // http(s):, mailto:, etc.
      if (target.startsWith('/')) continue; // root-relative/absolute path, not a repo file
      const resolved = path.resolve(path.dirname(absPath), target);
      if (!fs.existsSync(resolved)) {
        report(
          relPath,
          idx + 1,
          `broken link '${rawTarget}' -> ${path.relative(REPO_ROOT, resolved)}`,
        );
      }
    }
  });
}

// --- Check 2: ADR-XXXX references have a matching decision file -------------

const ADR_REF_RE = /ADR-0*(\d{1,4})/g;
const ADR_DIR = path.join(REPO_ROOT, 'docs/architecture/decisions');
const adrFiles = fs.existsSync(ADR_DIR)
  ? fs.readdirSync(ADR_DIR).filter(f => f.endsWith('.md'))
  : [];

function hasAdrFile(digits) {
  const code = digits.padStart(4, '0');
  return adrFiles.some(f => f.startsWith(`${code}-`));
}

function checkAdrRefs(relPath, lines) {
  lines.forEach((line, idx) => {
    for (const match of line.matchAll(ADR_REF_RE)) {
      if (!hasAdrFile(match[1])) {
        report(
          relPath,
          idx + 1,
          `ADR reference 'ADR-${match[1]}' has no matching file in docs/architecture/decisions/`,
        );
      }
    }
  });
}

// --- Check 3: `npm run <script>` mentions resolve ----------------------------

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

const rootScripts = readJson(path.join(REPO_ROOT, 'package.json')).scripts ?? {};

// Index each workspace's scripts under both forms docs use to reference it:
// `-w @liendev/core` (package name) and `-w packages/core` (path).
const workspaceScripts = new Map();
const packagesDir = path.join(REPO_ROOT, 'packages');
if (fs.existsSync(packagesDir)) {
  for (const dir of fs.readdirSync(packagesDir)) {
    const pkgJsonPath = path.join(packagesDir, dir, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) continue;
    const pkg = readJson(pkgJsonPath);
    const scripts = pkg.scripts ?? {};
    workspaceScripts.set(`packages/${dir}`, scripts);
    if (pkg.name) workspaceScripts.set(pkg.name, scripts);
  }
}

// The script-name group only extends across a `:` when it's followed by
// another segment (so "npm run typecheck: ✓" in a checklist doesn't get
// misread as a script literally named "typecheck:").
const NPM_RUN_RE = /npm run ([\w.-]+(?::[\w.-]+)*)(?:\s+-w[= ]([^\s`"')]+))?/g;
const PLACEHOLDER_RE = /[<>$*]/;

function workspaceViolation(scriptName, workspace) {
  const scripts = workspaceScripts.get(workspace);
  if (!scripts) return `'npm run ${scriptName} -w ${workspace}' references an unknown workspace`;
  if (scriptName in scripts) return null;
  return `'npm run ${scriptName}' has no matching script in workspace '${workspace}'`;
}

// Without -w, a doc inside packages/<pkg>/ assumes that package's cwd —
// resolve against the containing package's scripts first, then root.
function bareViolation(scriptName, relPath) {
  const pkgDir = relPath.match(/^packages\/([^/]+)\//)?.[1];
  const containing = pkgDir ? workspaceScripts.get(`packages/${pkgDir}`) : undefined;
  if (containing && scriptName in containing) return null;
  if (scriptName in rootScripts) return null;
  const where = containing
    ? `the root package.json or workspace 'packages/${pkgDir}'`
    : 'the root package.json';
  return `'npm run ${scriptName}' has no matching script in ${where}`;
}

function checkNpmRunRefs(relPath, lines) {
  lines.forEach((line, idx) => {
    for (const match of line.matchAll(NPM_RUN_RE)) {
      // Placeholders (angle brackets, `$VAR`, globs) can appear anywhere
      // after the mention on the same line -- treat the whole tail as one
      // example, not a literal, runnable command.
      if (PLACEHOLDER_RE.test(line.slice(match.index))) continue;

      const [, scriptName, workspace] = match;
      const violation = workspace
        ? workspaceViolation(scriptName, workspace)
        : bareViolation(scriptName, relPath);
      if (violation) report(relPath, idx + 1, violation);
    }
  });
}

// --- Run all checks -----------------------------------------------------------

for (const relPath of listTrackedDocs()) {
  const absPath = path.join(REPO_ROOT, relPath);
  const lines = fs.readFileSync(absPath, 'utf8').split('\n');

  checkLinks(relPath, absPath, lines);
  checkAdrRefs(relPath, lines);
  checkNpmRunRefs(relPath, lines);
}

if (violations.length > 0) {
  violations.forEach(line => console.log(line));
  console.log(
    `\n${violations.length} docs-truth violation${violations.length === 1 ? '' : 's'} found.`,
  );
  process.exit(1);
}

console.log(`docs-truth: ${listTrackedDocs().length} files checked, no violations.`);
process.exit(0);
