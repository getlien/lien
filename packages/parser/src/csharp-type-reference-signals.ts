/**
 * #930 (part 2, widened): recover REAL dependents for a C# file when the
 * import graph finds none, because of `global using` / implicit enclosing-
 * namespace access (see `csharp.ts`'s `isGlobalUsingDirective` and
 * `enclosingNamespaceAccess` doc comments for the mechanism -- a file that
 * genuinely uses a type declared elsewhere carries NO per-file import
 * naming it at all).
 *
 * The import graph is structurally the wrong place to look for this: the
 * information lives in type references, not import statements. This module
 * recovers a DIFFERENT signal already sitting in the indexed chunk store: a
 * type's declaring file, matched against every other C# chunk's raw source
 * text for an identifier-boundary occurrence of that type's name.
 *
 * Two resolution tiers run for every query, both feeding the same returned
 * dependent set:
 *
 * TIER 1 -- global uniqueness (source S declares type T -> dependent D references T):
 *   1. T is declared (`class`/`struct`/`interface`/`record`/`enum`) in
 *      EXACTLY ONE C# file project-wide (S) -- see
 *      `buildCSharpTypeOwnerMap`/`uniqueCSharpTypeOwners`. Ambiguous
 *      (multiply-declared) names fall through to tier 2, never guessed at
 *      here.
 *   2. D (any other C# chunk, production or test) contains an
 *      identifier-boundary occurrence of T's name in its raw source text
 *      (`identifierBoundaryRe` below -- plain `\b` semantics, deliberately
 *      NOT `doc-reference-matching.ts`'s `wordBoundaryRe`: that primitive
 *      treats `.`/`-` as identifier-CONTINUATION characters, correct for
 *      markdown path/prose matching but wrong here -- `Alignment.Apply(...)`
 *      and `pt.Alignment.HasValue` are the DOMINANT real C# usage shapes
 *      (static member access, property access), and in both a `.`
 *      genuinely DELIMITS `Alignment` from its neighbor rather than
 *      continuing the same token).
 *   3. D !== S.
 *
 * S is no longer required to be a non-test file (widened from the original
 * #930-part-2 shape): measured against serilog/serilog, 53 of the corpus's
 * 216 `.cs` files were EXCLUSIVELY test-declared types (test helper
 * fixtures like `DummyRollingFileSink.cs`, `CollectingSink.cs`) that real
 * OTHER test files genuinely reference -- excluding test files from the
 * declaring side made `get_dependents` report "not determinable" on all 53
 * even though the reference is exactly as textually unambiguous as a
 * production one. D was already allowed to be test-or-production (point 2
 * above); restricting only S was an asymmetry with no precision benefit --
 * the SAME uniqueness gate still drops a name if it collides with anything
 * else project-wide, test or production.
 *
 * TIER 2 -- namespace-scoped shadow resolution (new): for a type name T that
 * IS ambiguous globally (declared in more than one file), C# does not
 * actually leave the reference unresolvable -- real C# resolves an
 * unqualified name via lexical namespace scoping: a reference in namespace
 * `Serilog.Core` sees unqualified members of `Serilog.Core` itself AND every
 * ENCLOSING namespace (`Serilog`, the global namespace), never a sibling or
 * descendant namespace, and when more than one visible declaration shares the
 * name, the INNERMOST (closest-enclosing) one wins (real C# shadowing).
 * `enclosingNamespaceChain` implements this by decomposing the dotted
 * namespace string into progressively shorter prefixes -- valid because a
 * dotted namespace declaration (`namespace Serilog.Core.Foo`) is defined by
 * the C# spec to behave identically to nested blocks
 * (`namespace Serilog { namespace Core { namespace Foo { ... } } }`).
 *
 * For each ambiguous name T that `targetFile` declares in namespace N: every
 * OTHER C# file D whose own namespace's enclosing chain contains N, where no
 * OTHER declaration of T sits at an equal-or-closer position in that same
 * chain (i.e. targetFile's declaration is the unique closest/winning one for
 * D specifically), and whose text contains a word-boundary match of T, is
 * recovered as a dependent of `targetFile`. A referencer whose chain contains
 * TWO declarations of T at the same depth (a genuine same-namespace name
 * clash) is dropped for that name, matching tier 1's "never guess" rule.
 *
 * Both tiers need each file's own namespace. Getting it costs NO schema
 * change: rather than adding a persisted `namespace` field (a real SQLite
 * column + `INDEX_FORMAT_VERSION` bump + migration), `deriveCSharpNamespace`
 * recovers it from already-indexed chunk CONTENT -- a namespace declaration
 * line (block-style `namespace Foo.Bar {` or C# 10 file-scoped
 * `namespace Foo.Bar;`) sits in a file's own "uncovered" chunk (the gap
 * before/around its first real declaration -- see `chunker.ts`'s
 * `extractUncoveredCode`), which already carries the raw source text.
 * Measured against serilog/serilog: 205/216 files (95%) yield a derivable
 * namespace this way. The 11 misses are files with no namespace at all
 * (`GlobalUsings.cs`, `AssemblyInfo.cs`) or short internal-only (non-public,
 * so no `exports`, so the uncovered range can fall under the chunker's
 * `minChunkSize` and get dropped) files -- `deriveCSharpNamespace` returns
 * `undefined` rather than guessing for these, and both tiers treat "namespace
 * not determinable" as "skip this file as a scoping candidate," never as
 * "assume the global namespace." Failing to determine a namespace can only
 * ever suppress a recovery, never fabricate one.
 *
 * Why uniqueness alone is a strong enough gate for tier 1, unlike Swift's
 * call-site symbol matching (`swift-symbol-usage-signals.ts`, #869): that
 * signal had to additionally demote purely-lowercase-method-driven edges,
 * because a bare METHOD name can collide with a stdlib protocol witness, an
 * external package's same-named free function, or a same-named overload the
 * indexer never sees. A bare TYPE name referenced unqualified doesn't have
 * that problem in the same way: if a same-named external type were in
 * unqualified scope at the same point, the C# compiler would refuse to
 * build over the ambiguity rather than silently resolving one -- so "this
 * project's only declaration of the name" is a much stronger match for "the
 * declaration this reference actually resolves to" than it is for a method
 * name. This module intentionally does NOT add Swift's multi-segment/
 * type-shaped gates on top: every candidate here is already a real type
 * declaration by construction (never a method/property name), so that
 * problem class doesn't arise.
 *
 * What this does NOT solve: a word-boundary text match cannot distinguish a
 * genuine type reference from an unrelated PROPERTY, FIELD, or PARAMETER
 * that happens to share the exact same identifier (C# convention often
 * names a property after its type, e.g. `Alignment? Alignment { get; }` on
 * `PropertyToken` -- see the fixture below; this is actually the common
 * case, not a false positive, but the matcher can't tell the two apart in
 * principle). Nor can it catch a reference via an alias (`using A =
 * Some.Alignment;`), a generic type argument written without the bare name
 * on its own line in an unusual way, or reflection-based usage. Tier 2 adds
 * one more limitation on top: it can only place a referencing FILE in the
 * namespace hierarchy when `deriveCSharpNamespace` succeeds for it, and a
 * TRUE nested-block declaration split across multiple physical `namespace`
 * lines in one file (`namespace A { namespace B { ... } }`, vanishingly rare
 * in modern C#) is read as just its outermost segment, not the full nested
 * path -- again a fail-safe direction (a missed recovery, never a fabricated
 * one). Residual risk is accepted and hedged, not eliminated -- callers must
 * surface this as a lower-confidence, non-import-verified signal (see
 * `DependentInfo.confidence` in `dependency-analyzer.ts`), never fold it in
 * unhedged next to a real import edge.
 *
 * Verified against a real clone (serilog/serilog, the corpus that motivated
 * #930): word-boundary matching for `Alignment` and `Padding` -- both
 * uniquely-declared, single-segment PascalCase type names, the exact shape
 * most likely to collide with an unrelated identifier -- reproduced all 5
 * known real dependents of `Alignment.cs` (plus its one real test
 * dependent) with ZERO false positives project-wide (checked via
 * `grep -rlw` across the entire `src`+`test` tree, not just the 5 known
 * files).
 *
 * Originally scoped to file-level `get_dependents` recovery only (via this
 * package's `dependency-analyzer.ts`) -- #930's gap was specifically that
 * `get_dependents` itself reported a false `dependentCount: 0` /
 * `riskLevel: "low"` "all clear" on a file that has 5 real callers, which an
 * honesty label (`dependentAttributionIncomplete`, #936) already covered for
 * the "we don't know" case; this module is what lets the tool answer "we
 * found some" instead, when it genuinely can.
 *
 * #1040 widens this to test-association too: this is the SAME mechanism
 * that lets a C# test file in a nested namespace (`MediatR.Tests`) reach its
 * subject's types (`MediatR`) with no `using` directive at all -- the exact
 * shape Go's `sameDirectoryTestConvention` and Java's `samePackageTestConvention`
 * exist to paper over for their own no-import test conventions. Rather than
 * a THIRD, independent namespace notion for test-association specifically,
 * `test-associations.ts` (and `get_files_context`) reuse
 * `buildCSharpTypeReferenceIndex`/`resolveCSharpTypeReferenceDependents`
 * directly, filtering the recovered dependents down to the test-file subset
 * -- see those call sites for the measured MediatR corpus numbers.
 */

