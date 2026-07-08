// CommonJS-native-addon loader wrapped in an ESM module (this package is
// "type": "module", matching every other package in the monorepo). Native
// addons must be loaded via require(), not import -- Node has no stable
// dynamic-import story for .node files -- so we use createRequire() rather
// than splitting this into a separate .cjs loader + .mjs wrapper.
//
// Resolution order:
//   1. The per-platform npm package for the running platform (installed via
//      optionalDependencies once the release pipeline publishes them --
//      see README.md).
//   2. A local dev binary at ./parser-native.node, produced by
//      `npm run build:native -w @liendev/parser-native`.
//   3. A clear error naming the platform triple and the remedy.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const { platforms } = require('./scripts/platforms.json');

/**
 * Alpine/musl Linux builds of Node don't report a glibc version in the
 * process report header; glibc builds always do. Same heuristic napi-rs's
 * generated loaders use to disambiguate `-gnu` vs `-musl` npm packages.
 */
function isMusl() {
  if (process.platform !== 'linux') return false;
  try {
    const report = process.report?.getReport();
    return !report?.header?.glibcVersionRuntime;
  } catch {
    return true;
  }
}

function matchPlatform() {
  const libc = process.platform === 'linux' ? (isMusl() ? 'musl' : 'gnu') : null;
  return platforms.find(
    p => p.nodePlatform === process.platform && p.nodeArch === process.arch && p.libc === libc,
  );
}

function loadBinding() {
  const match = matchPlatform();

  if (match) {
    try {
      return require(match.npmPackage);
    } catch {
      // Platform package isn't installed -- fall through to the local dev
      // binary below. This is the expected path in this monorepo checkout
      // until the release pipeline publishes per-platform packages and
      // wires them in via optionalDependencies (see README.md).
    }
  }

  const localBinary = join(__dirname, 'parser-native.node');
  if (existsSync(localBinary)) {
    return require(localBinary);
  }

  const triple = match ? match.target : `${process.platform}-${process.arch}`;
  throw new Error(
    `@liendev/parser-native: no prebuilt binary available for "${triple}" and no local dev build found at ` +
      `${localBinary}. Build it with: npm run build:native -w @liendev/parser-native`,
  );
}

const binding = loadBinding();

export const parseTree = binding.parseTree;
