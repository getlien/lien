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
 *   4. The (S, T) EDGE has at least one driving symbol that also passes
 *      `isTypeShapedIdentifier` (see its doc) — a purely method-driven edge
 *      is demoted even if every individual symbol independently passed
 *      gates 1-3.
 *
 * Gate 4 is a post-ship hardening, added after adversarial re-verification
 * found that gates 1-3 alone are insufficient: "unique in this project's own
 * indexed files" does not imply "this call resolves to that declaration",
 * because Swift lets a bare method name collide with something the indexer
 * never sees at all — a stdlib protocol witness, a stdlib type's own
 * extension overload, or an external package's free function of the same
 * name. Confirmed real false positives across Alamofire/vapor/swift-
 * composable-architecture: `singleValueContainer`, `asURL`, `addTask`,
 * `flatMap`, `withDependencies` — every one a lowercase-only edge with no
 * type-shaped co-driver (see `isTypeShapedIdentifier`'s doc, and the
 * regression tests in `swift-symbol-usage-signals.test.ts`).
 *
 * Measured on real clones (see #869's PR thread for the full tables,
 * including the pre-hardening numbers and the confirmed false positives
 * above): gate 4 brings measured precision to 100% on all three calibration
 * repos, at a substantial recall cost — roughly half of the pre-hardening
 * edges are lost project-wide, including EVERY edge to Alamofire's own
 * `Request.swift` (the file that originally motivated this investigation):
 * `Request` itself is single-segment and can never serve as a type-shaped
 * driver, and none of its distinctively-named methods (`prepareForRetry`,
 * `cURLDescription`, ...) have a type-shaped symbol alongside them in the
 * tests that call them.
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

/**
 * True iff `token` reads as a TYPE reference — leading-uppercase (allowing
 * Swift's `_`-prefixed SPI/implementation-detail naming convention, e.g.
 * `_CancelID`, `_EffectPublisher` — the underscore itself carries no case
 * information) AND multi-segment — rather than a method/property name.
 *
 * Hardening (post-#869-ship, adversarial re-verification): a bare lowercase
 * METHOD name, even when uniquely DECLARED in-project, is not reliable
 * evidence a given call site actually resolves to that declaration. Swift
 * lets many independent, uninexed things share one method name — a stdlib
 * protocol witness (`Decoder.singleValueContainer()`, satisfied by every
 * conforming type, including ones outside this project entirely), a stdlib
 * TYPE extension overload (`TaskGroup.addTask(name:...)` shimming the
 * built-in `addTask`), or a same-named free function from an external
 * package dependency (`swift-dependencies`' own top-level
 * `withDependencies(_:operation:)`) — and the indexer only ever sees this
 * project's own files, so "unique in this project" silently ignores every
 * one of those. Measured on real Alamofire/vapor/swift-composable-architecture
 * clones: every confirmed false positive (`singleValueContainer`, `asURL`,
 * `addTask`, `flatMap`, `withDependencies`) was a lowercase-only edge with NO
 * type-shaped co-driver. A PascalCase, multi-segment symbol referenced via a
 * bare call (`Foo(...)`, Swift's constructor-call spelling) doesn't have this
 * problem: it names this project's own type directly, and if a same-named
 * external type existed unqualified in the same file the compiler would
 * refuse to build over the ambiguity, not silently pick one.
 *
 * Deliberately NOT a hardcoded list of risky method names (that would be a
 * denylist, and a new unindexed collision would always be one method name
 * away) — this is a structural, method-name-agnostic shape check. Exposed
 * for testing.
 */
export function isTypeShapedIdentifier(token: string): boolean {
  return /^_*[A-Z]/.test(token) && isMultiSegmentIdentifier(token);
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

/** One candidate (source, test) pairing and every distinctive symbol driving it. */
interface EdgeCandidate {
  source: string;
  test: string;
  symbols: Set<string>;
}

/** `source test` — a key uniquely identifying one edge candidate. */
function edgeKey(source: string, test: string): string {
  return `${source} ${test}`;
}

/**
 * Match one test chunk's `callSites` against `owners`, recording every
 * distinctive, uniquely-owned, non-self hit's DRIVING SYMBOL into
 * `candidates` (keyed by source+test pair — a pair may be driven by several
 * symbols, e.g. `HTTPHeaders`/`HTTPHeader` both matching `HTTPHeaders.swift`
 * from the same test file). Split out of `collectEdgeCandidates` so the
 * per-call-site gate checks aren't nested inside its own outer chunk loop.
 */
function matchTestChunkCallSites(
  chunk: CodeChunk,
  owners: Map<string, string>,
  wanted: Set<string>,
  candidates: Map<string, EdgeCandidate>,
): void {
  const testFile = chunk.metadata.file;
  for (const call of chunk.metadata.callSites ?? []) {
    if (!isDistinctiveSwiftSymbol(call.symbol)) continue;
    const owner = owners.get(call.symbol);
    if (!owner || owner === testFile || !wanted.has(owner)) continue;

    const key = edgeKey(owner, testFile);
    const candidate = candidates.get(key) ?? { source: owner, test: testFile, symbols: new Set() };
    candidate.symbols.add(call.symbol);
    candidates.set(key, candidate);
  }
}

/** Every (source, test) edge candidate, with the full set of symbols driving each. */
function collectEdgeCandidates(
  chunks: CodeChunk[],
  owners: Map<string, string>,
  wanted: Set<string>,
): Map<string, EdgeCandidate> {
  const candidates = new Map<string, EdgeCandidate>();
  for (const chunk of chunks) {
    if (detectLanguage(chunk.metadata.file) === 'swift' && isTestFile(chunk.metadata.file)) {
      matchTestChunkCallSites(chunk, owners, wanted, candidates);
    }
  }
  return candidates;
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
 * An edge is kept only when AT LEAST ONE of its driving symbols is
 * `isTypeShapedIdentifier` — see that function's doc for why a purely
 * method-driven edge isn't reliable evidence on its own (adversarial
 * re-verification post-ship found 5 confirmed false positives across
 * Alamofire/TCA, every one lowercase-method-only).
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
  const candidates = collectEdgeCandidates(chunks, owners, wanted);

  const result = new Map<string, string[]>();
  for (const { source, test, symbols } of candidates.values()) {
    const hasTypeShapedDriver = [...symbols].some(isTypeShapedIdentifier);
    if (!hasTypeShapedDriver) continue; // demote a purely method-driven edge

    const tests = result.get(source) ?? [];
    tests.push(test);
    result.set(source, tests);
  }
  return result;
}
