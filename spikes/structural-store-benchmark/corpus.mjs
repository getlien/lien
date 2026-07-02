// Corpus generator for the structural-store benchmark.
//
// Produces a realistic chunk set by running Lien's REAL structural indexing
// path (`performChunkOnlyIndex` from @liendev/parser) over the repo's
// git-tracked source. Using `git ls-files` (rather than a filesystem scan of
// the repo root) keeps the corpus reproducible and free of worktree / dist /
// node_modules pollution.
//
// Output: corpus.json — an array of CodeChunk ({ content, metadata }) exactly
// as Lien's chunker emits them. This is the shared, backend-agnostic input
// every adapter is loaded from, so all backends store byte-identical data.

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performChunkOnlyIndex } from '@liendev/parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'corpus.json');

// The repo root is the MAIN checkout, not this worktree — index the real
// project source. Overridable via LIEN_REPO_ROOT for a different corpus.
const REPO_ROOT = process.env.LIEN_REPO_ROOT || '/Users/alfhenderson/Code/lien';

// Extensions Lien's scanner indexes (see chunk-only-index.ts include globs).
const INDEXABLE = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'vue',
  'py',
  'php',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'rb',
  'cs',
  'liquid',
  'scala',
  'c',
  'cpp',
  'cc',
  'cxx',
  'h',
  'hpp',
  'md',
  'mdx',
  'markdown',
]);

function gitTrackedFiles() {
  const out = execSync('git ls-files', { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString()
    .split('\n')
    .filter(Boolean);
  return out.filter(f => {
    const ext = f.split('.').pop()?.toLowerCase();
    if (!ext || !INDEXABLE.has(ext)) return false;
    // Exclude dist/build artifacts that may be tracked and the benchmark's own
    // generated files.
    if (f.includes('/dist/') || f.startsWith('dist/')) return false;
    return true;
  });
}

async function main() {
  const files = gitTrackedFiles();
  console.error(`[corpus] indexing ${files.length} git-tracked source files from ${REPO_ROOT}`);

  const result = await performChunkOnlyIndex(REPO_ROOT, {
    filesToIndex: files,
    concurrency: 8,
  });

  if (!result.success) {
    console.error(`[corpus] indexing failed: ${result.error}`);
    process.exit(1);
  }

  // Replicate the real chunk set into N path-prefixed copies to reach a
  // realistic monorepo scale. This mirrors exactly how Lien's own production
  // index reached 194,998 rows: duplicate file copies under .claude/worktrees/*.
  // Relative imports still resolve within each replica; the operation cost we
  // measure (full scan + in-memory import-graph build) scales with row count.
  // REPLICATE=1 gives the honest single-repo corpus (4.4k rows).
  const replicate = Math.max(1, parseInt(process.env.REPLICATE || '10', 10));
  const base = result.chunks;
  let chunks = base;
  if (replicate > 1) {
    chunks = [];
    for (let k = 0; k < replicate; k++) {
      const prefix = k === 0 ? '' : `r${k}/`;
      for (const c of base) {
        // Deep-ish clone: only `file` needs rewriting; everything else is
        // reused by reference-free JSON round-trip at write time.
        chunks.push(
          k === 0
            ? c
            : { content: c.content, metadata: { ...c.metadata, file: prefix + c.metadata.file } },
        );
      }
    }
  }

  writeFileSync(OUT, JSON.stringify(chunks));

  // Quick shape report.
  const langs = {};
  let withImports = 0;
  let withCallSites = 0;
  let withImportedSymbols = 0;
  let contentBytes = 0;
  for (const c of chunks) {
    langs[c.metadata.language] = (langs[c.metadata.language] || 0) + 1;
    if (c.metadata.imports?.length) withImports++;
    if (c.metadata.callSites?.length) withCallSites++;
    if (c.metadata.importedSymbols && Object.keys(c.metadata.importedSymbols).length)
      withImportedSymbols++;
    contentBytes += Buffer.byteLength(c.content, 'utf8');
  }

  console.error(
    `[corpus] filesIndexed=${result.filesIndexed} baseChunks=${result.chunksCreated} replicate=${replicate}x totalChunks=${chunks.length} indexMs=${result.durationMs}`,
  );
  console.error(
    `[corpus] chunks w/ imports=${withImports} w/ importedSymbols=${withImportedSymbols} w/ callSites=${withCallSites}`,
  );
  console.error(
    `[corpus] avg content bytes=${Math.round(contentBytes / chunks.length)} total content MB=${(contentBytes / 1e6).toFixed(1)}`,
  );
  console.error(`[corpus] languages=${JSON.stringify(langs)}`);
  console.error(`[corpus] wrote ${OUT}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
