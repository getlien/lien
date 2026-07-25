import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  resolveRustCrateMap,
  resolveRustCrateImport,
  clearRustCrateMapCache,
} from './rust-crate-map.js';

describe('resolveRustCrateMap', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-rust-crate-map-'));
  });

  afterEach(async () => {
    clearRustCrateMapCache();
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  async function writeFile(relPath: string, content: string): Promise<void> {
    const abs = path.join(testDir, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }

  it('returns an empty map when there is no Cargo.toml at all', () => {
    expect(resolveRustCrateMap(testDir).size).toBe(0);
  });

  it('maps a single-crate project (no [workspace]) by its own [package] name', async () => {
    await writeFile(
      'Cargo.toml',
      '[package]\nname = "my-crate"\nversion = "0.1.0"\nedition = "2021"\n',
    );

    const map = resolveRustCrateMap(testDir);
    // Hyphens in the package name become underscores in `use` paths (#903).
    expect(map.get('my_crate')).toBe('src');
    expect(map.size).toBe(1);
  });

  it("maps a Cargo workspace's members by each one's own [package] name (tokio shape)", async () => {
    await writeFile(
      'Cargo.toml',
      [
        '[workspace]',
        'resolver = "2"',
        'members = [',
        '  "tokio",',
        '  "tokio-test",',
        '  "tokio-stream",',
        '  "tokio-util",',
        '',
        '  # Internal',
        '  "benches",',
        ']',
        '',
        '[patch.crates-io]',
        'tokio = { path = "tokio" }',
      ].join('\n'),
    );
    await writeFile('tokio/Cargo.toml', '[package]\nname = "tokio"\nversion = "1.0.0"\n');
    await writeFile('tokio-test/Cargo.toml', '[package]\nname = "tokio-test"\nversion = "0.4.0"\n');
    await writeFile(
      'tokio-stream/Cargo.toml',
      '[package]\nname = "tokio-stream"\nversion = "0.1.0"\n',
    );
    await writeFile('tokio-util/Cargo.toml', '[package]\nname = "tokio-util"\nversion = "0.7.0"\n');
    // "benches" is a declared member with no Cargo.toml of its own in this
    // fixture -- must be skipped gracefully, not throw.
    await fs.mkdir(path.join(testDir, 'benches'), { recursive: true });

    const map = resolveRustCrateMap(testDir);

    expect(map.get('tokio')).toBe('tokio/src');
    expect(map.get('tokio_test')).toBe('tokio-test/src');
    expect(map.get('tokio_stream')).toBe('tokio-stream/src');
    expect(map.get('tokio_util')).toBe('tokio-util/src');
    expect(map.has('benches')).toBe(false);
    expect(map.size).toBe(4);
  });

  it("also maps the workspace root's own [package] when it is itself a member crate", async () => {
    await writeFile(
      'Cargo.toml',
      '[package]\nname = "root-crate"\nversion = "0.1.0"\n\n[workspace]\nmembers = ["sub"]\n',
    );
    await writeFile('sub/Cargo.toml', '[package]\nname = "sub"\nversion = "0.1.0"\n');

    const map = resolveRustCrateMap(testDir);

    expect(map.get('root_crate')).toBe('src');
    expect(map.get('sub')).toBe('sub/src');
    expect(map.size).toBe(2);
  });

  it('resolves glob-pattern workspace members', async () => {
    await writeFile('Cargo.toml', '[workspace]\nmembers = ["crates/*"]\n');
    await writeFile('crates/foo/Cargo.toml', '[package]\nname = "foo"\nversion = "0.1.0"\n');
    await writeFile('crates/bar/Cargo.toml', '[package]\nname = "bar"\nversion = "0.1.0"\n');

    const map = resolveRustCrateMap(testDir);

    expect(map.get('foo')).toBe('crates/foo/src');
    expect(map.get('bar')).toBe('crates/bar/src');
    expect(map.size).toBe(2);
  });

  it('caches the map per workspace root', async () => {
    await writeFile('Cargo.toml', '[package]\nname = "my-crate"\n');
    const first = resolveRustCrateMap(testDir);
    await writeFile('Cargo.toml', '[package]\nname = "renamed-crate"\n');
    const second = resolveRustCrateMap(testDir);

    expect(second).toBe(first);
    expect(second.has('my_crate')).toBe(true);
    expect(second.has('renamed_crate')).toBe(false);
  });
});

describe('resolveRustCrateImport', () => {
  it('is a no-op (returns null) when crateMap is undefined', () => {
    expect(resolveRustCrateImport('tokio_util::codec::Framed', undefined)).toBeNull();
  });

  it('is a no-op (returns null) when crateMap is empty', () => {
    expect(resolveRustCrateImport('tokio_util::codec::Framed', new Map())).toBeNull();
  });

  it('resolves a workspace crate import to its src dir + module path (tokio-util repro from #903)', () => {
    const crateMap = new Map([['tokio_util', 'tokio-util/src']]);
    expect(resolveRustCrateImport('tokio_util::codec::Framed', crateMap)).toBe(
      'tokio-util/src/codec/Framed',
    );
  });

  it('resolves a bare crate-root import (no further path) to the crate dir itself', () => {
    const crateMap = new Map([['tokio_test', 'tokio-test/src']]);
    expect(resolveRustCrateImport('tokio_test', crateMap)).toBe('tokio-test/src');
  });

  it('leaves a genuinely external crate unresolved (returns null) -- no guessing, #868 precedent', () => {
    const crateMap = new Map([['tokio_util', 'tokio-util/src']]);
    expect(resolveRustCrateImport('futures::stream::StreamExt', crateMap)).toBeNull();
    expect(resolveRustCrateImport('serde::Deserialize', crateMap)).toBeNull();
  });

  it('does not false-positive on a shared string prefix without a path boundary', () => {
    // "tokio_util_extra" must not be treated as the "tokio_util" crate.
    const crateMap = new Map([['tokio_util', 'tokio-util/src']]);
    expect(resolveRustCrateImport('tokio_util_extra::foo', crateMap)).toBeNull();
  });
});
