import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { chunkByAST } from './ast/chunker.js';
import { analyzeDependencies } from './dependency-analyzer.js';
import { clearJvmSourceRootCache } from './jvm-source-root.js';

/**
 * End-to-end regression test for #1046/#1005 Mechanism 1, through the REAL
 * production path a user actually hits: `chunkByAST` (real extractor +
 * `resolveImportSpecifier`'s manifest-root resolution step) feeding
 * `analyzeDependencies` (the same function `get_dependents` calls). Not a
 * hand-built chunk fixture and not an isolated `matchesFile`/`importMatchesTarget`
 * call -- this proves the fix works through the actual call path, the same
 * standard the #1021 Rust `mod` regression tests at the bottom of
 * `dependency-analyzer.test.ts` set (`chunkByAST` end-to-end, not a
 * hand-built chunk).
 *
 * Before this fix: `JavaImportExtractor`/`KotlinImportExtractor` store the
 * raw dotted specifier verbatim, `resolveImportSpecifier` has no Java/Kotlin
 * manifest-root step, and `matchesFile`'s only dotted-aware strategy
 * (Strategy 5) is gated off for non-Python importers (#929) -- so the two
 * "resolves a real cross-package import" assertions below returned `[]` on
 * unpatched code. Verified directly: temporarily commenting out the
 * `java`/`kotlin` entries in `chunker.ts`'s `MANIFEST_ROOT_BUILDERS` dispatch
 * table made exactly those two tests fail (`expected [] to include '...'`)
 * while the two anti-fabrication tests below stayed green either way, as
 * they should -- not asserted here as a permanent snapshot, since a
 * deliberately-reverted-fix test would itself need maintaining.
 */
describe('Java/Kotlin dotted-FQN cross-package dependents (#1046/#1005 Mechanism 1)', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-jvm-integration-'));
  });

  afterEach(async () => {
    clearJvmSourceRootCache();
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  async function writeFile(relPath: string, content: string): Promise<void> {
    const abs = path.join(testDir, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }

  /** Chunk a file already written under `testDir` through the real production pipeline. */
  async function chunkFile(relPath: string) {
    const content = await fs.readFile(path.join(testDir, relPath), 'utf-8');
    return chunkByAST(relPath, content, { workspaceRoot: testDir });
  }

  it('resolves a real Java cross-package import to a real dependent edge', async () => {
    const utilFile = 'src/main/java/com/example/util/StringUtils.java';
    const consumerFile = 'src/main/java/com/example/app/Greeter.java';
    await writeFile(
      utilFile,
      'package com.example.util;\n\npublic class StringUtils {\n  public static String upper(String s) { return s.toUpperCase(); }\n}\n',
    );
    await writeFile(
      consumerFile,
      'package com.example.app;\n\nimport com.example.util.StringUtils;\n\npublic class Greeter {\n  public String greet(String name) { return StringUtils.upper(name); }\n}\n',
    );

    const chunks = [...(await chunkFile(utilFile)), ...(await chunkFile(consumerFile))];

    const result = analyzeDependencies(utilFile, chunks, testDir);
    expect(result.dependents.map(d => d.filepath)).toContain(consumerFile);
    expect(result.dependentCount).toBeGreaterThan(0);
  });

  it('resolves a real Kotlin cross-package import in a multi-module (Klaxon-shaped) layout', async () => {
    const tokenFile = 'klaxon/src/main/kotlin/com/beust/klaxon/token/Token.kt';
    const consumerFile = 'klaxon/src/main/kotlin/com/beust/klaxon/StateMachine.kt';
    await writeFile(tokenFile, 'package com.beust.klaxon.token\n\nclass Token\n');
    await writeFile(
      consumerFile,
      'package com.beust.klaxon\n\nimport com.beust.klaxon.token.Token\n\nclass StateMachine {\n  fun next(): Token = Token()\n}\n',
    );

    const chunks = [...(await chunkFile(tokenFile)), ...(await chunkFile(consumerFile))];

    const result = analyzeDependencies(tokenFile, chunks, testDir);
    expect(result.dependents.map(d => d.filepath)).toContain(consumerFile);
  });

  it('does not fabricate an edge from an unrelated same-package-prefix file (#928 trap regression pin)', async () => {
    // A file that merely imports a DIFFERENT class from the same package must
    // not show up as a dependent of files it doesn't actually reference.
    const targetFile = 'src/main/java/com/example/Alpha.java';
    const siblingFile = 'src/main/java/com/example/Beta.java';
    const unrelatedFile = 'src/main/java/com/example/Unrelated.java';
    await writeFile(targetFile, 'package com.example;\n\npublic class Alpha {}\n');
    await writeFile(siblingFile, 'package com.example;\n\npublic class Beta {}\n');
    await writeFile(
      unrelatedFile,
      'package com.example;\n\nimport com.example.Beta;\n\npublic class Unrelated {\n  Beta b = new Beta();\n}\n',
    );

    const chunkArrays = await Promise.all(
      [targetFile, siblingFile, unrelatedFile].map(f => chunkFile(f)),
    );
    const chunks = chunkArrays.flat();

    const result = analyzeDependencies(targetFile, chunks, testDir);
    expect(result.dependents.map(d => d.filepath)).not.toContain(unrelatedFile);
  });

  it('leaves an unresolvable external-library import as a genuine zero (no fabrication)', async () => {
    const consumerFile = 'src/main/java/com/example/App.java';
    await writeFile(
      consumerFile,
      'package com.example;\n\nimport com.google.common.truth.Truth;\n\npublic class App {}\n',
    );

    const chunks = await chunkFile(consumerFile);

    // com.google.common.truth.Truth genuinely doesn't exist in this corpus --
    // there is nothing for get_dependents to resolve it to.
    const result = analyzeDependencies(
      'src/main/java/com/google/common/truth/Truth.java',
      chunks,
      testDir,
    );
    expect(result.dependents).toEqual([]);
  });
});