import type { CodeChunk } from './types.js';
import { isTestFile } from './utils/path-matching.js';
import { detectLanguage } from './ast/languages/registry.js';

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Plain identifier-boundary regex for `name` -- see the module doc comment
 * for why this must NOT be `doc-reference-matching.ts`'s `wordBoundaryRe`.
 * Standard `\b` semantics (word chars = `[A-Za-z0-9_]`) are exactly right
 * for source code: `.`, `(`, `?`, whitespace, etc. are all genuine
 * identifier delimiters in C#, never continuations of the same token.
 */
function identifierBoundaryRe(name: string): RegExp {
  return new RegExp(`\\b${escapeForRegex(name)}\\b`);
}

/**
 * True iff `chunk` is a TOP-LEVEL C# type declaration
 * (class/struct/record/enum/interface).
 *
 * Checking only `'class' | 'interface'` is NOT a narrower test than the doc says:
 * `csharp.ts` collapses `class_declaration`, `interface_declaration`,
 * `struct_declaration`, `record_declaration` and `enum_declaration` into one case,
 * so all five kinds surface as `'class'` (or `'interface'`). There is no distinct
 * `'struct'`/`'record'`/`'enum'` symbolType to miss.
 *
 * Verified empirically rather than assumed: serilog's `public readonly struct
 * Alignment` reports `symbolType: 'class'`, and its dependents are recovered.
 *
 * The filter is load-bearing for the uniqueness gate, not decoration. In the same
 * corpus `Alignment` ALSO appears twice with `symbolType: 'method'` (a property on
 * `PropertyToken` and one on the struct itself). Without restricting the declaration
 * set to types, those would break the "exactly one file declares this name" check
 * and suppress a real recovery.
 *
 * A NESTED type (`chunk.metadata.parentClass` set) declared in a TEST file is
 * additionally excluded. A nested type's bare name is governed by
 * containing-TYPE membership, not namespace membership (you need to be
 * lexically inside the enclosing type -- including another file's
 * declaration of the SAME `partial` type -- or write `Outer.Nested`
 * explicitly, to reference it unqualified), a resolution axis this module
 * doesn't model at all; a test file's own nested type is disproportionately
 * likely to be a throwaway, genericly-named local test-double, so this is
 * where that unmodeled risk is most worth cutting off. Both measured on
 * serilog/serilog, from widening tier 1's declaring-file set to include test
 * files (see the module doc):
 *   - Excluding TEST-nested types fixes a real regression: a top-level
 *     PRODUCTION class `Serilog.Policies.ProjectedDestructuringPolicy` lost
 *     its 2 previously-recovered dependents because
 *     `LoggerConfigurationTests.cs` happens to declare an unrelated NESTED
 *     test-double class of the identical name.
 *   - NOT also excluding PRODUCTION-nested types matters just as much: a
 *     nested class can legitimately live in its OWN file as a `partial`
 *     continuation of its enclosing type (`DepthLimiter.cs` declares
 *     `partial class PropertyValueConverter { class DepthLimiter { ... } }`),
 *     making the nested name directly, unqualifiedly visible from
 *     `PropertyValueConverter.cs` itself -- excluding production nested types
 *     too would have broken that real, working recovery.
 */
