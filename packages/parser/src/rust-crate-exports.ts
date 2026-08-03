import fs from 'fs';
import path from 'path';

import { markRustModSpecifier } from './utils/rust-mod-marker.js';

/**
 * Resolves a symbol name to the ONE file, within a known workspace crate,
 * that actually declares/exports it -- read directly from the crate's own
 * root file (`lib.rs`/`main.rs`), rather than crediting the whole crate
 * directory (#1056).
 *
 * Why this exists: `use serde_derive::Deserialize;` (a cross-crate import
 * naming only the crate + a symbol, no submodule path -- the ordinary shape
 * for consuming what a crate's `lib.rs` re-exports) gives
 * `resolveRustCrateImport` (`./rust-crate-map.ts`) a module path with nothing
 * left to strip after the crate name (`rest === ''`). Falling back to the
 * bare `crateDir` there -- as this codebase did before #1056 -- turns "which
 * ONE file exports this symbol" into "every file in the crate", via
 * `matchesFile`'s Go-style package-directory leniency (`singleFileImports:
 * false` on Rust's `LanguageDefinition`, needed elsewhere for legitimate
 * `crate::`-relative imports): a bare multi-segment specifier like
 * `serde_derive/src` matches ANY target continuing past it at a `/`
 * boundary, i.e. literally every file the crate contains. Confirmed on a
 * real `serde-rs/serde` clone: `serde_derive/src/de.rs` and
 * `serde_derive/src/dummy.rs` -- two unrelated files with nothing to do with
 * each other -- returned the IDENTICAL 144-file dependent list, because
 * every consumer of `serde_derive::{Deserialize, Serialize}` (`serde/src/
 * lib.rs`'s own re-export, plus 143 `test_suite/tests/**` fixtures) resolved
 * to that one bare crate-wide specifier.
 *
 * v1 scope (deliberately KISS/YAGNI, matching #903's precedent for this same
 * file): only ONE hop, read directly off the crate's own root file text --
 * no re-export CHAIN tracing (`pub use` in `lib.rs` pointing at a symbol
 * that's itself only re-exported ANOTHER level down). Two shapes resolve:
 *
 * 1. A top-level (column-0, i.e. not nested inside an `impl`/`fn`/`mod`
 *    body) `pub` item -- `fn`/`struct`/`enum`/`trait`/`type`/`const`/
 *    `static`/`mod` -- declared BY NAME directly in the root file. Anchoring
 *    to column 0 is a deliberate, cheap way to avoid a same-named nested
 *    item (e.g. a method inside an `impl` block) being misread as a crate-
 *    root export -- idiomatic (`cargo fmt`-formatted) Rust never indents a
 *    top-level item, so this is a safe, high-precision heuristic rather than
 *    a full parse.
 * 2. A `#[proc_macro_derive(Name, ...)]`-annotated function -- the derive
 *    macro's PUBLIC name is the identifier inside the attribute, not the
 *    underlying function's own name, and the Rust compiler requires these to
 *    be declared at the crate root (E0725), so this is unconditionally safe
 *    to treat as a root-level export regardless of indentation. This is the
 *    EXACT shape that resolves the serde/serde_derive repro above: `serde_
 *    derive::Deserialize`/`Serialize` are proc-macro-derive names declared
 *    directly in `serde_derive/src/lib.rs`, not re-exported from anywhere
 *    else in the crate.
 *
 * Anything else -- most commonly a symbol that's only reachable via a `pub
 * use` re-export chain through an intermediate module -- returns `null`
 * (`resolveRustCrateImport`'s caller then emits nothing for that specifier,
 * rather than a fabricated match): an honest gap beats a fabricated one, per
 * this codebase's index-state-honesty policy. A future enhancement could
 * trace ONE level of `pub use crate::x::Name;`/`pub use self::x::{A, B}`
 * re-exports too; deliberately out of scope here since the reported bug's
 * exact repro (proc-macro-derive names) doesn't need it and a half-traced
 * re-export chain is its own new fabrication risk to get right.
 *
 * The resolved path is tagged with `markRustModSpecifier` (reused from
 * #1021's `mod x;` fix -- see `./utils/rust-mod-marker.ts`'s doc comment):
 * it names EXACTLY one file (never a directory whose children should also
 * match), the identical guarantee `mod x;` resolution already relies on that
 * marker for, so `matchesRustModSpecifier`'s exact-or-`/mod`-suffix matching
 * is the correct (and only safe) way to resolve it downstream too.
 */

/**
 * Per-workspace-root cache of per-crate-directory export maps (symbol name ->
 * resolved file). Nested (rather than a single Map with a concatenated
 * string key) to sidestep needing a separator character that's guaranteed
 * never to collide between a `workspaceRoot` and a `crateDir`.
 */
const rootExportCache = new Map<string, Map<string, Map<string, string> | null>>();

/** Clears the cached crate-root export maps. Exported for test isolation. */
export function clearRustCrateExportCache(): void {
  rootExportCache.clear();
}

