import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  resolveJvmSourceRoots,
  resolveJvmSourceRootImport,
  clearJvmSourceRootCache,
} from './jvm-source-root.js';

describe('resolveJvmSourceRoots', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-jvm-source-root-'));
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

  it('returns an empty array when there is no conventional source set anywhere', () => {
    expect(resolveJvmSourceRoots(testDir)).toEqual([]);
  });

  it('finds a single-module Gradle/Maven layout at the workspace root (JavaPoet shape)', async () => {
    await writeFile('src/main/java/com/squareup/javapoet/TypeName.java', 'package x;');
    await writeFile('src/test/java/com/squareup/javapoet/TypeNameTest.java', 'package x;');
    expect(resolveJvmSourceRoots(testDir)).toEqual(['src/main/java', 'src/test/java']);
  });

  it('finds a multi-module Gradle layout nested under a module directory (Klaxon shape)', async () => {
    // cbeust/klaxon's real layout: the Gradle module lives under klaxon/,
    // not at the repo root -- a fixed-depth join would miss this entirely.
    await writeFile('klaxon/src/main/kotlin/com/beust/klaxon/JsonObject.kt', 'package x');
    expect(resolveJvmSourceRoots(testDir)).toEqual(['klaxon/src/main/kotlin']);
  });

  it('finds mixed Java and Kotlin source sets in the same module (interop)', async () => {
    await writeFile('src/main/java/com/example/Helper.java', 'package com.example;');
    await writeFile('src/main/kotlin/com/example/Main.kt', 'package com.example');
    expect(resolveJvmSourceRoots(testDir)).toEqual(['src/main/java', 'src/main/kotlin']);
  });

  it('ignores a source-set-shaped directory under node_modules/build/target', async () => {
    await writeFile('node_modules/some-pkg/src/main/java/Ignored.java', 'x');
    await writeFile('build/generated/src/main/java/Ignored.java', 'x');
    await writeFile('target/classes/src/main/java/Ignored.java', 'x');
    expect(resolveJvmSourceRoots(testDir)).toEqual([]);
  });

  it('caches the result per workspace root', async () => {
    await writeFile('src/main/java/com/example/Foo.java', 'x');
    const first = resolveJvmSourceRoots(testDir);
    await fs.rm(path.join(testDir, 'src'), { recursive: true, force: true });
    const second = resolveJvmSourceRoots(testDir);

    expect(second).toBe(first);
    expect(second).toEqual(['src/main/java']);
  });
});