function isCandidateCSharpTypeDeclarationChunk(chunk: CodeChunk, file: string): boolean {
  if (chunk.metadata.symbolType !== 'class' && chunk.metadata.symbolType !== 'interface')
    return false;
  if (chunk.metadata.parentClass && isTestFile(file)) return false;
  return true;
}

/**
 * True iff `chunk` IS a type declaration named `typeName` -- i.e. this chunk's
 * own content is `typeName`'s declaration line, not a usage of it.
 */
function isDeclarationChunkFor(chunk: CodeChunk, typeName: string): boolean {
  return (
    (chunk.metadata.symbolType === 'class' || chunk.metadata.symbolType === 'interface') &&
    chunk.metadata.symbolName === typeName
  );
}

/**
 * True iff `fileChunks` (some OTHER file being considered as a candidate
 * referencer, never `targetFile` itself) declares its OWN type named
 * `typeName` ANYWHERE -- regardless of whether that declaration is a
 * candidate owner (see `isCandidateCSharpTypeDeclarationChunk`). A file in
 * this state is excluded ENTIRELY as evidence for `typeName`'s target
 * declaration, for both tiers: once a file has a competing local declaration
 * of the identical name, real C# shadowing means every bare occurrence of
 * that name WITHIN that file resolves to its OWN local declaration, not
 * `targetFile`'s -- and a plain word-boundary text match cannot tell which
 * specific occurrence is which, so the only safe answer is "don't guess",
 * exactly like every other unresolvable-ambiguity case this module refuses
 * to guess at.
 *
 * This is stronger than (and supersedes) excluding just the declaration
 * chunk's own text: caught empirically on serilog/serilog --
 * `LoggerConfigurationTests.cs` declares an unrelated NESTED test-double
 * `ProjectedDestructuringPolicy` (excluded from candidacy by the
 * nested-in-test-file rule) and, at a SEPARATE call site in the SAME file,
 * genuinely constructs that SAME local double. Excluding only the
 * declaration chunk's own text left that separate call site still matching
 * -- a fabricated edge to the unrelated PRODUCTION
 * `Serilog.Policies.ProjectedDestructuringPolicy`. Excluding the whole file
 * once it's known to declare the name itself closes that gap.
 */
