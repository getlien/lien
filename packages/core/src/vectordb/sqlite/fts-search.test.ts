import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { ChunkMetadata } from '@liendev/parser';
import { SqliteBackend } from './sqlite-backend.js';
import {
  orQuery,
  applyStructuralBoost,
  STRUCTURAL_BOOST_ALPHA,
  MAX_STRUCTURAL_BOOST_MULTIPLIER,
} from './fts-search.js';

function chunk(
  file: string,
  content: string,
  extra: Partial<ChunkMetadata> = {},
): { metadata: ChunkMetadata; content: string } {
  return {
    metadata: {
      file,
      startLine: 1,
      endLine: 5,
      type: 'function',
      language: 'typescript',
      ...extra,
    },
    content,
  };
}

async function insert(db: SqliteBackend, c: { metadata: ChunkMetadata; content: string }) {
  await db.insertBatch([c.metadata], [c.content]);
}

describe('orQuery', () => {
  it('OR-joins quoted whitespace-split terms and escapes quotes', () => {
    expect(orQuery('parse import statement')).toBe('"parse" OR "import" OR "statement"');
    expect(orQuery('  spaced   out ')).toBe('"spaced" OR "out"');
    expect(orQuery('say "hi"')).toBe('"say" OR """hi"""');
    expect(orQuery('   ')).toBe('');
  });
});

describe('applyStructuralBoost', () => {
  it('is a no-op at dependentCount 0 (log1p(1) term vanishes... actually log1p(0)=0)', () => {
    expect(applyStructuralBoost(0.8, 0)).toBe(0.8);
  });

  it('never returns less than the input ratio (boosts, never demotes)', () => {
    for (const dependentCount of [0, 1, 5, 50, 500]) {
      expect(applyStructuralBoost(0.6, dependentCount)).toBeGreaterThanOrEqual(0.6);
    }
  });

  it('is monotonically increasing in dependentCount', () => {
    const boosts = [0, 1, 5, 20, 100].map(d => applyStructuralBoost(0.7, d));
    for (let i = 1; i < boosts.length; i++) {
      expect(boosts[i]).toBeGreaterThan(boosts[i - 1]);
    }
  });

  it('is sublinear (log1p): a one-dependent step matters far more near 0 than near 100', () => {
    const base = applyStructuralBoost(0.7, 0);
    const deltaNear0 = applyStructuralBoost(0.7, 2) - applyStructuralBoost(0.7, 1);
    const deltaNear100 = applyStructuralBoost(0.7, 101) - applyStructuralBoost(0.7, 100);
    expect(deltaNear0).toBeGreaterThan(deltaNear100);
    expect(base).toBe(0.7);
  });

  it('stays within a bounded multiplier at a realistic max dependentCount (~200)', () => {
    // 1 + 0.15 * ln(201) ≈ 1.8x — documented bound in the doc comment.
    const boosted = applyStructuralBoost(1, 200);
    expect(boosted).toBeGreaterThan(1.7);
    expect(boosted).toBeLessThan(1.9);
  });

  it('respects a custom alpha', () => {
    const withDefaultAlpha = applyStructuralBoost(0.5, 10);
    const withZeroAlpha = applyStructuralBoost(0.5, 10, 0);
    const withDoubleAlpha = applyStructuralBoost(0.5, 10, STRUCTURAL_BOOST_ALPHA * 2);
    expect(withZeroAlpha).toBe(0.5);
    expect(withDoubleAlpha).toBeGreaterThan(withDefaultAlpha);
  });

  it('caps the multiplier at MAX_STRUCTURAL_BOOST_MULTIPLIER for a pathologically large dependentCount', () => {
    const boosted = applyStructuralBoost(1, 10_000_000);
    expect(boosted).toBeCloseTo(MAX_STRUCTURAL_BOOST_MULTIPLIER, 5);
    // And it doesn't grow any further past the cap.
    expect(applyStructuralBoost(1, 10_000_000_000)).toBeCloseTo(MAX_STRUCTURAL_BOOST_MULTIPLIER, 5);
  });

  it(
    'documented caveat: a well-connected hub file CAN cross a relevance band and outrank an ' +
      'unconnected file with a marginally better lexical match — no capped multiplicative boost ' +
      'can prevent this near a band boundary, so this pins the known tradeoff instead of hiding it',
    () => {
      const relevantBandFloor = 0.5; // toRelevance()'s 'relevant' band starts at 0.5
      const highlyRelevantBandFloor = 0.75 + 0.001; // just inside 'highly_relevant'
      const hubDependentCount = 200; // this file's own documented "realistic max"

      const hubBoosted = applyStructuralBoost(relevantBandFloor, hubDependentCount);
      const unconnectedBoosted = applyStructuralBoost(highlyRelevantBandFloor, 0);

      expect(hubBoosted).toBeGreaterThan(unconnectedBoosted);
    },
  );
});

