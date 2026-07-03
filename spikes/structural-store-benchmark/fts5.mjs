// FTS5 lexical + hybrid lexical-structural search demo, on top of the same
// better-sqlite3 structural schema the A/B benchmark already validated.
//
// This does NOT re-litigate the storage-backend decision (see REPORT.md —
// that's settled: better-sqlite3). It demonstrates the SEARCH STORY that
// replaces LanceDB's vector index: FTS5 keyword/BM25 search + a trigram
// substring index + hybrid lexical-structural JOINs, all in plain SQL against
// the real 44,430-chunk corpus. Numbers here are directional (one corpus, one
// machine) — the point is the mechanism, the shape of the queries, and
// whether the latency is in the right ballpark. Quality is eyeballed, not
// scored; the real verdict comes from dogfooding the actual tool.
//
// Usage: npx tsx fts5.mjs   (builds fresh into .data/fts5/, then benchmarks
// and prints example output; also builds/reuses .data/sqlite/ for the
// baseline regex comparison against the existing list_functions path.)

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus, timeIterations, round } from './lib/shared.mjs';
import { buildFts5Database, keywordSearch, symbolSubstringSearch, orQuery } from './lib/fts5-store.mjs';
import { makeAdapter } from './lib/adapters.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const N_LIGHT = parseInt(process.env.N_LIGHT || '150', 10);
const N_HEAVY = parseInt(process.env.N_HEAVY || '100', 10);

const FTS5_DB_PATH = path.join(__dirname, '.data', 'fts5', 'chunks.db');