function fileDeclaresTypeName(fileChunks: CodeChunk[], typeName: string): boolean {
  return fileChunks.some(chunk => isDeclarationChunkFor(chunk, typeName));
}

interface CSharpTypeDeclaration {
  file: string;
  typeName: string;
  /** This declaration's own enclosing namespace, or `undefined` when `deriveCSharpNamespace` couldn't determine one (never guessed at). */
  namespace: string | undefined;
}

/** Group `chunks` by file, preserving first-seen order. Deliberately local and
 * unnormalized -- NOT `dependency-analyzer.ts`'s `groupChunksByFile` (that one
 * canonicalizes paths against a workspace root); this module works on
 * `chunk.metadata.file` strings as-is throughout, matching its existing
 * no-normalization discipline (see `findCSharpTypeReferenceDependents`'s
 * `targetFile` contract). */
function groupCSharpChunksByFile(chunks: CodeChunk[]): Map<string, CodeChunk[]> {
  const out = new Map<string, CodeChunk[]>();
  for (const chunk of chunks) {
    const list = out.get(chunk.metadata.file);
    if (list) list.push(chunk);
    else out.set(chunk.metadata.file, [chunk]);
  }
  return out;
}

/**
 * A namespace declaration line -- block-style (`namespace Foo.Bar {`) or C#
 * 10 file-scoped (`namespace Foo.Bar;`) -- anchored to the start of a line
 * (the `m` flag) so it can't fire on a coincidental mid-line occurrence.
 */
