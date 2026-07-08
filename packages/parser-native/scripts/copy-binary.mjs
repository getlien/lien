#!/usr/bin/env node
// Copies the cargo-built cdylib to ./parser-native.node, the fixed name the
// JS loader (index.js) looks for as its local-dev fallback binary, and the
// name build-native.yml's CI matrix uploads as each platform's artifact.
// Per-OS cdylib naming: cargo prefixes with "lib" and picks the platform's
// native shared-library extension everywhere except Windows.
//
// CARGO_BUILD_TARGET (optional): set by build-native.yml when it builds via
// "cargo build --release --target TRIPLE", which puts the output under
// target/TRIPLE/release/ instead of target/release/. Local dev builds
// (npm run build:native, no --target) leave this unset and keep reading
// from target/release/ as before.

import { existsSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..');

const targetTriple = process.env.CARGO_BUILD_TARGET || null;
const RELEASE_DIR = targetTriple
  ? join(PACKAGE_ROOT, 'target', targetTriple, 'release')
  : join(PACKAGE_ROOT, 'target', 'release');

function cdylibName() {
  switch (process.platform) {
    case 'darwin':
      return 'libparser_native.dylib';
    case 'linux':
      return 'libparser_native.so';
    case 'win32':
      return 'parser_native.dll';
    default:
      throw new Error('@liendev/parser-native: unsupported build platform "' + process.platform + '"');
  }
}

const source = join(RELEASE_DIR, cdylibName());
if (!existsSync(source)) {
  const cargoCmd = targetTriple ? ('cargo build --release --target ' + targetTriple) : 'cargo build --release';
  throw new Error('@liendev/parser-native: expected build output at ' + source + ' -- did "' + cargoCmd + '" succeed?');
}

const dest = join(PACKAGE_ROOT, 'parser-native.node');
copyFileSync(source, dest);
console.log('[copy-binary] ' + source + ' -> ' + dest);