// De-duplicate the 10x path-prefixed replicas (r1/, r2/, ...) down to the base
// repo file for human-readable example dumps — latency numbers still run
// against the full 44,430-row replicated corpus.
function dedupeReplicas(rows, limit = 5) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const file = r.file.replace(/^r\d+\//, '');
    const key = `${file}:${r.startLine ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...r, file });
    if (out.length >= limit) break;
  }
  return out;
}

function printRows(rows) {
  for (const r of rows) {
    const loc = `${r.file}:${r.startLine ?? '?'}-${r.endLine ?? '?'}`;
    const sym = r.symbolName ? `${r.symbolType ? r.symbolType + ' ' : ''}${r.symbolName}` : '(no symbol — doc/comment/header chunk)';
    const extra = r.rank !== undefined ? ` rank=${round(r.rank)}` : r.complexity !== undefined ? ` complexity=${r.complexity}` : '';
    console.log(`  ${loc}  ${sym}${extra}`);
  }
}

async function main() {
  const corpus = loadCorpus();
  console.log(`[fts5] corpus: ${corpus.length} chunks`);

  // --- Build ---
  const t0 = Date.now();
  const db = buildFts5Database(corpus, FTS5_DB_PATH);
  const buildMs = Date.now() - t0;
  const ftsRows = db.prepare('SELECT COUNT(*) c FROM chunks_fts').get().c;
  const triRows = db.prepare('SELECT COUNT(*) c FROM chunks_symtri').get().c;
  console.log(`[fts5] build: ${buildMs}ms  chunks_fts=${ftsRows} chunks_symtri=${triRows}`);

  // Baseline: the existing regex-based querySymbols path (list_functions today).
  // Reuses/builds the PLAIN (non-FTS5) sqlite adapter db so the comparison is
  // against the same schema the A/B benchmark already measured.
  const baseline = await makeAdapter('better-sqlite3');
  try {
    await baseline.open();
  } catch {
    await baseline.build(corpus);
    await baseline.open();
  }

  // ===========================================================================
  // Query modes
  // ===========================================================================
  const KEYWORD_QUERIES = [
    'parse import statement',
    'vector search',
    'complexity',
    'user authentication login flow',
    'file watching',
    'retry failed request',
    'circular dependency detection',
  ];
  const SYMBOL_PATTERNS = ['Extractor', 'handle', 'Chunk', 'process', 'parse', 'auth'];

  console.log('\n=== A) KEYWORD search (BM25, porter) — latency ===');
  const kwLatency = await timeIterations(async i => {
    keywordSearch(db, KEYWORD_QUERIES[i % KEYWORD_QUERIES.length], { limit: 5 });
  }, N_HEAVY);
  console.log(kwLatency);

  console.log('\n--- current list_functions regex approach (baseline, same corpus) ---');
  const regexLatency = await timeIterations(async i => {
    await baseline.querySymbols({ pattern: SYMBOL_PATTERNS[i % SYMBOL_PATTERNS.length], limit: 51 });
  }, N_HEAVY);
  console.log(regexLatency);

  console.log('\n=== B) SYMBOL/SUBSTRING search (trigram) — latency ===');
  const triLatency = await timeIterations(async i => {
    symbolSubstringSearch(db, SYMBOL_PATTERNS[i % SYMBOL_PATTERNS.length], { limit: 10 });
  }, N_LIGHT);
  console.log(triLatency);

  // ===========================================================================
  // Hybrid lexical + structural — ONE SQL statement each.
  // ===========================================================================
  const hybrid1 = () =>
    db
      .prepare(
        `SELECT DISTINCT c.file, c.symbolName, c.symbolType, bm25(chunks_fts, 4.0, 1.0) AS rank
         FROM chunks_fts
         JOIN chunks c ON c.id = chunks_fts.rowid
         JOIN chunk_imports ci ON ci.chunk_id = c.id
         WHERE chunks_fts MATCH ? AND ci.import_path = ?
         ORDER BY rank LIMIT 60`,
      )
      .all(orQuery('traverse traversal'), '@liendev/parser');

  const hybrid2 = () =>
    db
      .prepare(
        `SELECT c.file, c.symbolName, c.complexity, c.cognitiveComplexity
         FROM chunks_symtri t
         JOIN chunks c ON c.id = t.rowid
         WHERE t.symbolName MATCH ? AND c.complexity >= ?
         ORDER BY c.complexity DESC LIMIT 60`,
      )
      .all('process', 6);

  const hybrid3 = () =>
    db
      .prepare(
        `SELECT c.file, c.symbolName, c.language, bm25(chunks_fts, 4.0, 1.0) AS rank
         FROM chunks_fts
         JOIN chunks c ON c.id = chunks_fts.rowid
         WHERE chunks_fts MATCH ? AND c.symbolType = 'function' AND c.language = 'typescript'
         ORDER BY rank LIMIT 60`,
      )
      .all(orQuery('cache'));

  console.log('\n=== C) HYBRID lexical + structural — latency (one SQL statement each) ===');
  const hybridLatency = {
    'content∩imports (traverse, imports @liendev/parser)': await timeIterations(async () => hybrid1(), N_HEAVY),
    'symbol∩complexity (process, complexity>=6)': await timeIterations(async () => hybrid2(), N_HEAVY),
    'content∩structural (cache, function+typescript)': await timeIterations(async () => hybrid3(), N_HEAVY),
  };
  console.log(hybridLatency);

  // ===========================================================================
  // Example outputs — eyeball quality.
  // ===========================================================================
  console.log('\n\n########## EXAMPLE OUTPUTS ##########');

  console.log('\n--- A) KEYWORD examples ---');
  const keywordExamples = {};
  for (const q of ['parse import statement', 'vector search', 'complexity']) {
    console.log(`\nquery: "${q}"`);
    const rows = dedupeReplicas(keywordSearch(db, q, { limit: 40 }));
    printRows(rows);
    keywordExamples[q] = rows;
  }

  console.log('\n--- B) SYMBOL/SUBSTRING examples ---');
  const symbolExamples = {};
  for (const p of ['Extractor', 'handle', 'Chunk']) {
    console.log(`\npattern: "${p}"`);
    const rows = dedupeReplicas(symbolSubstringSearch(db, p, { limit: 40 }), 8);
    printRows(rows);
    symbolExamples[p] = rows;
  }

  console.log('\n--- C) HYBRID examples ---');
  console.log('\nhybrid 1: content MATCH "traverse"/"traversal" AND imports @liendev/parser');
  const h1 = dedupeReplicas(hybrid1(), 10);
  printRows(h1);
  console.log('\nhybrid 2: symbolName trigram "process" AND complexity >= 6, ranked by complexity');
  const h2 = dedupeReplicas(hybrid2(), 10);
  printRows(h2);
  console.log('\nhybrid 3: content MATCH "cache" AND symbolType=function AND language=typescript');
  const h3 = dedupeReplicas(hybrid3(), 10);
  printRows(h3);

  console.log('\n--- D) QUALITY EYEBALL: agent-style queries ---');
  const eyeballQueries = [
    { mode: 'keyword', q: 'parse import statement' },
    { mode: 'keyword', q: 'vector search implementation' },
    { mode: 'keyword', q: 'complexity calculation for functions' },
    { mode: 'keyword', q: 'user authentication login flow' },
    { mode: 'symbol', q: 'auth' },
    { mode: 'keyword', q: 'check if user is logged in' },
    { mode: 'keyword', q: 'file watching' },
    { mode: 'keyword', q: 'circular dependency detection' },
  ];
  const eyeballResults = {};
  for (const { mode, q } of eyeballQueries) {
    console.log(`\n[${mode}] "${q}"`);
    const rows =
      mode === 'keyword'
        ? dedupeReplicas(keywordSearch(db, q, { limit: 60 }), 6)
        : dedupeReplicas(symbolSubstringSearch(db, q, { limit: 60 }), 6);
    printRows(rows);
    eyeballResults[`[${mode}] ${q}`] = rows;
  }

  await baseline.close();
  db.close();

  // ===========================================================================
  // Persist structured results.
  // ===========================================================================
  const out = {
    generatedAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    corpusChunks: corpus.length,
    buildMs,
    ftsRows,
    triRows,
    nLight: N_LIGHT,
    nHeavy: N_HEAVY,
    latency: {
      keywordBm25: kwLatency,
      listFunctionsRegexBaseline: regexLatency,
      symbolTrigram: triLatency,
      hybrid: hybridLatency,
    },
    examples: {
      keyword: keywordExamples,
      symbol: symbolExamples,
      hybrid: { hybrid1: h1, hybrid2: h2, hybrid3: h3 },
      eyeball: eyeballResults,
    },
  };
  const outPath = path.join(__dirname, 'fts5-results.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n[fts5] wrote ${outPath}`);
}

main().catch(e => {
  console.error('fts5 FAILED:', e.stack || e.message);
  process.exit(1);
});