const NAMESPACE_DECLARATION_RE = /^[ \t]*namespace[ \t]+([\w.]+)[ \t]*[;{]/m;

/**
 * The dot-joined namespace enclosing `file`'s declarations (e.g.
 * `"Serilog.Core"`), or `undefined` when not determinable. See the module
 * doc's "Both tiers need each file's own namespace" section for why this is
 * derived from already-indexed chunk CONTENT (schema-free) instead of a new
 * persisted field, and its measured 205/216 (95%) hit rate on serilog.
 *
 * Scans `fileChunks` in line order and returns the FIRST match -- correct
 * for the overwhelming common case of one namespace per file; a file with
 * more than one top-level namespace block reports only the first one, a
 * fail-safe (under-, never over-) approximation -- see the module doc.
 */
function deriveCSharpNamespace(fileChunks: CodeChunk[]): string | undefined {
  const sorted = [...fileChunks].sort((a, b) => a.metadata.startLine - b.metadata.startLine);
  for (const chunk of sorted) {
    const match = NAMESPACE_DECLARATION_RE.exec(chunk.content);
    if (match) return match[1];
  }
  return undefined;
}

/**
 * C# chunks (any file, production or test -- see the module doc's "S is no
 * longer required to be a non-test file") that declare a type, each stamped
 * with its own file's derived namespace.
 */
function collectCSharpTypeDeclarations(
  chunks: CodeChunk[],
  namespaceByFile: Map<string, string | undefined>,
): CSharpTypeDeclaration[] {
  const out: CSharpTypeDeclaration[] = [];
  for (const chunk of chunks) {
    const file = chunk.metadata.file;
    if (detectLanguage(file) !== 'csharp') continue;
    if (!isCandidateCSharpTypeDeclarationChunk(chunk, file)) continue;
    const typeName = chunk.metadata.symbolName;
    if (!typeName) continue;
    out.push({ file, typeName, namespace: namespaceByFile.get(file) });
  }
  return out;
}

/** Build type name -> declaring file(s), project-wide. */
function buildCSharpTypeOwnerMap(declarations: CSharpTypeDeclaration[]): Map<string, Set<string>> {
  const defMap = new Map<string, Set<string>>();
  for (const decl of declarations) {
    const files = defMap.get(decl.typeName) ?? new Set<string>();
    files.add(decl.file);
    defMap.set(decl.typeName, files);
  }
  return defMap;
}

/** Type names declared in EXACTLY ONE file project-wide, mapped to that file. */
function uniqueCSharpTypeOwners(defMap: Map<string, Set<string>>): Map<string, string> {
  const owners = new Map<string, string>();
  for (const [typeName, files] of defMap) {
    if (files.size === 1) owners.set(typeName, [...files][0]);
  }
  return owners;
}

/**
 * Namespaces visible from code physically inside `namespace`, innermost
 * first, ending with `""` (the global namespace). Pure prefix decomposition
 * of the dotted string -- see the module doc's TIER 2 section for why this
 * equals C#'s real enclosing-namespace scope chain (a dotted namespace
 * declaration is spec-defined to behave exactly like nested blocks).
 */
function enclosingNamespaceChain(namespace: string): string[] {
  const parts = namespace ? namespace.split('.') : [];
  const chain: string[] = [];
  for (let i = parts.length; i >= 0; i--) chain.push(parts.slice(0, i).join('.'));
  return chain;
}

/** A candidate declaration of some ambiguous type name: which file declares it, and in which namespace. */
interface AmbiguousCandidate {
  namespace: string | undefined;
  file: string;
}

/**
 * Is `typeName`'s declaration in `targetFile`/`targetNamespace` SHADOWED (or
 * tied) by some OTHER candidate, from the vantage point of a referencer whose
 * enclosing chain is `chain`? True means "don't guess" -- see the module
 * doc's TIER 2 shadowing rule. Split out from `resolvesToTargetViaNamespace`
 * purely to keep that function's own cognitive complexity low.
 */
function isShadowedForReferencer(
  chain: string[],
  targetDepth: number,
  targetFile: string,
  candidates: ReadonlyArray<AmbiguousCandidate>,
): boolean {
  return candidates.some(candidate => {
    if (candidate.file === targetFile || candidate.namespace === undefined) return false;
    const idx = chain.indexOf(candidate.namespace);
    return idx !== -1 && idx <= targetDepth;
  });
}

/**
 * Does `file` (one candidate referencer, NOT `targetFile` itself) resolve a
 * bare reference to `typeName` back to `targetFile`'s declaration in
 * `targetNamespace`, per TIER 2's namespace-enclosure + shadowing rule? See
 * the module doc's TIER 2 section for the full rule this implements.
 */
function resolvesToTargetViaNamespace(
  file: string,
  fileChunks: CodeChunk[],
  targetFile: string,
  targetNamespace: string,
  typeName: string,
  matcher: RegExp,
  candidates: ReadonlyArray<AmbiguousCandidate>,
  namespaceByFile: Map<string, string | undefined>,
): boolean {
  if (detectLanguage(file) !== 'csharp') return false;

  const refNamespace = namespaceByFile.get(file);
  if (refNamespace === undefined) return false; // undeterminable -- never guess

  const chain = enclosingNamespaceChain(refNamespace);
  const targetDepth = chain.indexOf(targetNamespace);
  if (targetDepth === -1) return false; // targetNamespace isn't visible from here

  if (isShadowedForReferencer(chain, targetDepth, targetFile, candidates)) return false;

  // A referencer that declares its OWN same-named type is unresolvable from
  // text alone -- see `fileDeclaresTypeName`'s doc comment.
  if (fileDeclaresTypeName(fileChunks, typeName)) return false;

  return fileChunks.some(c => matcher.test(c.content));
}

/**
 * TIER 2: for one ambiguous (globally multiply-declared) `typeName` that
 * `targetFile` declares in `targetNamespace`, find every OTHER C# file that
 * resolves a bare reference to `typeName` back to `targetFile` specifically
 * -- via real C# namespace-enclosure AND shadowing -- see the module doc's
 * TIER 2 section for the full rule.
 */
function findNamespaceScopedDependents(
  targetFile: string,
  targetNamespace: string,
  typeName: string,
  candidates: ReadonlyArray<AmbiguousCandidate>,
  chunksByFile: Map<string, CodeChunk[]>,
  namespaceByFile: Map<string, string | undefined>,
): string[] {
  const matcher = identifierBoundaryRe(typeName);
  const found: string[] = [];

  for (const [file, fileChunks] of chunksByFile) {
    if (file === targetFile) continue;
    if (
      resolvesToTargetViaNamespace(
        file,
        fileChunks,
        targetFile,
        targetNamespace,
        typeName,
        matcher,
        candidates,
        namespaceByFile,
      )
    ) {
      found.push(file);
    }
  }

  return found;
}

/** Map every C# file in `chunksByFile` to its derived namespace (or `undefined`). */
function buildCSharpNamespaceIndex(
  chunksByFile: Map<string, CodeChunk[]>,
): Map<string, string | undefined> {
  const namespaceByFile = new Map<string, string | undefined>();
  for (const [file, fileChunks] of chunksByFile) {
    if (detectLanguage(file) === 'csharp') {
      namespaceByFile.set(file, deriveCSharpNamespace(fileChunks));
    }
  }
  return namespaceByFile;
}

/** TIER 1: every C# file referencing one of `targetFile`'s globally-unique declared type names. */
function resolveTier1UniqueDependents(
  targetFile: string,
  defMap: Map<string, Set<string>>,
  chunksByFile: Map<string, CodeChunk[]>,
): Set<string> {
  const found = new Set<string>();
  const owners = uniqueCSharpTypeOwners(defMap);
  const uniqueTargetNames = [...owners.entries()]
    .filter(([, file]) => file === targetFile)
    .map(([typeName]) => typeName);
  if (uniqueTargetNames.length === 0) return found;

  const matchers = uniqueTargetNames.map(name => ({ name, re: identifierBoundaryRe(name) }));
  for (const [file, fileChunks] of chunksByFile) {
    if (file === targetFile) continue;
    if (detectLanguage(file) !== 'csharp') continue;
    // A referencer that declares its OWN same-named type is unresolvable
    // from text alone -- see `fileDeclaresTypeName`'s doc comment.
    const references = matchers.some(
      ({ name, re }) =>
        !fileDeclaresTypeName(fileChunks, name) && fileChunks.some(c => re.test(c.content)),
    );
    if (references) found.add(file);
  }
  return found;
}

/** TIER 2: every C# file resolving one of `targetFile`'s AMBIGUOUS declared type names back to it via namespace scoping + shadowing. */
function resolveTier2NamespaceScopedDependents(
  targetFile: string,
  declarations: CSharpTypeDeclaration[],
  defMap: Map<string, Set<string>>,
  chunksByFile: Map<string, CodeChunk[]>,
  namespaceByFile: Map<string, string | undefined>,
): Set<string> {
  const found = new Set<string>();
  const targetNamespace = namespaceByFile.get(targetFile);
  if (targetNamespace === undefined) return found;

  const ambiguousTargetNames = declarations
    .filter(decl => decl.file === targetFile && (defMap.get(decl.typeName)?.size ?? 0) > 1)
    .map(decl => decl.typeName);

  for (const typeName of ambiguousTargetNames) {
    const candidates = declarations.filter(decl => decl.typeName === typeName);
    const extra = findNamespaceScopedDependents(
      targetFile,
      targetNamespace,
      typeName,
      candidates,
      chunksByFile,
      namespaceByFile,
    );
    for (const file of extra) found.add(file);
  }
  return found;
}

/**
 * Everything `resolveCSharpTypeReferenceDependents` needs to resolve any
 * number of target files against ONE project-wide scan -- built once by
 * `buildCSharpTypeReferenceIndex` and reused per target, so a caller
 * resolving many target files (e.g. `test-associations.ts`'s per-file loop,
 * #1040) doesn't re-scan the full chunk set for every one of them, the same
 * "build the index once, resolve many" discipline
 * `go-same-directory-tests.ts`/`java-same-package-tests.ts` already use for
 * their own directory/package indexes.
 */
export interface CSharpTypeReferenceIndex {
  chunksByFile: Map<string, CodeChunk[]>;
  namespaceByFile: Map<string, string | undefined>;
  declarations: CSharpTypeDeclaration[];
  defMap: Map<string, Set<string>>;
}

/**
 * Build the project-wide index `resolveCSharpTypeReferenceDependents` needs
 * (file->chunks, file->derived namespace, every type declaration, and the
 * type-name->declaring-files map) from `chunks` once. `chunks` should be the
 * FULL project chunk set -- uniqueness (tier 1) and namespace scoping (tier 2)
 * are both project-wide properties, not scoped to any one target file.
 */
export function buildCSharpTypeReferenceIndex(chunks: CodeChunk[]): CSharpTypeReferenceIndex {
  const chunksByFile = groupCSharpChunksByFile(chunks);
  const namespaceByFile = buildCSharpNamespaceIndex(chunksByFile);
  const declarations = collectCSharpTypeDeclarations(chunks, namespaceByFile);
  const defMap = buildCSharpTypeOwnerMap(declarations);
  return { chunksByFile, namespaceByFile, declarations, defMap };
}

/**
 * Find C# files (any file, production or test) that reference one of
 * `targetFile`'s declared type names against an already-built `index` (see
 * `buildCSharpTypeReferenceIndex`), either because the name is uniquely
 * declared project-wide (tier 1) or because namespace scoping + shadowing
 * unambiguously resolves an otherwise globally-ambiguous name back to
 * `targetFile` for that specific referencer (tier 2) -- see the module doc
 * for both rules. Excludes `targetFile` itself. Returns a sorted,
 * deduplicated list of filepaths -- empty when `targetFile` declares no
 * resolvable type or genuinely has no textual referrers in the index.
 *
 * `targetFile` must be the exact `chunk.metadata.file` string used by
 * `targetFile`'s own chunks within the chunks `index` was built from (not a
 * separately-normalized path) -- this function does no path normalization of
 * its own and relies on plain string equality throughout, mirroring
 * `swift-symbol-usage-signals.ts`'s same discipline.
 */
export function resolveCSharpTypeReferenceDependents(
  targetFile: string,
  index: CSharpTypeReferenceIndex,
): string[] {
  const { chunksByFile, namespaceByFile, declarations, defMap } = index;

  const tier1 = resolveTier1UniqueDependents(targetFile, defMap, chunksByFile);
  const tier2 = resolveTier2NamespaceScopedDependents(
    targetFile,
    declarations,
    defMap,
    chunksByFile,
    namespaceByFile,
  );

  return [...new Set([...tier1, ...tier2])].sort();
}

/**
 * Single-target convenience wrapper around `buildCSharpTypeReferenceIndex` +
 * `resolveCSharpTypeReferenceDependents`, for callers resolving just ONE
 * target file (`get_dependents`'s file-level recovery, #930/#943). Callers
 * resolving MANY target files against the same chunk set should build the
 * index once themselves instead of calling this in a loop -- see
 * `CSharpTypeReferenceIndex`'s doc comment.
 */
export function findCSharpTypeReferenceDependents(
  targetFile: string,
  chunks: CodeChunk[],
): string[] {
  if (detectLanguage(targetFile) !== 'csharp') return [];
  return resolveCSharpTypeReferenceDependents(targetFile, buildCSharpTypeReferenceIndex(chunks));
}
