/**
 * #1005 (Mechanism 3, Phase 1): recover REAL dependents for a Java/Kotlin
 * file when the import graph finds none, because a same-package reference
 * needs NO import statement at all -- JLS §6.5.5.1 / Kotlin's identical
 * same-package visibility rule both grant every top-level type in a package
 * unqualified access to every other top-level type in that SAME package,
 * with nothing in `chunk.metadata.imports` ever naming the reference.
 * Mechanism 1 (#1046, dotted-FQN import resolution, `jvm-source-root.ts`)
 * and Mechanism 2 (the `dependentAttributionIncomplete` honesty caveat,
 * `sameUnitAccessWithoutImport`/`samePackageTestConvention`) both already
 * shipped; this is the first mechanism that RESOLVES the same-package case
 * instead of only caveating it.
 *
 * Modeled directly on `csharp-type-reference-signals.ts` (build/resolve
 * split, `identifierBoundaryRe` word-boundary matching, a brute-force
 * reference implementation kept alongside the pruned one) -- see that
 * module's doc comment for the shared reasoning this one doesn't repeat.
 * The one structural difference: C# has no language-level "same package"
 * scope narrower than the whole corpus, so it needs a project-wide
 * uniqueness gate (tier 1) plus a namespace-scoping tier (tier 2) to safely
 * narrow candidates. Java/Kotlin's package IS that narrower scope already --
 * G2 below restricts every candidate to `targetFile`'s own exact package
 * string, so there is no second tier here.
 *
 * ## The six resolution gates
 *
 * For target file `targetFile`, for each TOP-LEVEL `class`/`interface` type
 * `T` it declares:
 *
 *   G1' (package-local uniqueness): exactly one file in T's OWN package
 *       declares a top-level T. This is the REVISED gate from #1005's plan
 *       review -- the ORIGINALLY planned gate was corpus-wide uniqueness
 *       (mirroring C#'s tier 1), but that was measured to be simultaneously
 *       INERT (0% effect on javapoet/klaxon, the corpora that motivated it)
 *       and PERMEABLE (it passes exactly in the fabrication case it was
 *       meant to catch, because a same-named competing declaration living in
 *       an unindexed third-party jar is invisible to any corpus-wide count
 *       by construction). Package-local uniqueness IS the real JLS
 *       name-resolution scope, not a statistical proxy for it -- there is no
 *       tunable dial between "corpus-wide" and "package-local" worth
 *       keeping.
 *   G2  (exact package match): candidate's derived package string EQUALS
 *       target's, exactly (string equality). Deliberately NOT
 *       `csharp-type-reference-signals.ts`'s `enclosingNamespaceChain`
 *       walk -- Java/Kotlin have no enclosing-PACKAGE visibility rule (a
 *       nested namespace sees its enclosing namespace in C#; a sub-package
 *       is NOT visible to its parent package in Java/Kotlin), so copying
 *       that mechanism would fabricate sibling/enclosing-package edges that
 *       don't exist.
 *   G3  (package must be derivable): a file whose package can't be derived
 *       (`derivePackage` returns `undefined`) never participates as a
 *       target OR a candidate -- see that function's doc comment.
 *   G4  (candidate doesn't declare its own T): a candidate file with ANY
 *       class/interface declaration named T -- NESTED-INCLUSIVE, no
 *       `parentClass` filter -- is excluded entirely, mirroring
 *       `fileDeclaresTypeName` in the C# module exactly. This must stay
 *       nested-inclusive: narrowing it to top-level-only would reopen the
 *       same fabrication `fileDeclaresTypeName`'s own doc comment describes
 *       for C#/serilog -- a candidate with an unrelated NESTED type named T
 *       would stay eligible, and a genuine reference to ITS OWN nested T
 *       would be misattributed as a reference to the target's top-level T.
 *   G5  (type declarations only): `symbolType` must be `'class'` or
 *       `'interface'` -- Kotlin's extractor already maps `object`/`enum`
 *       declarations onto `'class'`, so both fall out of this for free; see
 *       `KotlinSymbolExtractor`'s own doc comment.
 *   G6  (import-shadowing exclusion): exclude a candidate whose OWN
 *       single-type or single-static import declares a DIFFERENT binding
 *       for the simple name T. This is the fix for the fabrication class
 *       the original plan review's corpus-wide gate couldn't see (a
 *       same-named type reachable ONLY via an explicit import to somewhere
 *       else). Computed from a per-file regex scan of raw `import` lines --
 *       see `collectShadowBindings`'s doc comment for why this reads source
 *       text directly rather than `chunk.metadata.imports` (whose entries
 *       get REWRITTEN by `jvm-source-root.ts`'s resolution and collapse a
 *       real distinction this gate depends on). The exact rule, per JLS
 *       §6.4.1/§7.5.1/§7.5.3 and Kotlin's import-alias semantics:
 *         - A single-type import (`import a.b.Foo;`) or single-static
 *           import (`import static a.B.C;`) SHADOWS a same-package
 *           declaration of the identical simple name -- excluded.
 *         - An import-on-demand (`import a.b.*;`, `import static a.B.*;`)
 *           does NOT shadow (JLS §6.4.1: on-demand imports never shadow a
 *           same-package type) -- never excluded on this basis. This falls
 *           out for free: `SINGLE_IMPORT_LINE_RE` cannot match a line
 *           containing a literal `*`.
 *         - Kotlin's `import a.b.Foo as Bar` binds the ALIAS `Bar`, not
 *           `Foo` -- a same-package `Foo` stays fully visible. The bound
 *           name is keyed on the alias when present, never the FQN's last
 *           segment, so this is automatic.
 *   G7  (source-set direction, cheap insurance only): a non-test candidate
 *       is never credited as a dependent of a test target (Gradle/Maven put
 *       main sources on a test source set's classpath, never the reverse).
 *       Measured to catch ZERO edges G6 doesn't already catch, independently,
 *       across all four corpora used to validate this module (javapoet,
 *       klaxon, retrofit, okhttp) -- kept because it's free, NOT because it's
 *       load-bearing. Do not read its presence as evidence it's doing work.
 *
 * ## What this deliberately does NOT do (Phase 1 scope)
 *
 * - Does not touch `NO_DIRECTORY_NAMESPACE_LANGS` (`graph/dependency-graph.ts`)
 *   -- that feeds the call-graph consumer (`buildCallerEdges`), a separate
 *   Phase 2 concern with its own test evidence, not `findDependents`.
 * - Does not resolve Kotlin `typealias` or Java annotation declarations, and
 *   does not add Kotlin top-level `fun`/`val` as resolution targets --
 *   deferred to Phase 3. Extending to bare top-level functions specifically
 *   would re-import the exact problem class
 *   `csharp-type-reference-signals.ts`'s own doc comment (and
 *   `swift-symbol-usage-signals.ts`/`go-root-package-signals.ts`'s
 *   distinctive-name gates) exist to guard against: a bare METHOD/function
 *   name collides with unrelated same-named callables far more often than a
 *   bare TYPE name collides with unrelated same-named types.
 * - Does not touch Swift at all.
 *
 * Verified against real clones (javapoet, klaxon, retrofit, okhttp) during
 * the design review that preceded this implementation -- see the PR
 * description for the real (not filesystem-spike) before/after edge counts
 * measured with THIS module against this repo's own parser/chunker.
 */

