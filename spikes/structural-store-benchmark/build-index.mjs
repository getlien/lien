// Build one backend's on-disk index from corpus.json in a FRESH process.
// Emits a single JSON line to stdout: { backend, indexBuildMs, onDiskMB, rows }.
// Usage: tsx build-index.mjs <backend>

import { execSync } from 'node:child_process';
import path from 'node:path';
import { loadCorpus, round } from './lib/shared.mjs';
import { makeAdapter } from './lib/adapters.mjs';

function dirSizeMB(p) {
  try {
    const out = execSync(`du -sk ${JSON.stringify(p)}`)
      .toString()
      .trim()
      .split(/\s+/)[0];
    return round(parseInt(out, 10) / 1024);
  } catch {
    return null;
  }
}

async function main() {
  const backend = process.argv[2];
  const corpus = loadCorpus();
  const adapter = await makeAdapter(backend);

  const t0 = process.hrtime.bigint();
  await adapter.build(corpus);
  const t1 = process.hrtime.bigint();
  await adapter.close();

  const indexBuildMs = round(Number(t1 - t0) / 1e6);
  // For file-based stores, size the file (+ sidecars); for LanceDB, the dir.
  const target = adapter.dbPath;
  let onDiskMB;
  const isDir = target && !path.extname(target);
  if (isDir) onDiskMB = dirSizeMB(target);
  else onDiskMB = dirSizeMB(path.dirname(target)); // db + wal/shm sidecars

  process.stdout.write(
    JSON.stringify({ backend, indexBuildMs, onDiskMB, rows: corpus.length, dbPath: target }) + '\n',
  );
}

main().catch(e => {
  console.error(`[build ${process.argv[2]}] FAILED:`, e.stack || e.message);
  process.exit(1);
});