describe('resolveJvmSourceRootImport', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-jvm-source-root-resolve-'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  async function writeFile(relPath: string, content: string): Promise<void> {
    const abs = path.join(testDir, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }

  it('is a no-op when there are no source roots', () => {
    expect(resolveJvmSourceRootImport('com.squareup.javapoet.TypeName', [], testDir)).toBe(
      'com.squareup.javapoet.TypeName',
    );
  });

  it('is a no-op when workspaceRoot is undefined', () => {
    expect(
      resolveJvmSourceRootImport('com.squareup.javapoet.TypeName', ['src/main/java'], undefined),
    ).toBe('com.squareup.javapoet.TypeName');
  });

  it('resolves a real dotted FQN to its file (#1046 JavaPoet repro)', async () => {
    await writeFile('src/main/java/com/squareup/javapoet/TypeName.java', 'package x;');
    const roots = resolveJvmSourceRoots(testDir);
    expect(resolveJvmSourceRootImport('com.squareup.javapoet.TypeName', roots, testDir)).toBe(
      'src/main/java/com/squareup/javapoet/TypeName',
    );
  });

  it('resolves a real Kotlin dotted FQN under a multi-module nested source root (#1046 Klaxon repro)', async () => {
    await writeFile('klaxon/src/main/kotlin/com/beust/klaxon/internal/ConverterFinder.kt', 'x');
    const roots = resolveJvmSourceRoots(testDir);
    expect(
      resolveJvmSourceRootImport('com.beust.klaxon.internal.ConverterFinder', roots, testDir),
    ).toBe('klaxon/src/main/kotlin/com/beust/klaxon/internal/ConverterFinder');
  });

  it('never fabricates a match for an external library not on disk (#928 trap)', async () => {
    await writeFile('src/main/java/com/squareup/javapoet/TypeName.java', 'x');
    const roots = resolveJvmSourceRoots(testDir);
    // com.google.common.truth.Truth genuinely doesn't exist in this corpus --
    // must pass through unchanged, never guess a path for it.
    expect(resolveJvmSourceRootImport('com.google.common.truth.Truth', roots, testDir)).toBe(
      'com.google.common.truth.Truth',
    );
  });

  it('does not fabricate a match for a same-named sibling class (basename-collision safety)', async () => {
    await writeFile('src/main/java/com/example/Utils.java', 'x');
    await writeFile('src/main/java/com/other/UtilsHelper.java', 'x');
    const roots = resolveJvmSourceRoots(testDir);
    // "com.example.Utils" must resolve to its OWN file, not fuzzily match
    // "UtilsHelper" or any other real file with a coincidentally similar name.
    expect(resolveJvmSourceRootImport('com.example.Utils', roots, testDir)).toBe(
      'src/main/java/com/example/Utils',
    );
  });

  it('does not resolve a wildcard-package specifier (names a directory, not a file)', async () => {
    await fs.mkdir(path.join(testDir, 'src/main/java/com/example'), { recursive: true });
    const roots = resolveJvmSourceRoots(testDir);
    // extractImportPath already strips the trailing `.*`, so this receives
    // the bare package path -- there is no single FILE for it to resolve to,
    // so it must stay unresolved rather than guess at "the whole directory".
    expect(resolveJvmSourceRootImport('com.example', roots, testDir)).toBe('com.example');
  });

  it('is a no-op for an already-slash specifier (relative-import already resolved upstream)', () => {
    expect(
      resolveJvmSourceRootImport('src/main/java/com/example/Foo', ['src/main/java'], testDir),
    ).toBe('src/main/java/com/example/Foo');
  });

  it('resolves the Java static-member companion candidate to its owning class, not the member path', async () => {
    // JavaImportExtractor's staticMemberClassPath (#864) emits BOTH
    // "com.example.Utils.checkArgument" (unresolvable -- there is no such
    // file) and "com.example.Utils" (the real class) as separate candidates;
    // only the latter should ever resolve.
    await writeFile('src/main/java/com/example/Utils.java', 'x');
    const roots = resolveJvmSourceRoots(testDir);
    expect(resolveJvmSourceRootImport('com.example.Utils.checkArgument', roots, testDir)).toBe(
      'com.example.Utils.checkArgument',
    );
    expect(resolveJvmSourceRootImport('com.example.Utils', roots, testDir)).toBe(
      'src/main/java/com/example/Utils',
    );
  });

  it('prefers a production source over a same-named test double (main before test ordering)', async () => {
    await writeFile('src/main/java/com/example/Foo.java', 'x');
    await writeFile('src/test/java/com/example/Foo.java', 'x'); // unrealistic collision, but pins tie-break
    const roots = resolveJvmSourceRoots(testDir);
    expect(resolveJvmSourceRootImport('com.example.Foo', roots, testDir)).toBe(
      'src/main/java/com/example/Foo',
    );
  });

  it('resolves a real FQN with Unicode package/class names (JLS/Kotlin permit non-ASCII identifiers)', async () => {
    await writeFile('src/main/java/例/クラス/Foo.java', 'package 例.クラス;');
    const roots = resolveJvmSourceRoots(testDir);
    expect(resolveJvmSourceRootImport('例.クラス.Foo', roots, testDir)).toBe(
      'src/main/java/例/クラス/Foo',
    );
  });
});
