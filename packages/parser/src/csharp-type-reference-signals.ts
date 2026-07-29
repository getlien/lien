/**
 * #930 (part 2): recover REAL production dependents for a C# file when the
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
 * Association rule (source S declares type T -> dependent D references T):
 *   1. T is declared (`class`/`struct`/`interface`/`record`/`enum`) in
 *      EXACTLY ONE non-test C# file project-wide (S) -- see
 *      `buildCSharpTypeOwnerMap`/`uniqueCSharpTypeOwners`. Ambiguous
 *      (multiply-declared) names are dropped entirely, never guessed at.
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
 * Why uniqueness alone is a strong enough gate here, unlike Swift's
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
 * on its own line in an unusual way, or reflection-based usage. Residual
 * risk is accepted and hedged, not eliminated -- callers must surface this
 * as a lower-confidence, non-import-verified signal (see
 * `DependentInfo.confidence` in the CLI's dependency-analyzer.ts), never
 * fold it in unhedged next to a real import edge.
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
 * Deliberately scoped to file-level `get_dependents` recovery (via the CLI's
 * `dependency-analyzer.ts`), NOT test-association -- unlike Go/Java/Swift's
 * same-shaped signals, which stay confined to `lien annotate`'s test-
 * coverage line. #930's remaining gap is specifically that `get_dependents`
 * itself reports a false `dependentCount: 0` / `riskLevel: "low"` "all
 * clear" on a file that has 5 real callers -- an honesty label
 * (`dependentAttributionIncomplete`, #936) already covers the "we don't
 * know" case; this module is what lets the tool answer "we found some"
 * instead, when it genuinely can.
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
 * True iff `chunk` is a C# type declaration (class/struct/record/enum/interface).
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
 */
function isCSharpTypeDeclarationChunk(chunk: CodeChunk): boolean {
  return chunk.metadata.symbolType === 'class' || chunk.metadata.symbolType === 'interface';
}

interface CSharpTypeDeclaration {
  file: string;
  typeName: string;
}

/** Non-test C# chunks that declare a type, keyed by their raw `symbolName`. */
function collectCSharpTypeDeclarations(chunks: CodeChunk[]): CSharpTypeDeclaration[] {
  const out: CSharpTypeDeclaration[] = [];
  for (const chunk of chunks) {
    const file = chunk.metadata.file;
    if (detectLanguage(file) !== 'csharp' || isTestFile(file)) continue;
    if (!isCSharpTypeDeclarationChunk(chunk)) continue;
    const typeName = chunk.metadata.symbolName;
    if (!typeName) continue;
    out.push({ file, typeName });
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
 * Find C# files (any file, production or test) that reference one of
 * `targetFile`'s uniquely-declared type names via a word-boundary text
 * match, excluding `targetFile` itself. Returns a sorted, deduplicated list
 * of filepaths -- empty when `targetFile` isn't a C# file, declares no
 * uniquely-owned type, or genuinely has no textual referrers in `chunks`.
 *
 * `targetFile` must be the exact `chunk.metadata.file` string used by
 * `targetFile`'s own chunks within `chunks` (not a separately-normalized
 * path) -- this function does no path normalization of its own and relies
 * on plain string equality throughout, mirroring
 * `swift-symbol-usage-signals.ts`'s same discipline.
 *
 * `chunks` should be the FULL project chunk set -- uniqueness is a
 * project-wide property, not scoped to `targetFile` alone.
 */
export function findCSharpTypeReferenceDependents(
  targetFile: string,
  chunks: CodeChunk[],
): string[] {
  if (detectLanguage(targetFile) !== 'csharp') return [];

  const owners = uniqueCSharpTypeOwners(
    buildCSharpTypeOwnerMap(collectCSharpTypeDeclarations(chunks)),
  );
  const targetTypeNames = [...owners.entries()]
    .filter(([, file]) => file === targetFile)
    .map(([typeName]) => typeName);
  if (targetTypeNames.length === 0) return [];

  const matchers = targetTypeNames.map(name => identifierBoundaryRe(name));
  const found = new Set<string>();

  for (const chunk of chunks) {
    const file = chunk.metadata.file;
    if (file === targetFile || found.has(file)) continue;
    if (detectLanguage(file) !== 'csharp') continue;
    if (matchers.some(re => re.test(chunk.content))) {
      found.add(file);
    }
  }

  return [...found].sort();
}