describe('SqliteBackend.search (FTS5)', () => {
  let db: SqliteBackend;
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = path.join(
      os.tmpdir(),
      `lien-fts-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    );
    await fs.mkdir(projectRoot, { recursive: true });
    db = new SqliteBackend(projectRoot);
    await db.initialize();
  });

  afterEach(async () => {
    db.close();
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(db.dbPath, { recursive: true, force: true });
  });

  it('returns a relevant chunk for a keyword query', async () => {
    await insert(db, chunk('auth.ts', 'handles user authentication and session tokens'));
    await insert(db, chunk('math.ts', 'adds two numbers together'));

    const results = await db.search('authentication', 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].metadata.file).toBe('auth.ts');
  });

  it('finds a camelCase symbol via the symbolTokens column', async () => {
    // Content deliberately has no "parse" word — the match must come from
    // symbolTokens ('parse import statement').
    await insert(
      db,
      chunk('imports.ts', 'function x() { return 1; }', {
        symbolName: 'parseImportStatement',
      }),
    );

    const results = await db.search('parse', 5);
    expect(results).toHaveLength(1);
    expect(results[0].metadata.symbolName).toBe('parseImportStatement');
  });

  it('orders by bm25 (best hit first) and the top hit is always highly_relevant', async () => {
    await insert(db, chunk('strong.ts', 'cache cache cache invalidation cache layer'));
    await insert(db, chunk('weak.ts', 'a cache and some unrelated words here'));

    const results = await db.search('cache', 5);
    expect(results[0].metadata.file).toBe('strong.ts');
    expect(results[0].relevance).toBe('highly_relevant');
    expect(results[0].score).toBe(0);
  });

  it('forces highly_relevant when a query term exactly matches symbolName', async () => {
    await insert(db, chunk('flow.ts', 'user login login login flow handler routine'));
    await insert(db, chunk('def.ts', 'x', { symbolName: 'login' }));

    const results = await db.search('login', 5);
    const exact = results.find(r => r.metadata.symbolName === 'login');
    expect(exact?.relevance).toBe('highly_relevant');
  });

  it('returns [] when there is no query text', async () => {
    await insert(db, chunk('a.ts', 'something searchable here'));
    expect(await db.search('', 5)).toEqual([]);
    expect(await db.search('   ', 5)).toEqual([]);
    expect(await db.search(undefined as unknown as string, 5)).toEqual([]);
  });

  it('over-fetches internally but trims to the requested limit', async () => {
    for (let i = 0; i < 30; i++) {
      await insert(db, chunk(`f${i}.ts`, `shared token number ${i}`));
    }
    const results = await db.search('shared', 5);
    expect(results).toHaveLength(5);
  });

  it('keeps the FTS index in sync through updateFile (triggers)', async () => {
    await insert(db, chunk('a.ts', 'alpha zzztokenold marker'));
    expect(await db.search('zzztokenold', 5)).toHaveLength(1);

    await db.updateFile(
      'a.ts',
      [chunk('a.ts', 'beta zzztokennew marker').metadata],
      ['beta zzztokennew marker'],
    );

    expect(await db.search('zzztokenold', 5)).toEqual([]);
    expect(await db.search('zzztokennew', 5)).toHaveLength(1);
  });

  it('keeps the FTS index in sync through deleteByFile (triggers)', async () => {
    await insert(db, chunk('a.ts', 'gone soon uniquetoken'));
    expect(await db.search('uniquetoken', 5)).toHaveLength(1);

    await db.deleteByFile('a.ts');
    expect(await db.search('uniquetoken', 5)).toEqual([]);
  });

  it('indexes and retrieves a YAML config chunk (type:config, language:yaml)', async () => {
    await insert(
      db,
      chunk('.github/workflows/ci.yml', 'jobs:\n  build:\n    zzzyamltoken: true\n', {
        type: 'config',
        language: 'yaml',
        symbolName: 'jobs',
      }),
    );

    const results = await db.search('zzzyamltoken', 5);
    expect(results).toHaveLength(1);
    expect(results[0].metadata.file).toBe('.github/workflows/ci.yml');
    expect(results[0].metadata.type).toBe('config');
    expect(results[0].metadata.language).toBe('yaml');
  });

  it('attaches dependentCount to result metadata based on who imports the file', async () => {
    await insert(db, chunk('utils/logger.ts', 'export function zzzlogsearch() {}'));
    await insert(
      db,
      chunk('consumers/a.ts', 'unrelated content', { imports: ['../utils/logger'] }),
    );

    const results = await db.search('zzzlogsearch', 5);
    expect(results[0].metadata.file).toBe('utils/logger.ts');
    expect(results[0].metadata.dependentCount).toBe(1);
  });

  it(
    'reorders a tied-bm25 pair by dependentCount when ranking is enabled, and leaves the ' +
      'pure-bm25 order untouched when LIEN_STRUCTURAL_RANKING=off',
    async () => {
      const TIED_CONTENT = 'zzzboosttie shared unique content phrase repeated here';
      await insert(db, chunk('unused.ts', TIED_CONTENT));
      await insert(db, chunk('popular.ts', TIED_CONTENT));

      // Control: identical (tied) bm25 content, nobody imports either file yet.
      const controlResults = await db.search(TIED_CONTENT, 5);
      const controlOrder = controlResults.map(r => r.metadata.file);
      expect(new Set(controlOrder)).toEqual(new Set(['unused.ts', 'popular.ts']));
      expect(controlResults.every(r => r.metadata.dependentCount === 0)).toBe(true);

      // Give popular.ts two dependents. Reconnect to force the dependentCounts
      // cache (keyed on the underlying Database object) to recompute — mirrors
      // what the MCP server's checkAndReconnect does after any index write.
      await insert(db, chunk('importer1.ts', 'unrelated content one', { imports: ['./popular'] }));
      await insert(db, chunk('importer2.ts', 'unrelated content two', { imports: ['./popular'] }));
      await db.reconnect();

      const boostedResults = await db.search(TIED_CONTENT, 5);
      const popular = boostedResults.find(r => r.metadata.file === 'popular.ts');
      const unused = boostedResults.find(r => r.metadata.file === 'unused.ts');
      expect(popular?.metadata.dependentCount).toBe(2);
      expect(unused?.metadata.dependentCount).toBe(0);
      expect(boostedResults.indexOf(popular!)).toBeLessThan(boostedResults.indexOf(unused!));

      // Flag off: dependentCount is still reported (metadata is unconditional),
      // but it no longer influences order — the pure-bm25 (control) order wins.
      process.env.LIEN_STRUCTURAL_RANKING = 'off';
      try {
        const offResults = await db.search(TIED_CONTENT, 5);
        const offOrder = offResults
          .map(r => r.metadata.file)
          .filter(f => f === 'unused.ts' || f === 'popular.ts');
        expect(offOrder).toEqual(controlOrder);
        expect(
          offResults.find(r => r.metadata.file === 'popular.ts')?.metadata.dependentCount,
        ).toBe(2);
      } finally {
        delete process.env.LIEN_STRUCTURAL_RANKING;
      }
    },
  );

  it(
    "a result's own score/relevance always describe pure bm25 quality, even when a " +
      'lower-quality-but-popular result outranks it in the returned order',
    async () => {
      const TERM = 'zzzscorepin';
      // Strongest possible bm25 match: the term repeated, nothing else competing.
      await insert(db, chunk('strong.ts', `${TERM} ${TERM} ${TERM} ${TERM} ${TERM}`));
      // A couple of mentions diluted among unrelated filler — a real but genuinely
      // weaker ('relevant', not 'highly_relevant') match.
      await insert(db, chunk('weak.ts', `${TERM} ${TERM} alpha bravo charlie delta echo`));
      // Give weak.ts enough dependents (near MAX_STRUCTURAL_BOOST_MULTIPLIER's
      // ~1.8x at 200) that its boosted rank can overtake strong.ts's — which has
      // none, so its own boost multiplier stays 1x (unchanged from pure bm25).
      for (let i = 0; i < 200; i++) {
        await insert(
          db,
          chunk(`importer${i}.ts`, `unrelated filler ${i}`, { imports: ['./weak'] }),
        );
      }
      await db.reconnect();

      const results = await db.search(TERM, 5);
      const strong = results.find(r => r.metadata.file === 'strong.ts')!;
      const weak = results.find(r => r.metadata.file === 'weak.ts')!;

      // Precondition for this test to be meaningful: weak really is a weaker
      // lexical match than strong, on its own terms.
      expect(strong.relevance).toBe('highly_relevant');
      expect(weak.relevance).not.toBe('highly_relevant');
      expect(weak.score).toBeGreaterThan(strong.score);

      // Yet the popularity boost puts weak.ts AHEAD of strong.ts in the returned order —
      // list order and each result's own relevance label legitimately disagree here.
      expect(results.indexOf(weak)).toBeLessThan(results.indexOf(strong));
    },
  );
});