import type { CodeChunk } from './types.js';
import { isTestFile } from './utils/path-matching.js';
import { detectLanguage } from './ast/languages/registry.js';

function isJvmLanguage(file: string): boolean {
  const language = detectLanguage(file);
  return language === 'java' || language === 'kotlin';
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Plain identifier-boundary regex for `name` -- standard `\b` semantics.
 * Mirrors `csharp-type-reference-signals.ts`'s `identifierBoundaryRe`
 * exactly; see that module's doc comment for why this must NOT be
 * `doc-reference-matching.ts`'s `wordBoundaryRe` (which treats `.`/`-` as
 * identifier-continuation characters, wrong for source-code matching).
 */
function identifierBoundaryRe(name: string): RegExp {
  return new RegExp(`\\b${escapeForRegex(name)}\\b`);
}

/** Group `chunks` by file, restricted to Java/Kotlin files, preserving first-seen order. */
function groupJvmChunksByFile(chunks: CodeChunk[]): Map<string, CodeChunk[]> {
  const out = new Map<string, CodeChunk[]>();
  for (const chunk of chunks) {
    const file = chunk.metadata.file;
    if (!isJvmLanguage(file)) continue;
    const list = out.get(file);
    if (list) list.push(chunk);
    else out.set(file, [chunk]);
  }
  return out;
}

