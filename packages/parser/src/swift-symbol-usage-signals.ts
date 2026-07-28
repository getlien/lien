/**
 * #869 measure-gated spike: a deterministic, zero-LLM symbol-usage signal for
 * Swift/XCTest test association.
 *
 * Swift test files import their subject as a whole module (`import
 * Alamofire`, `@testable import Alamofire`) rather than a specific file or
 * symbol path (see `LanguageDefinition.wholeModuleImports`), so import-based
 * matching (`findTestAssociationsFromChunks`) is structurally blind for this
 * entire language family — every test file in a module carries the identical
 * bare-module import string. This module recovers a DIFFERENT, non-import
 * signal already sitting in the indexed chunk store: a test chunk's own
 * `callSites` (the AST-extracted symbols it references) versus which single
 * source file uniquely DEFINES that symbol.
 *
 * Association rule (test T -> source S): T's chunk references a symbol X via
 * `callSites` such that:
 *   1. X passes `isDistinctiveSwiftSymbol` — the shipped `isUnambiguousIdentifierShape`
 *      gate AND this module's own, stricter `isMultiSegmentIdentifier` gate
 *      (see that function's doc for why the shipped gate alone passes nearly
 *      every ordinary English word and is insufficient here).
 *   2. X is defined in EXACTLY ONE non-test Swift file project-wide (S) — see
 *      `buildSwiftDefinitionMap`, which also excludes `extension <ForeignType>`
 *      declarations from counting as a definition (see its doc for why).
 *   3. S !== T.
 *
 * Measured on a real Alamofire/Alamofire clone (#869 design comment): 52
 * edges, ~88% precision, ~96% after the extension-exclusion filter — all 6
 * residual false positives were extensions of Foundation types
 * (`HTTPURLResponse`, `URLComponents`, `OperationQueue`, `NSNumber`,
 * `JSONDecoder`).
 *
 * This is a strictly ADDITIVE, lower-confidence THIRD tier — never merged
 * into the confident import-based association
 * (`findTestAssociationsFromChunks`) or Go's same-directory tier 2
 * (`go-same-directory-tests.ts`). Mirrors that same tier's discipline: kept
 * out of `get_files_context`, `@liendev/review`'s gap detection, and
 * `verify-tests`'s ledger/scope-matching — surfaced only via `lien annotate`
 * (see `annotate-cmd.ts`'s `computeSwiftSymbolUsageFallback`, the sole
 * caller).
 */

import type { CodeChunk } from './types.js';
import { isTestFile } from './utils/path-matching.js';
import { detectLanguage } from './ast/languages/registry.js';
import { isUnambiguousIdentifierShape } from './doc-reference-matching.js';

// ---------------------------------------------------------------------------
// Distinctiveness: multi-segment identifier gate
// ---------------------------------------------------------------------------

/**
 * Split `token` into its camelCase/PascalCase/underscore segments. Only the
 * segment COUNT matters to callers, so case is preserved and digits are left
 * alone (unlike core's `deriveSymbolTokens`, which this intentionally does
 * NOT import/share — `@liendev/parser` has zero dependency on `@liendev/core`,
 * see CLAUDE.md's package dependency chain — so this is a small, independent
 * duplicate of the same camelCase-boundary regex shape).
 */
function splitIdentifierSegments(token: string): string[] {
  return token
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // fooBar -> foo Bar
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // HTTPServer -> HTTP Server
    .split(/[_\s]+/)
    .filter(Boolean);
}

/**
 * True iff `token` has AT LEAST 2 camelCase/PascalCase/underscore segments —
 * the shape that separates a real, collision-resistant identifier
 * (`TypeMap`, `getStatusCode`, `RetryMiddleware`, `HTTPHeaders`) from a single
 * ordinary Capitalized English word (`Get`, `Run`, `Map`, `Session`, `Client`).
 *
 * Measured necessity (#869 design comment): the shipped
 * `isUnambiguousIdentifierShape` (docRefs' gate) passes EVERY single
 * Capitalized word trivially — its case-transition check is satisfied by the
 * very first two characters of any Capitalized word (`Ge` in `Get`, `Se` in
 * `Session`), which was never a problem for its original prose-vs-code
 * distinction but makes it useless as a COLLISION-resistance gate here. A
 * single Capitalized common word is exactly the shape most likely to also be
 * a stdlib/Foundation type or an unrelated project symbol — this gate must
 * reject those outright, never leaving it to the uniqueness check alone.
 * Deliberately does NOT touch or weaken `isUnambiguousIdentifierShape` itself
 * (docRefs' prose-vs-code distinction is a different property) — this is an
 * additional, stricter helper applied only by this signal. Exposed for
 * testing.
 */
export function isMultiSegmentIdentifier(token: string): boolean {
  return splitIdentifierSegments(token).length >= 2;
}

/** Both distinctiveness gates the design requires, ANDed together (see module doc). */
function isDistinctiveSwiftSymbol(token: string): boolean {
  return isUnambiguousIdentifierShape(token) && isMultiSegmentIdentifier(token);
}

// ---------------------------------------------------------------------------
// Definition side: unique ownership, excluding foreign-type extensions
// ---------------------------------------------------------------------------

