#!/usr/bin/env node
// Downloads and vendors tree-sitter-kotlin 0.3.8 from crates.io, then patches
// only its `tree-sitter` core version constraint so it resolves alongside
// the other 10 grammar crates against tree-sitter 0.25.x.
//
// Why vendored at all: upstream pins `tree-sitter = ">= 0.21, < 0.23"`, which
// conflicts with the 0.25 core the other crates require, via Cargo's
// `links = "tree-sitter"` single-version rule. The Phase 0 audit
// (docs/architecture/decisions/0013-prebuilt-native-parser-napi-rs.md)
// runtime-verified the compiled grammar works unmodified against 0.25 --
// the ABI is a runtime-checked integer, not a compile-time struct layout --
// so widening the constraint is safe.
//
// Not committed to git (23MB, mostly the generated src/parser.c) -- this
// script re-derives it deterministically, gated on a pinned sha256 so a
// mutated or compromised crates.io object never reaches `cargo build`.
//
// Idempotent: exits early if vendor/ already has the patch applied.

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  cpSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..');
const VENDOR_DIR = join(PACKAGE_ROOT, 'vendor', 'tree-sitter-kotlin-0.3.8-patched');

const CRATE_URL =
  'https://static.crates.io/crates/tree-sitter-kotlin/tree-sitter-kotlin-0.3.8.crate';

// Pinned via `curl -sL <CRATE_URL> | shasum -a 256` against the tarball as
// published on crates.io (verified 2026-07-08). Any mismatch aborts before
// extraction.
const CRATE_SHA256 = '54ff60aeb036f5762515ceb31404512ea4f9599764bcd3857074bb82867bdd34';

// The one line this script is allowed to change.
const UPSTREAM_CONSTRAINT = 'version = ">= 0.21, < 0.23"';
const PATCHED_CONSTRAINT = 'version = ">= 0.21"';

function isAlreadyVendored() {
  const cargoToml = join(VENDOR_DIR, 'Cargo.toml');
  if (!existsSync(cargoToml)) return false;
  const contents = readFileSync(cargoToml, 'utf8');
  return contents.includes(PATCHED_CONSTRAINT) && !contents.includes(UPSTREAM_CONSTRAINT);
}

async function downloadCrate() {
  const res = await fetch(CRATE_URL);
  if (!res.ok) {
    throw new Error(`failed to download ${CRATE_URL}: ${res.status} ${res.statusText}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const actualSha256 = createHash('sha256').update(buffer).digest('hex');
  if (actualSha256 !== CRATE_SHA256) {
    throw new Error(
      `sha256 mismatch for tree-sitter-kotlin-0.3.8.crate: expected ${CRATE_SHA256}, got ${actualSha256}. ` +
        'Refusing to extract a tarball that does not match the pinned hash.',
    );
  }
  return buffer;
}

function extractCrate(buffer, destDir) {
  mkdirSync(destDir, { recursive: true });
  const tarPath = join(destDir, 'tree-sitter-kotlin-0.3.8.crate');
  writeFileSync(tarPath, buffer);
  // The .crate file is a gzipped tarball. Delegate to system `tar` rather
  // than hand-rolling a tar reader -- present on every dev/CI platform we
  // target (macOS, Linux, and Windows via Git Bash / WSL / bsdtar since
  // Windows 10 1803).
  const result = spawnSync('tar', ['xzf', tarPath, '-C', destDir], { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`tar extraction failed (exit code ${result.status})`);
  }
  rmSync(tarPath);
}

function patchCargoToml(dir) {
  const cargoToml = join(dir, 'Cargo.toml');
  const contents = readFileSync(cargoToml, 'utf8');
  if (!contents.includes(UPSTREAM_CONSTRAINT)) {
    throw new Error(
      `expected to find ${JSON.stringify(UPSTREAM_CONSTRAINT)} in ${cargoToml} -- ` +
        'upstream crate layout may have changed; re-verify the patch by hand.',
    );
  }
  writeFileSync(cargoToml, contents.replace(UPSTREAM_CONSTRAINT, PATCHED_CONSTRAINT));
}

async function main() {
  if (isAlreadyVendored()) {
    console.log(`[fetch-vendor] ${VENDOR_DIR} already vendored and patched -- skipping.`);
    return;
  }

  rmSync(VENDOR_DIR, { recursive: true, force: true });

  console.log('[fetch-vendor] downloading tree-sitter-kotlin 0.3.8 from crates.io...');
  const buffer = await downloadCrate();

  const tmpDir = mkdtempSync(join(tmpdir(), 'tree-sitter-kotlin-'));
  try {
    extractCrate(buffer, tmpDir);
    const extracted = join(tmpDir, 'tree-sitter-kotlin-0.3.8');
    if (!existsSync(extracted)) {
      throw new Error(`expected extracted directory ${extracted} not found`);
    }
    patchCargoToml(extracted);
    mkdirSync(dirname(VENDOR_DIR), { recursive: true });
    // cpSync + rm instead of rename: tmpdir() and the package dir can be on
    // different filesystems/mounts (e.g. tmpfs /tmp vs. a project volume),
    // where a plain rename would throw EXDEV.
    cpSync(extracted, VENDOR_DIR, { recursive: true });
    console.log(`[fetch-vendor] vendored + patched to ${VENDOR_DIR}`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error('[fetch-vendor] failed:', err.message);
  process.exit(1);
});