/**
 * A `package` declaration line, anchored to the start of a line (the `m`
 * flag). Matches both Java's semicolon-terminated form (`package a.b.c;`)
 * and Kotlin's unterminated form (`package a.b.c`) -- deliberately not
 * requiring a terminator at all, unlike C#'s `NAMESPACE_DECLARATION_RE`
 * (which must disambiguate a block-style namespace from a file-scoped one);
 * a Java/Kotlin package declaration has no such ambiguity to resolve.
 */
const PACKAGE_DECLARATION_RE = /^[ \t]*package[ \t]+([\w.]+)/m;

/**
 * The dot-joined package `fileChunks` declares (e.g. `"com.squareup.javapoet"`),
 * or `undefined` when not determinable (G3). Scans chunks in LINE order (sorted
 * by `metadata.startLine`, never `chunks[0]` -- array position is not line
 * order under incremental reindex or `OverlayBackend`; mirrors
 * `deriveCSharpNamespace`'s exact precedent) and returns the first match.
 *
 * A file with no derivable package never participates as a target or a
 * candidate anywhere below -- this can only ever suppress a recovery, never
 * fabricate one.
 */
function derivePackage(fileChunks: CodeChunk[]): string | undefined {
  const sorted = [...fileChunks].sort((a, b) => a.metadata.startLine - b.metadata.startLine);
  for (const chunk of sorted) {
    const match = PACKAGE_DECLARATION_RE.exec(chunk.content);
    if (match) return match[1];
  }
  return undefined;
}

function buildPackageIndex(
  chunksByFile: Map<string, CodeChunk[]>,
): Map<string, string | undefined> {
  const packageByFile = new Map<string, string | undefined>();
  for (const [file, fileChunks] of chunksByFile) {
    packageByFile.set(file, derivePackage(fileChunks));
  }
  return packageByFile;
}

/**
 * True iff `chunk` IS a class/interface declaration named `typeName` --
 * NESTED-INCLUSIVE (no `parentClass` check). Mirrors
 * `isDeclarationChunkFor`/`fileDeclaresTypeName` in the C# module exactly --
 * see this module's doc comment (G4/G5) for why narrowing this to
 * top-level-only would reopen a real fabrication.
 */
function isJvmTypeDeclarationChunkFor(chunk: CodeChunk, typeName: string): boolean {
  return (
    (chunk.metadata.symbolType === 'class' || chunk.metadata.symbolType === 'interface') &&
    chunk.metadata.symbolName === typeName
  );
}

/**
 * True iff ANY chunk in `fileChunks` (a candidate referencer, never
 * `targetFile` itself) declares its own class/interface named `typeName` --
 * G4. See `isJvmTypeDeclarationChunkFor`'s doc comment for why this check is
 * nested-inclusive.
 */
function fileDeclaresJvmTypeName(fileChunks: CodeChunk[], typeName: string): boolean {
  return fileChunks.some(chunk => isJvmTypeDeclarationChunkFor(chunk, typeName));
}

interface JvmTypeDeclaration {
  file: string;
  typeName: string;
  package: string | undefined;
}

/**
 * Every TOP-LEVEL (`!parentClass`) class/interface declaration across
 * `chunksByFile`, each stamped with its own file's derived package -- the
 * candidate RESOLUTION TARGETS (G1'/G5) and the seed for
 * `buildPkgLocalOwners`. Restricted to top-level because a nested type's
 * bare name is governed by containing-TYPE membership, not package
 * membership (Java/Kotlin require either lexical nesting or an explicit
 * qualified/imported reference to reach it unqualified) -- same-package
 * visibility, the mechanism this whole module recovers, only ever applies
 * to top-level declarations.
 */
function collectTopLevelDeclarations(chunksByFile: Map<string, CodeChunk[]>): JvmTypeDeclaration[] {
  const out: JvmTypeDeclaration[] = [];
  for (const [file, fileChunks] of chunksByFile) {
    for (const chunk of fileChunks) {
      if (chunk.metadata.parentClass) continue;
      if (chunk.metadata.symbolType !== 'class' && chunk.metadata.symbolType !== 'interface') {
        continue;
      }
      const typeName = chunk.metadata.symbolName;
      if (!typeName) continue;
      out.push({ file, typeName, package: derivePackageForFile(file, chunksByFile) });
    }
  }
  return out;
}

