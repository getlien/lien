import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { chunkByAST } from './ast/chunker.js';
import {
  buildJvmSamePackageIndex,
  resolveJvmSamePackageDependents,
} from './jvm-same-package-signals.js';
import type { CodeChunk } from './types.js';

/**
 * End-to-end regression test for #1005 Phase 3 Item D, through the REAL
 * production chunker (`chunkByAST`) -- not a hand-built `CodeChunk` fixture.
 *
 * Every test in `jvm-same-package-signals.test.ts` (including its own P2
 * "post-hoc re-derivation" oracle) constructs `CodeChunk[]` by hand via
 * `makeChunk`/`declChunk`/`usageChunk` -- `chunk.content` is whatever string
 * the test itself wrote, so any oracle that re-derives package from
 * `chunk.content` is comparing the test's own fixture against itself. That
 * structurally CANNOT catch a bug in `chunker.ts` -- the exact defect Item D
 * fixes: a package-private file's header (containing its own `package`
 * line) silently dropped by `minChunkSize` before it ever became a chunk at
 * all. Production (`derivePackage`, fed by the real chunker) and a
 * chunk-content oracle would agree with each other while BOTH silently
 * missing the package line -- neither would ever fail.
 *
 * This file closes that gap: it writes REAL files to a temp directory, runs
 * them through the REAL `chunkByAST` pipeline (the same one `lien index`
 * uses), and independently re-derives each file's package from a SEPARATE
 * `fs.readFile` of the raw bytes on disk -- never from a chunk. A regression
 * that reintroduces the header-drop bug makes `packageByFile.get(file)`
 * come back `undefined` while the raw-disk read still finds the `package`
 * line, so this test (and only this test) actually fails.
 */
describe('#1005 Phase 3 Item D: independent raw-file-on-disk oracle', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-jvm-header-oracle-'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  async function writeFile(relPath: string, content: string): Promise<void> {
    const abs = path.join(testDir, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }

  /** Chunk a file already written under `testDir` through the real production pipeline. */
  async function chunkRealFile(relPath: string): Promise<CodeChunk[]> {
    const content = await fs.readFile(path.join(testDir, relPath), 'utf-8');
    return chunkByAST(relPath, content, { workspaceRoot: testDir });
  }

  /**
   * Independently re-derive the package from the RAW FILE ON DISK -- a
   * SEPARATE `fs.readFile`, never from a chunk. Deliberately duplicates
   * `PACKAGE_DECLARATION_RE`'s pattern rather than importing it: importing
   * the module-under-test's own regex would let a bug in that regex slip
   * through unnoticed by both sides at once.
   */
  async function readPackageFromDisk(relPath: string): Promise<string | undefined> {
    const raw = await fs.readFile(path.join(testDir, relPath), 'utf-8');
    return /^[ \t]*package[ \t]+([\w.]+)/m.exec(raw)?.[1];
  }

  it('derives the correct package for a package-private Kotlin file with a short (< minChunkSize) header, through the real chunker', async () => {
    // No `public`/exported declaration -- `internal` -- so nothing bypassed
    // `minChunkSize` for this file's 2-line header before Item D's fix.
    const relPath = 'src/main/kotlin/a/b/Foo.kt';
    await writeFile(relPath, 'package a.b\n\ninternal class Foo {\n    fun x(): Int = 1\n}\n');

    const chunks = await chunkRealFile(relPath);
    const index = buildJvmSamePackageIndex(chunks);

    const diskPackage = await readPackageFromDisk(relPath);
    expect(diskPackage).toBe('a.b');
    expect(index.packageByFile.get(relPath)).toBe(diskPackage);
  });

  it('derives the correct package for a package-private Java file with a short header', async () => {
    const relPath = 'src/main/java/a/b/Foo.java';
    await writeFile(relPath, 'package a.b;\n\nclass Foo {\n  int x() { return 1; }\n}\n');

    const chunks = await chunkRealFile(relPath);
    const index = buildJvmSamePackageIndex(chunks);

    const diskPackage = await readPackageFromDisk(relPath);
    expect(diskPackage).toBe('a.b');
    expect(index.packageByFile.get(relPath)).toBe(diskPackage);
  });

  it('still derives the correct package for a PUBLIC file whose header was already bypassing minChunkSize before Item D (no regression on the already-working case)', async () => {
    const relPath = 'src/main/java/a/b/Pub.java';
    await writeFile(
      relPath,
      'package a.b;\n\npublic class Pub {\n  public int x() { return 1; }\n}\n',
    );

    const chunks = await chunkRealFile(relPath);
    const index = buildJvmSamePackageIndex(chunks);

    expect(index.packageByFile.get(relPath)).toBe(await readPackageFromDisk(relPath));
    expect(index.packageByFile.get(relPath)).toBe('a.b');
  });

  it('agrees with the disk oracle across a small representative multi-file corpus (short header, long/commented header, and no-package-at-all)', async () => {
    const cases: Array<{ relPath: string; content: string }> = [
      { relPath: 'src/main/kotlin/short/Foo.kt', content: 'package short\n\ninternal class Foo\n' },
      {
        relPath: 'src/main/java/withcomment/Bar.java',
        content:
          'package withcomment;\n\n/*\n * A long license header that already exceeds minChunkSize\n * on its own, independent of Item D.\n */\nclass Bar {\n  int x() { return 1; }\n}\n',
      },
      { relPath: 'nopkg/Default.java', content: 'class Default {\n  int x() { return 1; }\n}\n' },
    ];
    for (const c of cases) await writeFile(c.relPath, c.content);

    const allChunks = (await Promise.all(cases.map(c => chunkRealFile(c.relPath)))).flat();
    const index = buildJvmSamePackageIndex(allChunks);

    for (const c of cases) {
      expect(index.packageByFile.get(c.relPath)).toBe(await readPackageFromDisk(c.relPath));
    }
    expect(index.packageByFile.get(cases[0].relPath)).toBe('short');
    expect(index.packageByFile.get(cases[1].relPath)).toBe('withcomment');
    expect(index.packageByFile.get(cases[2].relPath)).toBeUndefined();
  });

  it('resolves a real same-package dependent end-to-end for a package-private target whose header used to be dropped -- the exact regression this fix closes', async () => {
    const targetFile = 'src/main/kotlin/a/b/Widget.kt';
    const consumerFile = 'src/main/kotlin/a/b/Consumer.kt';
    await writeFile(targetFile, 'package a.b\n\ninternal class Widget {\n    fun render() {}\n}\n');
    await writeFile(
      consumerFile,
      'package a.b\n\ninternal class Consumer {\n    fun use() { Widget().render() }\n}\n',
    );

    const chunks = [...(await chunkRealFile(targetFile)), ...(await chunkRealFile(consumerFile))];
    const index = buildJvmSamePackageIndex(chunks);

    expect(resolveJvmSamePackageDependents(targetFile, index)).toEqual([consumerFile]);
  });
});
