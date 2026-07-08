#!/usr/bin/env node
// Generates and publishes @liendev/parser-native-<platform> npm packages
// from built binary artifacts, then injects the resulting
// optionalDependencies into packages/parser-native/package.json for
// `changeset publish` (invoked right after this script in release.yml) to
// pack and publish.
//
// This is the hand-rolled equivalent of @napi-rs/cli's "napi prepublish" --
// see ADR-013's "no @napi-rs/cli" decision. Zero dependencies: only Node
// built-ins and the `npm` CLI already on PATH.
//
// The injected optionalDependencies are never committed back to git -- this
// script only ever runs against an ephemeral CI checkout, so
// packages/parser-native/package.json stays clean in the repo (see
// README.md's "Platform resolution" section).
//
// Two modes:
//
//   Release mode (default): reads scripts/platforms.json plus a directory of
//   downloaded build-native.yml artifacts (one subdir per platform id, each
//   containing parser-native.node -- the actions/download-artifact@v4
//   default layout), generates one package directory per platform that has
//   an artifact present, `npm publish`es each (skipping any version already
//   live on the registry, so a re-run after a partial failure doesn't try to
//   publish over itself), and injects optionalDependencies into
//   package.json. Aborts without publishing anything if a REQUIRED_PLATFORMS
//   entry has no artifact.
//
//   --pack-only mode: generates and `npm pack`s exactly ONE platform package
//   from an explicit --platform + --binary pair, instead of publishing, and
//   never touches package.json's optionalDependencies. Used by ci.yml's
//   release-smoke-test to exercise the loader's platform-package resolution
//   path against a locally-built binary, without touching the registry.
//
// Usage:
//   node scripts/publish-platform-packages.mjs [--artifacts-dir <dir>] [--out-dir <dir>]
//   node scripts/publish-platform-packages.mjs --pack-only --platform <id> --binary <path> [--out-dir <dir>] [--version <semver>]
//
// Run with cwd = packages/parser-native (both release.yml and ci.yml invoke
// it with `working-directory: packages/parser-native`).

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const PACKAGE_ROOT = process.cwd();
const MANIFEST_PATH = join(PACKAGE_ROOT, 'scripts', 'platforms.json');
const MAIN_PACKAGE_JSON_PATH = join(PACKAGE_ROOT, 'package.json');

// Tier-1: every release must ship these, or the release-mode publish aborts.
// Kept in sync by hand with .github/scripts/plan-native-build-matrix.mjs's
// REQUIRED_PLATFORMS constant -- see that file's header for why a small
// amount of duplication here is an acceptable tradeoff.
const REQUIRED_PLATFORMS = [
  'darwin-arm64',
  'darwin-x64',
  'linux-x64-gnu',
  'linux-arm64-gnu',
  'win32-x64-msvc',
];

// Table-driven flag parsing: each entry says which `args` key a flag sets
// and whether it consumes the next argv element as its value (false for a
// bare boolean switch like --pack-only). Keeps parseArgs a single loop
// instead of a long if/else-if chain.
const FLAG_SPECS = {
  '--pack-only': { key: 'packOnly', takesValue: false },
  '--artifacts-dir': { key: 'artifactsDir', takesValue: true },
  '--out-dir': { key: 'outDir', takesValue: true },
  '--platform': { key: 'platform', takesValue: true },
  '--binary': { key: 'binary', takesValue: true },
  '--version': { key: 'version', takesValue: true },
};

function parseArgs(argv) {
  const args = { artifactsDir: 'artifacts', outDir: 'platform-packages', packOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const spec = FLAG_SPECS[arg];
    if (!spec) {
      throw new Error('publish-platform-packages: unknown argument "' + arg + '"');
    }
    args[spec.key] = spec.takesValue ? argv[++i] : true;
  }
  return args;
}

function readMainVersion() {
  return JSON.parse(readFileSync(MAIN_PACKAGE_JSON_PATH, 'utf8')).version;
}

function loadPlatforms() {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')).platforms;
}

function writePlatformPackage(dir, platform, version) {
  mkdirSync(dir, { recursive: true });

  const pkg = {
    name: platform.npmPackage,
    version: version,
    description: 'Prebuilt ' + platform.platform + ' binary for @liendev/parser-native.',
    os: [platform.nodePlatform],
    cpu: [platform.nodeArch],
    main: 'parser-native.node',
    files: ['parser-native.node'],
    license: 'AGPL-3.0-only',
    repository: {
      type: 'git',
      url: 'git+https://github.com/getlien/lien.git',
      directory: 'packages/parser-native/platform-packages/' + platform.platform,
    },
    homepage: 'https://lien.dev',
    engines: { node: '>=22.21.0' },
    publishConfig: { access: 'public', provenance: true },
  };
  if (platform.libc) {
    pkg.libc = [platform.libc];
  }

  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  writeFileSync(
    join(dir, 'README.md'),
    '# ' +
      platform.npmPackage +
      '\n\nPrebuilt ' +
      platform.platform +
      " binary for [@liendev/parser-native](https://www.npmjs.com/package/@liendev/parser-native). Not meant to be installed directly -- it's pulled in automatically via optionalDependencies.\n",
  );
}