// `derivePackageForFile` is only ever called from `collectTopLevelDeclarations`
// above during index build, before `packageByFile` exists yet -- so it
// re-derives directly rather than taking a `packageByFile` parameter that
// doesn't exist at this point in the build sequence. `buildJvmSamePackageIndex`
// calls `derivePackage` once per file either way (via `buildPackageIndex`),
// so this is a second, cheap derivation of the same value, not a behavior
// difference.
function derivePackageForFile(
  file: string,
  chunksByFile: Map<string, CodeChunk[]>,
): string | undefined {
  const fileChunks = chunksByFile.get(file);
  return fileChunks ? derivePackage(fileChunks) : undefined;
}

/**
 * `${package}::${typeName}` -> the set of files that TOP-LEVEL declare
 * `typeName` in that package. G1' reads this map's entry sizes directly:
 * size 1 means package-local-unique.
 */
function buildPkgLocalOwners(declarations: JvmTypeDeclaration[]): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  for (const decl of declarations) {
    if (decl.package === undefined) continue;
    const key = `${decl.package}::${decl.typeName}`;
    const files = owners.get(key) ?? new Set<string>();
    files.add(decl.file);
    owners.set(key, files);
  }
  return owners;
}

/** package -> every JVM file (any declaration shape, any test/production status) with that derived package -- the G2 candidate set. */
function buildFilesByPackage(
  packageByFile: Map<string, string | undefined>,
): Map<string, string[]> {
  const filesByPackage = new Map<string, string[]>();
  for (const [file, pkg] of packageByFile) {
    if (pkg === undefined) continue;
    const files = filesByPackage.get(pkg) ?? [];
    files.push(file);
    filesByPackage.set(pkg, files);
  }
  return filesByPackage;
}

/** A single-line `import` statement, at the start of a line -- used to strip import lines out of the reference-matching body text. */
const IMPORT_LINE_RE = /^[ \t]*import\b/;

/**
 * Matches an entire Javadoc/KDoc or block comment (`/** ... *\/` or
 * `/* ... *\/`), possibly spanning multiple lines -- `/**` is still just
 * `/*` as far as this pattern cares, so no special case is needed for
 * Javadoc/KDoc specifically. Non-greedy (`[\s\S]*?`) so two SEPARATE block
 * comments on the same file don't collapse into one match spanning the real
 * code between them.
 *
 * A `/*`-shaped sequence inside a STRING LITERAL (vanishingly rare in real
 * Java/Kotlin source) would be misread as a real comment opener -- an
 * accepted, fail-safe-direction limitation shared by any regex-based
 * comment stripper: it can only over-strip (suppress a genuine match),
 * never fabricate one.
 */
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;

/**
 * A line whose ENTIRE trimmed text is a `//` line comment. Deliberately
 * does NOT match a line with a TRAILING comment after real code (`foo(); //
 * note`) -- see `stripCommentsImportsAndPackageLines`'s doc comment for why.
 */
const COMMENT_ONLY_LINE_RE = /^[ \t]*\/\//;

/**
 * `content` with every Javadoc/KDoc comment, `import` line, and `package`
 * line removed. Feeds the reference-matching body text
 * (`nonImportContentByFile`) -- see the module doc's G6 section and
 * `collectShadowBindings`'s doc comment for why import lines are excluded
 * from the TEXT-MATCH corpus specifically: any edge whose only textual
 * evidence is an import line is a DOTTED-FQN import Mechanism 1
 * (`jvm-source-root.ts`) already owns (confirmed for Java's
 * `import`/`import static` forms via `staticMemberClassPath`; Kotlin has no
 * equivalent static-member-import fallback -- see this module's own doc
 * comment on that gap).
 *
 * `package` lines are stripped for a related but distinct reason (#1005
 * Phase 3 Item D): before that fix, a file's `package` line usually never
 * reached the match corpus at all in the exact short/non-exported-header
 * cases this gate cares about, because `chunker.ts` dropped that whole range.
 * That fix makes the header a real, always-present chunk -- which newly
 * exposes the literal `package a.b.Foo;`-style text to
 * `identifierBoundaryRe`'s plain `\b` boundary for the FIRST time. A package
 * whose LAST segment happens to collide with a real package-locally-unique
 * type name declared elsewhere (e.g. `package a.b.Foo;` alongside a
 * top-level `class Foo` in package `a.b`) would then read as a textual
 * reference to that type purely from the file's own header -- reusing
 * `PACKAGE_DECLARATION_RE` (the same single source of truth `derivePackage`
 * already uses) rather than a second copy of the pattern.
 *
 * Comments are stripped for a THIRD, PRE-EXISTING reason (#1005 Phase 3
 * Item E, independent of Item D): a same-package file whose ONLY textual
 * reference to a target type sits inside a Javadoc/KDoc comment (not real
 * code) was counted as a genuine dependent by the already-shipped Phase 1
 * resolver (#1100). Measured across 6 real Java/Kotlin corpora: 2.4%-19.6%
 * of the resolver's currently-shipped edges rest SOLELY on a comment-only
 * match (see the PR body for the exact per-corpus numbers) -- larger than
 * Item D's entire measured gain.
 *
 * Deliberately stops at whole COMMENT-ONLY lines and full block comments,
 * and does NOT also strip a trailing `// comment` that follows real code on
 * the same line: measured (same 6 corpora) that recovering trailing
 * same-line comments on top of this gains only 0-2 ADDITIONAL edges per
 * corpus, against 100+ comment-only-line fabrications this already catches
 * -- not worth the extra risk of a bare `//` inside a string literal (e.g. a
 * URL) truncating a real code line if stripped blindly.
 */
