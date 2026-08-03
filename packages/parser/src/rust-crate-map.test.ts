import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  resolveRustCrateMap,
  resolveRustCrateImport,
  clearRustCrateMapCache,
} from './rust-crate-map.js';
import { clearRustCrateExportCache } from './rust-crate-exports.js';
import { hasRustModMarker, stripRustModMarker } from './utils/rust-mod-marker.js';

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

  it('reads the real `members` array, not `default-members`, when default-members is declared first', async () => {
    // TOML formatters commonly sort keys alphabetically, which places
    // "default-members" before "members" -- an unanchored `members = [...]`
    // regex would match the "members = [" tail of "default-members = [" and
    // extract that array instead, silently dropping the real workspace
    // members (and picking up bogus/unrelated crate names).
    await writeFile(
      'Cargo.toml',
      [
        '[workspace]',
        'default-members = ["tokio"]',
        'members = [',
        '  "tokio",',
        '  "tokio-util",',
        ']',
      ].join('\n'),
    );
    await writeFile('tokio/Cargo.toml', '[package]\nname = "tokio"\nversion = "1.0.0"\n');
    await writeFile('tokio-util/Cargo.toml', '[package]\nname = "tokio-util"\nversion = "0.7.0"\n');

    const map = resolveRustCrateMap(testDir);

    expect(map.get('tokio')).toBe('tokio/src');
    expect(map.get('tokio_util')).toBe('tokio-util/src');
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

  it('returns null for a bare crate-root import when there is no workspaceRoot/symbolName to look up an export with (#1056)', () => {
    // Before #1056 this resolved to the crate's bare `src` dir itself,
    // which fabricated a match against EVERY file the crate contains (see
    // resolveRustCrateImport's own doc comment, and the describe block
    // below for the real serde/serde_derive repro). Without a
    // workspaceRoot/symbolName to attempt a crate-root export lookup with,
    // the honest answer is "unresolved", not "the whole crate".
    const crateMap = new Map([['tokio_test', 'tokio-test/src']]);
    expect(resolveRustCrateImport('tokio_test', crateMap)).toBeNull();
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

  // #1056: a bare crate-root import (`use serde_derive::Deserialize;` -- no
  // submodule path between the crate name and the symbol) used to resolve
  // to the crate's bare `src` directory, fabricating an identical dependent
  // list for every file the crate contains. With a `workspaceRoot` on hand,
  // it now narrows to the ONE file that actually declares the symbol, via a
  // crate-root export lookup (`resolveRustCrateRootExport`), or emits
  // nothing when that can't be determined.
  describe('bare crate-root export lookup (#1056)', () => {
    let testDir: string;

    beforeEach(async () => {
      testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-rust-crate-exports-'));
    });

    afterEach(async () => {
      clearRustCrateExportCache();
      await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
    });

    async function writeFile(relPath: string, content: string): Promise<void> {
      const abs = path.join(testDir, relPath);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content);
    }

    it('resolves the serde/serde_derive repro: a proc-macro-derive name declared directly in the crate root', async () => {
      // The exact real-world shape from the issue: `Deserialize`/`Serialize`
      // are proc-macro-derive names declared directly in
      // `serde_derive/src/lib.rs` (`#[proc_macro_derive(Deserialize, ...)]`),
      // not re-exported from anywhere else in the crate.
      await writeFile(
        'serde_derive/src/lib.rs',
        [
          '#[proc_macro_derive(Deserialize, attributes(serde))]',
          'pub fn derive_deserialize(input: TokenStream) -> TokenStream {',
          '    unimplemented!()',
          '}',
          '',
          '#[proc_macro_derive(Serialize, attributes(serde))]',
          'pub fn derive_serialize(input: TokenStream) -> TokenStream {',
          '    unimplemented!()',
          '}',
        ].join('\n'),
      );
      const crateMap = new Map([['serde_derive', 'serde_derive/src']]);

      const resolved = resolveRustCrateImport('serde_derive', crateMap, testDir, 'Deserialize');
      expect(resolved).not.toBeNull();
      expect(hasRustModMarker(resolved!)).toBe(true);
      expect(stripRustModMarker(resolved!)).toBe('serde_derive/src/lib');
    });

    it('resolves a plain top-level pub item declared directly in the crate root', async () => {
      await writeFile('my_crate/src/lib.rs', 'pub fn helper() {}\n\npub struct Config {}\n');
      const crateMap = new Map([['my_crate', 'my_crate/src']]);

      expect(resolveRustCrateImport('my_crate', crateMap, testDir, 'helper')).not.toBeNull();
      expect(
        stripRustModMarker(resolveRustCrateImport('my_crate', crateMap, testDir, 'Config')!),
      ).toBe('my_crate/src/lib');
    });

    it('does not misattribute a same-named item nested inside an impl block (column-0 anchoring)', async () => {
      await writeFile(
        'my_crate/src/lib.rs',
        ['pub struct Thing;', '', 'impl Thing {', '    pub fn helper() {}', '}'].join('\n'),
      );
      const crateMap = new Map([['my_crate', 'my_crate/src']]);

      // "helper" is only ever declared INSIDE the impl block (indented), so
      // a column-0-anchored scan must not find it as a crate-root export.
      expect(resolveRustCrateImport('my_crate', crateMap, testDir, 'helper')).toBeNull();
    });

    it('falls back to main.rs when there is no lib.rs', async () => {
      await writeFile('my_bin/src/main.rs', 'pub fn run() {}\n');
      const crateMap = new Map([['my_bin', 'my_bin/src']]);

      expect(stripRustModMarker(resolveRustCrateImport('my_bin', crateMap, testDir, 'run')!)).toBe(
        'my_bin/src/main',
      );
    });

    it('returns null (honest gap) when the symbol is not found in the crate root file', async () => {
      await writeFile('my_crate/src/lib.rs', 'pub fn helper() {}\n');
      const crateMap = new Map([['my_crate', 'my_crate/src']]);

      // "helper" is real; "somethingElse" is not declared anywhere in the
      // crate root file (e.g. it's only reachable via a re-export chain
      // this v1 lookup deliberately doesn't trace -- see
      // rust-crate-exports.ts's doc comment).
      expect(resolveRustCrateImport('my_crate', crateMap, testDir, 'somethingElse')).toBeNull();
    });

    it('returns null when the crate has neither lib.rs nor main.rs', async () => {
      const crateMap = new Map([['ghost_crate', 'ghost_crate/src']]);
      expect(resolveRustCrateImport('ghost_crate', crateMap, testDir, 'Anything')).toBeNull();
    });

    it('DISTINCTNESS: two unrelated crates resolve the same symbol name to their OWN different root files', async () => {
      // The core #1056 regression check: the bug was never "wrong file",
      // it was "every file in the crate, identically" -- so the fix must
      // prove two different crates (each merely happening to export a
      // same-named symbol) resolve to their OWN distinct files, not a
      // shared fabricated answer.
      await writeFile('crate_a/src/lib.rs', 'pub fn shared_name() {}\n');
      await writeFile('crate_b/src/lib.rs', 'pub fn shared_name() {}\n');
      const crateMap = new Map([
        ['crate_a', 'crate_a/src'],
        ['crate_b', 'crate_b/src'],
      ]);

      const fromA = resolveRustCrateImport('crate_a', crateMap, testDir, 'shared_name');
      const fromB = resolveRustCrateImport('crate_b', crateMap, testDir, 'shared_name');
      expect(stripRustModMarker(fromA!)).toBe('crate_a/src/lib');
      expect(stripRustModMarker(fromB!)).toBe('crate_b/src/lib');
      expect(fromA).not.toBe(fromB);
    });
  });
});