function run(command, args, options) {
  const result = spawnSync(command, args, Object.assign({ stdio: 'inherit' }, options || {}));
  if (result.status !== 0) {
    throw new Error(
      'command failed (exit ' + result.status + '): ' + command + ' ' + args.join(' '),
    );
  }
}

function isAlreadyPublished(name, version) {
  const result = spawnSync('npm', ['view', name + '@' + version, 'version'], { encoding: 'utf8' });
  return result.status === 0 && result.stdout.trim() === version;
}

function packOnly(args) {
  const platforms = loadPlatforms();
  const platform = platforms.filter(function (p) {
    return p.platform === args.platform;
  })[0];
  if (!platform) {
    throw new Error(
      'publish-platform-packages --pack-only: unknown platform "' +
        args.platform +
        '" in ' +
        MANIFEST_PATH,
    );
  }
  if (!args.binary) {
    throw new Error('publish-platform-packages --pack-only: --binary <path> is required');
  }
  const binaryPath = resolve(args.binary);
  if (!existsSync(binaryPath)) {
    throw new Error('publish-platform-packages --pack-only: binary not found at ' + binaryPath);
  }

  const version = args.version || readMainVersion();
  const dir = join(resolve(PACKAGE_ROOT, args.outDir), platform.platform);
  rmSync(dir, { recursive: true, force: true });
  writePlatformPackage(dir, platform, version);
  copyFileSync(binaryPath, join(dir, 'parser-native.node'));

  console.log(
    '[publish-platform-packages] packing ' +
      platform.npmPackage +
      '@' +
      version +
      ' from ' +
      dir +
      '...',
  );
  run('npm', ['pack'], { cwd: dir });
  console.log('[publish-platform-packages] pack-only OK: ' + dir);
}

// Locates a platform's downloaded artifact, if any -- a missing binary is
// expected for a best-effort platform whose build-native.yml job didn't
// produce one, not an error.
function findArtifactBinary(artifactsDir, platform) {
  const binaryPath = join(artifactsDir, platform.platform, 'parser-native.node');
  return existsSync(binaryPath) ? binaryPath : null;
}

// Generates the platform package directory and publishes it (or skips a
// version already live on the registry, so a re-run after a partial failure
// doesn't try to publish over itself).
function publishPlatform(platform, binaryPath, outDir, version) {
  const dir = join(resolve(PACKAGE_ROOT, outDir), platform.platform);
  rmSync(dir, { recursive: true, force: true });
  writePlatformPackage(dir, platform, version);
  copyFileSync(binaryPath, join(dir, 'parser-native.node'));

  if (isAlreadyPublished(platform.npmPackage, version)) {
    console.log(
      '[publish-platform-packages] ' +
        platform.npmPackage +
        '@' +
        version +
        ' already on the registry -- skipping publish (safe re-run).',
    );
  } else {
    console.log(
      '[publish-platform-packages] publishing ' + platform.npmPackage + '@' + version + '...',
    );
    run('npm', ['publish', '--access', 'public', '--provenance'], { cwd: dir });
  }
}

function assertRequiredPlatformsPublished(publishedIds) {
  const missingRequired = REQUIRED_PLATFORMS.filter(function (id) {
    return publishedIds.indexOf(id) === -1;
  });
  if (missingRequired.length > 0) {
    throw new Error(
      'publish-platform-packages: required platform(s) missing an artifact, refusing to publish: ' +
        missingRequired.join(', '),
    );
  }
}

function injectOptionalDependencies(published, version) {
  const mainPkg = JSON.parse(readFileSync(MAIN_PACKAGE_JSON_PATH, 'utf8'));
  const optionalDeps = {};
  published
    .slice()
    .sort(function (a, b) {
      return a.npmPackage < b.npmPackage ? -1 : a.npmPackage > b.npmPackage ? 1 : 0;
    })
    .forEach(function (p) {
      optionalDeps[p.npmPackage] = version;
    });
  mainPkg.optionalDependencies = optionalDeps;
  writeFileSync(MAIN_PACKAGE_JSON_PATH, JSON.stringify(mainPkg, null, 2) + '\n');
  console.log(
    '[publish-platform-packages] injected optionalDependencies for ' +
      published.length +
      ' platform(s) into ' +
      MAIN_PACKAGE_JSON_PATH,
  );
}

function publishAll(args) {
  const platforms = loadPlatforms();
  const version = readMainVersion();
  const artifactsDir = resolve(args.artifactsDir);
  const published = [];

  for (const platform of platforms) {
    const binaryPath = findArtifactBinary(artifactsDir, platform);
    if (!binaryPath) {
      console.log(
        '[publish-platform-packages] no artifact for "' +
          platform.platform +
          '" -- skipping (expected for a best-effort platform whose build-native.yml job did not produce a binary).',
      );
      continue;
    }
    publishPlatform(platform, binaryPath, args.outDir, version);
    published.push(platform);
  }

  if (published.length === 0) {
    throw new Error(
      'publish-platform-packages: no platform artifacts found at all -- refusing to publish ' +
        '@liendev/parser-native with zero optionalDependencies (every required platform must have built).',
    );
  }

  const publishedIds = published.map(function (p) {
    return p.platform;
  });
  assertRequiredPlatformsPublished(publishedIds);
  injectOptionalDependencies(published, version);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.packOnly) {
    packOnly(args);
  } else {
    publishAll(args);
  }
}

main();