function stripCommentsImportsAndPackageLines(content: string): string {
  const withoutBlockComments = content.replace(BLOCK_COMMENT_RE, '');
  return withoutBlockComments
    .split('\n')
    .filter(
      line =>
        !IMPORT_LINE_RE.test(line) &&
        !PACKAGE_DECLARATION_RE.test(line) &&
        !COMMENT_ONLY_LINE_RE.test(line),
    )
    .join('\n');
}

function buildNonImportContentIndex(chunksByFile: Map<string, CodeChunk[]>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [file, fileChunks] of chunksByFile) {
    out.set(
      file,
      fileChunks.map(chunk => stripCommentsImportsAndPackageLines(chunk.content)).join('\n'),
    );
  }
  return out;
}

/**
 * A single-type (`import a.b.Foo;`) or single-static (`import static a.B.C;`)
 * import line, with an optional Kotlin `as Alias`. Deliberately cannot match
 * an import-on-demand line (`import a.b.*;`, `import static a.B.*;`): the
 * captured group is `[\w.]+` (no `*`), so a literal `*` anywhere before the
 * line's end leaves no way for the rest of the pattern to also match -- this
 * is what makes "on-demand never shadows" (G6) fall out for free rather than
 * needing an explicit `.endsWith('.*')` check.
 *
 * The trailing `(?:\/\/.*)?[ \t\r]*$` (not just `[ \t]*$`) is load-bearing,
 * not cosmetic: `collectShadowBindings` below splits chunk content on `'\n'`
 * only, so a CRLF source file leaves every line ending in a literal `\r` --
 * without `\r` in the final character class, `[ \t]*$` never matches on such
 * a file, `.exec` returns `null` for EVERY import line in it, and G6 silently
 * never fires for that file at all (the exact `Cache.kt`-shaped fabrication
 * this gate exists to prevent, reappearing silently on a plausible real-world
 * input). The optional `// trailing comment` is the same failure mode from a
 * different direction: `import a.b.Foo; // legacy` has real trailing text
 * after the `;` that the old anchor also rejected outright.
 */
const SINGLE_IMPORT_LINE_RE =
  /^[ \t]*import[ \t]+(?:static[ \t]+)?([\w.]+)(?:[ \t]+as[ \t]+([A-Za-z_$][\w$]*))?[ \t]*;?[ \t]*(?:\/\/.*)?[ \t\r]*$/;

/**
 * Every simple name -> FQN binding a FILE's own single-type/single-static
 * imports establish, for G6's shadow check. Deliberately parses raw `import`
 * LINE TEXT rather than reading `chunk.metadata.imports`: that array's
 * entries get REWRITTEN by `jvm-source-root.ts`'s dotted-FQN-to-file-path
 * resolution (#1061) whenever a specifier resolves to a real indexed file --
 * collapsing exactly the distinction this gate needs (an import-on-demand's
 * stripped wildcard suffix, e.g. `import static a.b.Foo.*;` -> stored as the
 * bare string `"a.b.Foo"`, is textually IDENTICAL in that array to a genuine
 * single-type import of the same class, even though only the latter should
 * shadow per G6). Raw source text preserves the wildcard/static/alias shape
 * `chunk.metadata.imports` cannot, so this reads chunk CONTENT directly, the
 * same discipline `derivePackage`/`deriveCSharpNamespace` already use for
 * their own package/namespace derivation.
 *
 * The bound name is the Kotlin alias when present, otherwise the FQN's last
 * dot-segment -- `import a.b.Foo as Bar` binds `Bar`, never `Foo` (a
 * same-package `Foo` stays fully visible), matching JLS/Kotlin import-alias
 * semantics exactly.
 */