/**
 * True iff `chunk` is a Swift `extension <Type> { ... }` declaration — the
 * same `class_declaration` node Swift's extractor uses for real class/struct/
 * actor/enum declarations, distinguished only by its `extension `-prefixed
 * signature (see `swift.ts`'s `declarationKeyword`/`extractClassInfo`).
 */
function isSwiftExtensionDeclaration(chunk: CodeChunk): boolean {
  return (
    chunk.metadata.symbolType === 'class' &&
    (chunk.metadata.signature ?? '').startsWith('extension ')
  );
}

interface SwiftDeclaration {
  file: string;
  symbol: string;
  isExtension: boolean;
}

/** Non-test Swift chunks that carry a definition-worthy symbol name. */
function collectSwiftDeclarations(chunks: CodeChunk[]): SwiftDeclaration[] {
  const out: SwiftDeclaration[] = [];
  for (const chunk of chunks) {
    const file = chunk.metadata.file;
    if (detectLanguage(file) !== 'swift' || isTestFile(file)) continue;
    const symbol = chunk.metadata.symbolName;
    if (!symbol) continue;
    out.push({ file, symbol, isExtension: isSwiftExtensionDeclaration(chunk) });
  }
  return out;
}

/**
 * Build symbol -> defining file(s), excluding `extension <ForeignType>`
 * declarations — a type extended but never actually DECLARED (as a real
 * class/struct/actor/enum/protocol) anywhere in the project. This is the one
 * principled, non-denylist false-positive filter the #869 design comment
 * requires: a Foundation/stdlib type like `HTTPURLResponse` only ever shows
 * up in the indexed corpus via an `extension HTTPURLResponse { ... }` chunk
 * (there is no real declaration to index — it lives outside the project), so
 * "every declaration of X in this project is an extension" IS the foreign-type
 * test, with no hardcoded list of framework type names required. An
 * extension of an IN-PROJECT type (one that also has a real, non-extension
 * declaration somewhere) is not excluded by this rule.
 */
function buildSwiftDefinitionMap(declarations: SwiftDeclaration[]): Map<string, Set<string>> {
  const realDeclarationSymbols = new Set(
    declarations.filter(d => !d.isExtension).map(d => d.symbol),
  );
  const defMap = new Map<string, Set<string>>();
  for (const decl of declarations) {
    if (decl.isExtension && !realDeclarationSymbols.has(decl.symbol)) continue; // foreign-type extension
    const files = defMap.get(decl.symbol) ?? new Set<string>();
    files.add(decl.file);
    defMap.set(decl.symbol, files);
  }
  return defMap;
}

/** Symbols uniquely defined (exactly one file) across `defMap`, mapped to that file. */
function uniqueOwners(defMap: Map<string, Set<string>>): Map<string, string> {
  const owners = new Map<string, string>();
  for (const [symbol, files] of defMap) {
    if (files.size === 1) owners.set(symbol, [...files][0]);
  }
  return owners;
}

// ---------------------------------------------------------------------------
// Usage side: test callSites -> uniquely-owned distinctive symbols
// ---------------------------------------------------------------------------

/** Record `testFile` as a match for `owner` in `result`, deduping. */
function recordUsageMatch(result: Map<string, string[]>, owner: string, testFile: string): void {
  const tests = result.get(owner) ?? [];
  if (!tests.includes(testFile)) tests.push(testFile);
  result.set(owner, tests);
}

/**
 * Match one test chunk's `callSites` against `owners`, recording any
 * distinctive, uniquely-owned, non-self hit into `result`. Split out of
 * `findSwiftSymbolUsageAssociations` so the per-call-site gate checks aren't
 * nested inside that function's own outer chunk loop.
 */
function matchTestChunkCallSites(
  chunk: CodeChunk,
  owners: Map<string, string>,
  wanted: Set<string>,
  result: Map<string, string[]>,
): void {
  const testFile = chunk.metadata.file;
  for (const call of chunk.metadata.callSites ?? []) {
    if (!isDistinctiveSwiftSymbol(call.symbol)) continue;
    const owner = owners.get(call.symbol);
    if (!owner || owner === testFile || !wanted.has(owner)) continue;
    recordUsageMatch(result, owner, testFile);
  }
}

/**
 * Find Swift test files whose `callSites` reference a distinctive symbol
 * uniquely owned by one of `filepaths`. Returns `Map<sourceFile, testFile[]>`
 * — the same shape as `findTestAssociationsFromChunks`, so callers can slot
 * it in identically (see `computeSwiftSymbolUsageFallback` in
 * `annotate-cmd.ts` for the sole caller). Only ever meaningful for Swift;
 * non-Swift chunks are ignored on both the definition and usage side (the
 * design's explicit "same language" gate).
 *
 * `chunks` should be the FULL project chunk set — uniqueness is a
 * project-wide property, not scoped to `filepaths`.
 */
export function findSwiftSymbolUsageAssociations(
  filepaths: string[],
  chunks: CodeChunk[],
): Map<string, string[]> {
  const owners = uniqueOwners(buildSwiftDefinitionMap(collectSwiftDeclarations(chunks)));
  const wanted = new Set(filepaths);

  const result = new Map<string, string[]>();
  for (const chunk of chunks) {
    if (detectLanguage(chunk.metadata.file) === 'swift' && isTestFile(chunk.metadata.file)) {
      matchTestChunkCallSites(chunk, owners, wanted, result);
    }
  }
  return result;
}
