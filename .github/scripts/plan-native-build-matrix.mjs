#!/usr/bin/env node
// Computes the build-native.yml matrix from
// packages/parser-native/scripts/platforms.json so the workflow never
// hand-transcribes platform/target/npmPackage strings -- that manifest's own
// "description" field explicitly asks that nothing "hand-roll a second copy
// of this list anywhere".
//
// Runner selection: uses platforms.json's own "githubRunner" field verbatim
// for every platform. (Until this reconciliation, "linux-x64-gnu" and
// "linux-arm64-gnu" were overridden here to "ubuntu-latest"/"ubuntu-24.04-arm"
// because the manifest disagreed -- pinned "ubuntu-22.04"/"ubuntu-22.04-arm"
// -- with what this script actually ran. The manifest is now updated to match
// reality instead, the same way ADR-013's C# LANGUAGE_C_SHARP table entry was
// fixed in place rather than silently special-cased elsewhere.)
//
// Usage (from repo root, in CI): node .github/scripts/plan-native-build-matrix.mjs
// Env: PLATFORMS_INPUT = "required" (default) | "all" | comma-separated platform ids
//      GITHUB_OUTPUT    = path to append "matrix=<json>" to (set by Actions)

import { readFileSync, appendFileSync } from 'node:fs';

const MANIFEST_PATH = 'packages/parser-native/scripts/platforms.json';
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const platforms = manifest.platforms;

// Tier-1: every release must ship these. Kept in sync by hand with
// packages/parser-native/scripts/publish-platform-packages.mjs's
// REQUIRED_PLATFORMS constant -- both lists are short (5 entries) and a
// mismatch fails loudly (a missing artifact aborts the publish script)
// rather than silently, so the duplication is a low-risk one.
const REQUIRED_PLATFORMS = [
  'darwin-arm64',
  'darwin-x64',
  'linux-x64-gnu',
  'linux-arm64-gnu',
  'win32-x64-msvc',
];

// Best-effort: attempted when requested, but a failure must not fail the
// overall workflow (build-native.yml sets continue-on-error for these).
// Building for musl needs a musl C toolchain (musl-gcc, via the
// "musl-tools" apt package) alongside the Rust musl target, which is
// untested in CI as of this writing -- hence best-effort, not required. See
// platforms.json's own "notes" field on these two entries for the same
// caveat.
const BEST_EFFORT_PLATFORMS = ['linux-x64-musl', 'linux-arm64-musl'];

function resolveWantedIds() {
  const requested = (process.env.PLATFORMS_INPUT || 'required').trim();
  if (requested === 'required') return REQUIRED_PLATFORMS;
  if (requested === 'all') return REQUIRED_PLATFORMS.concat(BEST_EFFORT_PLATFORMS);
  return requested
    .split(',')
    .map(function (s) {
      return s.trim();
    })
    .filter(Boolean);
}

function buildMatrixEntry(id) {
  const platform = platforms.filter(function (p) {
    return p.platform === id;
  })[0];
  if (!platform) {
    throw new Error(
      'plan-native-build-matrix: unknown platform id "' +
        id +
        '" (not present in ' +
        MANIFEST_PATH +
        ')',
    );
  }
  return {
    platform: platform.platform,
    target: platform.target,
    npmPackage: platform.npmPackage,
    runner: platform.githubRunner,
    libc: platform.libc,
    bestEffort: BEST_EFFORT_PLATFORMS.indexOf(platform.platform) !== -1,
  };
}

const matrix = resolveWantedIds().map(buildMatrixEntry);

const outputLine = 'matrix=' + JSON.stringify(matrix) + '\n';
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, outputLine);
} else {
  process.stdout.write(outputLine);
}