function collectShadowBindings(fileChunks: CodeChunk[]): Map<string, string> {
  const bindings = new Map<string, string>();
  for (const chunk of fileChunks) {
    for (const line of chunk.content.split('\n')) {
      const match = SINGLE_IMPORT_LINE_RE.exec(line);
      if (!match) continue;
      const fqn = match[1];
      const bound = match[2] ?? fqn.split('.').pop();
      if (bound) bindings.set(bound, fqn);
    }
  }
  return bindings;
}

function buildShadowBindingsIndex(
  chunksByFile: Map<string, CodeChunk[]>,
): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const [file, fileChunks] of chunksByFile) {
    out.set(file, collectShadowBindings(fileChunks));
  }
  return out;
}

function buildIsTestIndex(chunksByFile: Map<string, CodeChunk[]>): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const file of chunksByFile.keys()) out.set(file, isTestFile(file));
  return out;
}

/**
 * Everything `resolveJvmSamePackageDependents` needs to resolve any number
 * of target files against ONE project-wide scan -- built once by
 * `buildJvmSamePackageIndex` and reused per target, mirroring
 * `CSharpTypeReferenceIndex`/`GoRootPackageIndex`'s "build once, resolve
 * many" discipline.
 */
export interface JvmSamePackageIndex {
  chunksByFile: Map<string, CodeChunk[]>;
  packageByFile: Map<string, string | undefined>;
  /** Top-level class/interface declarations only -- see `collectTopLevelDeclarations`. */
  declarations: JvmTypeDeclaration[];
  /** `${package}::${typeName}` -> declaring files (G1'). */
  pkgLocalOwners: Map<string, Set<string>>;
  /** package -> every JVM file with that derived package (G2 candidate set). */
  filesByPackage: Map<string, string[]>;
  /** file -> its own content with `import`/`package` lines and comments stripped (the G6/text-match corpus). */
  nonImportContentByFile: Map<string, string>;
  /** file -> its own single-type/single-static import bindings (G6). */
  shadowBindingsByFile: Map<string, Map<string, string>>;
  /** file -> `isTestFile(file)` (G7). */
  isTestByFile: Map<string, boolean>;
}

/**
 * Build the project-wide index `resolveJvmSamePackageDependents` needs from
 * `chunks` once. `chunks` should be the FULL project chunk set -- G1'
 * package-local uniqueness is scoped to a package, not to any one target
 * file, so every file sharing a package must be visible to compute it
 * correctly.
 */
export function buildJvmSamePackageIndex(chunks: CodeChunk[]): JvmSamePackageIndex {
  const chunksByFile = groupJvmChunksByFile(chunks);
  const packageByFile = buildPackageIndex(chunksByFile);
  const declarations = collectTopLevelDeclarations(chunksByFile);
  const pkgLocalOwners = buildPkgLocalOwners(declarations);
  const filesByPackage = buildFilesByPackage(packageByFile);
  const nonImportContentByFile = buildNonImportContentIndex(chunksByFile);
  const shadowBindingsByFile = buildShadowBindingsIndex(chunksByFile);
  const isTestByFile = buildIsTestIndex(chunksByFile);
  return {
    chunksByFile,
    packageByFile,
    declarations,
    pkgLocalOwners,
    filesByPackage,
    nonImportContentByFile,
    shadowBindingsByFile,
    isTestByFile,
  };
}

/**
 * G4/G6/G7/text-match, applied to one (candidate, typeName) pair -- the ONE
 * predicate both `resolveJvmSamePackageDependents` (candidates pre-narrowed
 * to `targetFile`'s own package via `filesByPackage`) and
 * `resolveJvmSamePackageDependentsBruteForce` (candidates are every file in
 * the corpus, G2 checked explicitly) apply identically, so the two can never
 * diverge on the MATCHING decision -- only on which files get asked about it.
 * G1'/G2 are checked by each caller before this runs (G1' is per-typeName,
 * checked once per name rather than once per candidate; G2 is baked into
 * `filesByPackage`'s construction for the fast path).
 */