/** A `#[proc_macro_derive(Name` (optionally followed by `, attributes(...)`) attribute's `Name`. */
const PROC_MACRO_DERIVE_RE = /^\s*#\s*\[\s*proc_macro_derive\s*\(\s*([A-Za-z_]\w*)/gm;

/**
 * A top-level (column-0, i.e. un-indented) `pub` item declaration --
 * `pub fn foo`, `pub(crate) struct Bar`, `pub async fn foo`, `pub unsafe
 * extern "C" fn foo`, etc. Anchored to the start of the line (no leading
 * whitespace) so a same-named item nested inside an `impl`/`fn`/`mod` body --
 * always indented in idiomatic Rust -- isn't mistaken for a crate-root
 * export (see this file's doc comment).
 *
 * Allows any of `async`/`const`/`unsafe`/`extern "ABI"` between the
 * visibility modifier and the declaration keyword (Rust lets these combine,
 * e.g. `pub const unsafe fn`, `pub unsafe extern "C" fn`) -- without this,
 * `pub async fn helper()` failed to match at all (`async` isn't itself one
 * of the declaration keywords), silently dropping `helper` from the export
 * map and resolving `use my_crate::helper;` to `null` instead of the crate
 * root file. `const` doing double duty (both a modifier, `pub const fn`, and
 * a standalone item keyword, `pub const NAME: T = ...;`) is resolved by
 * ordinary regex backtracking: greedily consuming it as a modifier fails the
 * mandatory keyword alternation for a plain const item (no `fn`/`struct`/...
 * follows), so the engine backs off to zero modifiers and matches `const`
 * itself as the item keyword instead.
 */
const TOP_LEVEL_PUB_ITEM_RE =
  /^pub(?:\([^)]*\))?\s+(?:(?:async|const|unsafe|extern(?:\s+"[^"]*")?)\s+)*(?:fn|struct|enum|trait|type|const|static|mod)\s+([A-Za-z_]\w*)/gm;

/** Every name this crate root file exports directly (see the two shapes in the file's doc comment). */
function collectRootExportNames(content: string): Set<string> {
  const names = new Set<string>();
  for (const match of content.matchAll(PROC_MACRO_DERIVE_RE)) names.add(match[1]);
  for (const match of content.matchAll(TOP_LEVEL_PUB_ITEM_RE)) names.add(match[1]);
  return names;
}

/** The crate's root file (`lib.rs`, else `main.rs`) — its content and its own extensionless, workspace-relative path — or `null` if neither exists. */
function readCrateRootFile(
  workspaceRoot: string,
  crateDir: string,
): { relPath: string; content: string } | null {
  for (const rootBasename of ['lib.rs', 'main.rs']) {
    const relPath = `${crateDir}/${rootBasename}`;
    try {
      const content = fs.readFileSync(path.join(workspaceRoot, relPath), 'utf-8');
      return { relPath: relPath.replace(/\.rs$/, ''), content };
    } catch {
      continue;
    }
  }
  return null;
}

/** Build (uncached) the symbol -> resolved-file map for one crate's root file. */
function buildRootExportMap(workspaceRoot: string, crateDir: string): Map<string, string> | null {
  const rootFile = readCrateRootFile(workspaceRoot, crateDir);
  if (!rootFile) return null;

  const names = collectRootExportNames(rootFile.content);
  if (names.size === 0) return null;

  const map = new Map<string, string>();
  for (const name of names) map.set(name, rootFile.relPath);
  return map;
}

/** The cached (or newly-built) export map for one `(workspaceRoot, crateDir)` pair. */
function getRootExportMap(workspaceRoot: string, crateDir: string): Map<string, string> | null {
  let byCrateDir = rootExportCache.get(workspaceRoot);
  if (!byCrateDir) {
    byCrateDir = new Map();
    rootExportCache.set(workspaceRoot, byCrateDir);
  }

  let exportMap = byCrateDir.get(crateDir);
  if (exportMap === undefined) {
    exportMap = buildRootExportMap(workspaceRoot, crateDir);
    byCrateDir.set(crateDir, exportMap);
  }
  return exportMap;
}

/**
 * Resolve `symbolName` to the specific (marked, exact-match-only) file that
 * declares it in `crateDir`'s own root file, or `null` when it can't be
 * determined from that file alone.
 *
 * @param workspaceRoot - Absolute path to the project root.
 * @param crateDir - The crate's `src/`-relative directory, from
 *   `resolveRustCrateMap` (e.g. `serde_derive/src`).
 * @param symbolName - The symbol being imported (e.g. `Deserialize`).
 */
export function resolveRustCrateRootExport(
  workspaceRoot: string,
  crateDir: string,
  symbolName: string,
): string | null {
  const resolved = getRootExportMap(workspaceRoot, crateDir)?.get(symbolName);
  return resolved ? markRustModSpecifier(resolved) : null;
}
