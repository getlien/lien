import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { resolveRustCrateRootExport, clearRustCrateExportCache } from './rust-crate-exports.js';
import { hasRustModMarker, stripRustModMarker } from './utils/rust-mod-marker.js';

describe('resolveRustCrateRootExport', () => {
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

  function resolveAndStrip(crateDir: string, symbolName: string): string | null {
    const resolved = resolveRustCrateRootExport(testDir, crateDir, symbolName);
    if (resolved === null) return null;
    expect(hasRustModMarker(resolved)).toBe(true);
    return stripRustModMarker(resolved);
  }

  it('resolves a proc-macro-derive name declared directly in the crate root (the serde_derive repro)', async () => {
    await writeFile(
      'my_crate/src/lib.rs',
      [
        '#[proc_macro_derive(Deserialize, attributes(serde))]',
        'pub fn derive_deserialize(input: TokenStream) -> TokenStream {',
        '    unimplemented!()',
        '}',
      ].join('\n'),
    );

    expect(resolveAndStrip('my_crate/src', 'Deserialize')).toBe('my_crate/src/lib');
  });

  it('resolves a plain top-level pub fn/struct/enum/trait/type/const/static/mod', async () => {
    await writeFile(
      'my_crate/src/lib.rs',
      [
        'pub fn helper() {}',
        'pub struct Config {}',
        'pub enum Status {}',
        'pub trait Doer {}',
        'pub type Alias = u32;',
        'pub const VALUE: u32 = 1;',
        'pub static GLOBAL: u32 = 2;',
        'pub mod submodule;',
      ].join('\n'),
    );

    for (const name of [
      'helper',
      'Config',
      'Status',
      'Doer',
      'Alias',
      'VALUE',
      'GLOBAL',
      'submodule',
    ]) {
      expect(resolveAndStrip('my_crate/src', name)).toBe('my_crate/src/lib');
    }
  });

  // Lien Review finding (PR #1065): the original regex required `fn`/`trait`/
  // etc. immediately after the visibility modifier, so `pub async fn`/`pub
  // const fn`/`pub unsafe fn`/`pub unsafe trait` silently failed to match at
  // all -- an honest gap, but a wrong one for a common Rust shape.
  it('resolves pub items with async/const/unsafe/extern modifiers between `pub` and the declaration keyword', async () => {
    await writeFile(
      'my_crate/src/lib.rs',
      [
        'pub async fn fetch() {}',
        'pub const fn compute() -> u32 { 1 }',
        'pub unsafe fn danger() {}',
        'pub unsafe trait Marker {}',
        'pub const unsafe fn both() -> u32 { 2 }',
        'pub unsafe extern "C" fn ffi_call() {}',
      ].join('\n'),
    );

    expect(resolveAndStrip('my_crate/src', 'fetch')).toBe('my_crate/src/lib');
    expect(resolveAndStrip('my_crate/src', 'compute')).toBe('my_crate/src/lib');
    expect(resolveAndStrip('my_crate/src', 'danger')).toBe('my_crate/src/lib');
    expect(resolveAndStrip('my_crate/src', 'Marker')).toBe('my_crate/src/lib');
    expect(resolveAndStrip('my_crate/src', 'both')).toBe('my_crate/src/lib');
    expect(resolveAndStrip('my_crate/src', 'ffi_call')).toBe('my_crate/src/lib');
  });

  it('still resolves a plain `pub const NAME: T = ...;` item despite `const` also being a valid modifier keyword', async () => {
    await writeFile('my_crate/src/lib.rs', 'pub const VALUE: u32 = 42;\n');

    expect(resolveAndStrip('my_crate/src', 'VALUE')).toBe('my_crate/src/lib');
  });

  it('does not misattribute a same-named item nested inside an impl block (column-0 anchoring)', async () => {
    await writeFile(
      'my_crate/src/lib.rs',
      ['pub struct Thing;', '', 'impl Thing {', '    pub fn helper() {}', '}'].join('\n'),
    );

    // "helper" is only ever declared INSIDE the impl block (indented), so a
    // column-0-anchored scan must not find it as a crate-root export.
    expect(resolveRustCrateRootExport(testDir, 'my_crate/src', 'helper')).toBeNull();
  });

  it('falls back to main.rs when there is no lib.rs', async () => {
    await writeFile('my_bin/src/main.rs', 'pub fn run() {}\n');

    expect(resolveAndStrip('my_bin/src', 'run')).toBe('my_bin/src/main');
  });

  it('returns null (honest gap) when the symbol is not found in the crate root file', async () => {
    await writeFile('my_crate/src/lib.rs', 'pub fn helper() {}\n');

    // "helper" is real; "somethingElse" is not declared anywhere in the
    // crate root file (e.g. only reachable via a re-export chain this v1
    // lookup deliberately doesn't trace).
    expect(resolveRustCrateRootExport(testDir, 'my_crate/src', 'somethingElse')).toBeNull();
  });

  it('returns null when the crate has neither lib.rs nor main.rs', () => {
    expect(resolveRustCrateRootExport(testDir, 'ghost_crate/src', 'Anything')).toBeNull();
  });

  it('DISTINCTNESS: two unrelated crates resolve the same symbol name to their OWN different root files', async () => {
    await writeFile('crate_a/src/lib.rs', 'pub fn shared_name() {}\n');
    await writeFile('crate_b/src/lib.rs', 'pub fn shared_name() {}\n');

    const fromA = resolveAndStrip('crate_a/src', 'shared_name');
    const fromB = resolveAndStrip('crate_b/src', 'shared_name');

    expect(fromA).toBe('crate_a/src/lib');
    expect(fromB).toBe('crate_b/src/lib');
    expect(fromA).not.toBe(fromB);
  });

  it('caches the export map per (workspaceRoot, crateDir)', async () => {
    await writeFile('my_crate/src/lib.rs', 'pub fn helper() {}\n');

    const first = resolveRustCrateRootExport(testDir, 'my_crate/src', 'helper');
    // Rewrite the file after the first lookup -- a cached result should be
    // unaffected (mirrors resolveRustCrateMap's own caching contract).
    await writeFile('my_crate/src/lib.rs', 'pub fn renamed() {}\n');
    const second = resolveRustCrateRootExport(testDir, 'my_crate/src', 'helper');

    expect(second).toBe(first);
    expect(resolveRustCrateRootExport(testDir, 'my_crate/src', 'renamed')).toBeNull();
  });
});