function resolvesJvmSamePackageReference(
  candidateFile: string,
  candidateChunks: CodeChunk[],
  targetFile: string,
  targetPackage: string,
  targetIsTest: boolean,
  typeName: string,
  matcher: RegExp,
  index: JvmSamePackageIndex,
): boolean {
  if (candidateFile === targetFile) return false;
  if (fileDeclaresJvmTypeName(candidateChunks, typeName)) return false; // G4

  const bound = index.shadowBindingsByFile.get(candidateFile)?.get(typeName);
  if (bound && bound !== `${targetPackage}.${typeName}`) return false; // G6

  const candidateIsTest = index.isTestByFile.get(candidateFile) ?? false;
  if (!candidateIsTest && targetIsTest) return false; // G7

  const body = index.nonImportContentByFile.get(candidateFile) ?? '';
  return matcher.test(body);
}

/**
 * G1' for one `typeName` in `targetPackage`: `undefined` when NOT
 * package-locally unique (never guessed at), otherwise the shared matcher
 * every candidate is tested against.
 */
function matcherIfPkgLocallyUnique(
  targetPackage: string,
  typeName: string,
  index: JvmSamePackageIndex,
): RegExp | undefined {
  const owners = index.pkgLocalOwners.get(`${targetPackage}::${typeName}`);
  if ((owners?.size ?? 0) !== 1) return undefined;
  return identifierBoundaryRe(typeName);
}

/** Every OTHER file in `targetPackage` that resolves a reference to `typeName` back to `targetFile`, via the fast (package-pre-narrowed) candidate set. */
function collectDependentsForName(
  targetFile: string,
  targetPackage: string,
  targetIsTest: boolean,
  typeName: string,
  index: JvmSamePackageIndex,
): string[] {
  const matcher = matcherIfPkgLocallyUnique(targetPackage, typeName, index);
  if (!matcher) return [];

  const found: string[] = [];
  for (const candidateFile of index.filesByPackage.get(targetPackage) ?? []) {
    const candidateChunks = index.chunksByFile.get(candidateFile);
    if (!candidateChunks) continue;
    if (
      resolvesJvmSamePackageReference(
        candidateFile,
        candidateChunks,
        targetFile,
        targetPackage,
        targetIsTest,
        typeName,
        matcher,
        index,
      )
    ) {
      found.push(candidateFile);
    }
  }
  return found;
}

/**
 * Find Java/Kotlin files (any directory, production or test) that reference
 * one of `targetFile`'s declared top-level type names via same-package
 * visibility -- see the module doc for the full six-gate rule -- against an
 * already-built `index` (see `buildJvmSamePackageIndex`). Excludes
 * `targetFile` itself. Returns a sorted, deduplicated list of filepaths --
 * empty when `targetFile` isn't Java/Kotlin, has no derivable package,
 * declares no package-locally-unique top-level type, or genuinely has no
 * textual referrers in the index.
 *
 * `targetFile` must be the exact `chunk.metadata.file` string used by
 * `targetFile`'s own chunks within the chunks `index` was built from --
 * mirrors `resolveCSharpTypeReferenceDependents`'s same no-normalization
 * discipline.
 */
export function resolveJvmSamePackageDependents(
  targetFile: string,
  index: JvmSamePackageIndex,
): string[] {
  if (!isJvmLanguage(targetFile)) return [];

  const targetPackage = index.packageByFile.get(targetFile);
  if (targetPackage === undefined) return []; // G3

  const targetIsTest = index.isTestByFile.get(targetFile) ?? false;
  const targetTypeNames = new Set(
    index.declarations.filter(decl => decl.file === targetFile).map(decl => decl.typeName),
  );

  const found = new Set<string>();
  for (const typeName of targetTypeNames) {
    for (const file of collectDependentsForName(
      targetFile,
      targetPackage,
      targetIsTest,
      typeName,
      index,
    )) {
      found.add(file);
    }
  }
  return [...found].sort();
}

/** `collectDependentsForName`'s brute-force twin: candidates are EVERY file in the corpus, with G2 checked explicitly rather than via `filesByPackage`. */
function collectDependentsForNameBruteForce(
  targetFile: string,
  targetPackage: string,
  targetIsTest: boolean,
  typeName: string,
  index: JvmSamePackageIndex,
): string[] {
  const matcher = matcherIfPkgLocallyUnique(targetPackage, typeName, index);
  if (!matcher) return [];

  const found: string[] = [];
  for (const [candidateFile, candidateChunks] of index.chunksByFile) {
    if (index.packageByFile.get(candidateFile) !== targetPackage) continue; // G2, explicit
    if (
      resolvesJvmSamePackageReference(
        candidateFile,
        candidateChunks,
        targetFile,
        targetPackage,
        targetIsTest,
        typeName,
        matcher,
        index,
      )
    ) {
      found.push(candidateFile);
    }
  }
  return found;
}

/**
 * BRUTE-FORCE reference implementation of `resolveJvmSamePackageDependents`:
 * identical gate logic (`resolvesJvmSamePackageReference`), but candidates
 * are every file in `index.chunksByFile` with G2 checked explicitly, rather
 * than the pre-narrowed `filesByPackage` lookup the fast path uses. Because
 * G2 (exact package-string equality) is checked EXACTLY, not approximated,
 * this is not merely a safe superset the way C#'s tokenizing candidate index
 * is (see that module's own doc comment) -- the fast and brute-force paths
 * must agree EXACTLY on every corpus, not just "brute-force never drops a
 * match the fast path found." `jvm-same-package-signals.test.ts` asserts
 * this equality directly (the P1 property).
 *
 * Never call this in production: it revisits every file in the corpus for
 * every target's every declared type name, exactly the cost
 * `filesByPackage` exists to avoid.
 */
export function resolveJvmSamePackageDependentsBruteForce(
  targetFile: string,
  index: JvmSamePackageIndex,
): string[] {
  if (!isJvmLanguage(targetFile)) return [];

  const targetPackage = index.packageByFile.get(targetFile);
  if (targetPackage === undefined) return [];

  const targetIsTest = index.isTestByFile.get(targetFile) ?? false;
  const targetTypeNames = new Set(
    index.declarations.filter(decl => decl.file === targetFile).map(decl => decl.typeName),
  );

  const found = new Set<string>();
  for (const typeName of targetTypeNames) {
    for (const file of collectDependentsForNameBruteForce(
      targetFile,
      targetPackage,
      targetIsTest,
      typeName,
      index,
    )) {
      found.add(file);
    }
  }
  return [...found].sort();
}

/**
 * Single-target convenience wrapper around `buildJvmSamePackageIndex` +
 * `resolveJvmSamePackageDependents`, for callers resolving just ONE target
 * file (`get_dependents`'s file-level recovery). Callers resolving MANY
 * target files against the same chunk set should build the index once
 * themselves instead of calling this in a loop -- see
 * `JvmSamePackageIndex`'s doc comment.
 */
export function findJvmSamePackageDependents(targetFile: string, chunks: CodeChunk[]): string[] {
  if (!isJvmLanguage(targetFile)) return [];
  return resolveJvmSamePackageDependents(targetFile, buildJvmSamePackageIndex(chunks));
}

/**
 * #1005 Phase 2: the PER-TYPE twin of `resolveJvmSamePackageDependents`, for
 * `graph/dependency-graph.ts`'s call-graph tier (`getCallers(filepath,
 * symbolName)` is always scoped to ONE symbol, never "every dependent of this
 * file"). Wraps the same `collectDependentsForName` the file-level resolver
 * already unions across all of `targetFile`'s declared types -- this is an
 * ADDITION, not a modification: the file-level resolver's contract and
 * callers (`findDependents`'s recovery tier) are untouched.
 *
 * Scoping matters: a JVM file can top-level-declare MORE than one
 * class/interface (idiomatic for sealed hierarchies or grouped data
 * classes), and the file-level resolver's union means "the set of files that
 * reference ANY of this file's declared types" -- correct for "who depends
 * on this FILE", but wrong for "who calls THIS type": a reference to a
 * sibling type declared in the same file would be misattributed as a
 * reference to `typeName`. This function applies the exact same G3
 * (package-derivable) and target-is-test gates the file-level resolver does,
 * but resolves candidates for `typeName` alone -- returning `[]` immediately
 * when `typeName` isn't one of `targetFile`'s own TOP-LEVEL declared
 * class/interface names (G5's type-only restriction still applies; a bare
 * method/function seed is never resolvable here, by construction).
 */
export function resolveJvmSamePackageDependentsForType(
  targetFile: string,
  typeName: string,
  index: JvmSamePackageIndex,
): string[] {
  if (!isJvmLanguage(targetFile)) return [];

  const targetPackage = index.packageByFile.get(targetFile);
  if (targetPackage === undefined) return []; // G3

  const isOwnDeclaredType = index.declarations.some(
    decl => decl.file === targetFile && decl.typeName === typeName,
  );
  if (!isOwnDeclaredType) return [];

  const targetIsTest = index.isTestByFile.get(targetFile) ?? false;
  return collectDependentsForName(targetFile, targetPackage, targetIsTest, typeName, index).sort();
}
