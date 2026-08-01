import type { LanguageTraverser } from '../traversers/types.js';
import type {
  LanguageExportExtractor,
  LanguageImportExtractor,
  LanguageSymbolExtractor,
} from '../extractors/types.js';
import type { SupportedLanguage } from './registry.js';

/**
 * Complete definition for a language supported by AST parsing.
 *
 * Each supported language has a single definition file that assembles
 * all language-specific data (traverser, extractor, complexity constants,
 * symbol types) into one place. Prior to ADR-013 Phase 4-B this also held
 * a `grammar` field (the node-tree-sitter grammar object); the native
 * backend has no equivalent -- @liendev/parser-native selects its grammar
 * internally by language id (see ast/parser.ts's parseTree call).
 */
export interface LanguageDefinition {
  /** Language identifier (e.g., 'typescript', 'python') */
  id: SupportedLanguage;

  /** File extensions without dots (e.g., ['ts', 'tsx']) */
  extensions: string[];

  /** Language-specific AST traverser instance */
  traverser: LanguageTraverser;

  /** Language-specific export extractor instance */
  exportExtractor: LanguageExportExtractor;

  /** Language-specific import extractor instance (optional for backwards compatibility) */
  importExtractor?: LanguageImportExtractor;

  /** Language-specific symbol extractor instance (optional for backwards compatibility) */
  symbolExtractor?: LanguageSymbolExtractor;

  /** Complexity metric configuration */
  complexity: {
    /** Cyclomatic: AST node types that represent decision points */
    decisionPoints: string[];

    /** Cognitive: node types that increase complexity AND increment nesting */
    nestingTypes: string[];

    /** Cognitive: node types that add complexity but don't nest */
    nonNestingTypes: string[];

    /** Cognitive: lambda/closure types that add complexity when nested */
    lambdaTypes: string[];

    /** Halstead: operator symbol characters (e.g., +, -, &&) */
    operatorSymbols: Set<string>;

    /** Halstead: keyword operators (e.g., if, while, return) */
    operatorKeywords: Set<string>;
  };

  /** Symbol extraction configuration */
  symbols: {
    /** AST node types representing function/method calls */
    callExpressionTypes: string[];
  };

  /**
   * True when this language's typical test files import their subject as a
   * whole module (e.g. Swift's `import Alamofire` / `@testable import
   * Alamofire`) rather than a specific per-file/per-symbol path, so
   * `chunk.metadata.imports` carries no per-file signal an import-based
   * test-association matcher (`matchesFile`) can ever resolve to a specific
   * source file. This is a structural gap, not a matching bug (#869) — no
   * heuristic recovers it here. Absent/false (the default for every
   * language except Swift) means the existing per-file import matching
   * applies as before; unset is NOT the same as "confirmed false", it's just
   * unconfirmed, so only set this where the whole-module convention has
   * been verified against real code.
   */
  wholeModuleImports?: boolean;

  /**
   * True when this language lets a nested namespace body reference an
   * *enclosing* namespace's members unqualified, with no `using`/`import`
   * directive at all (C# confirmed — see ECMA-334 simple-name resolution:
   * `namespace AutoMapper.UnitTests { ... }` gets implicit access to
   * `AutoMapper`'s public members purely because it's a dotted-nested
   * namespace, never emitting an import for it). Unlike `wholeModuleImports`,
   * this does NOT mean per-file import matching is universally useless for
   * the language — C#'s dotted `using X.Y;` still resolves real per-file
   * associations correctly (#866/#868) — so this must stay a *separate* flag
   * a caller only consults as a last-resort, empty-associations fallback
   * (see `hasEnclosingNamespaceAccess` and its one call site in
   * `annotate-cmd.ts`'s `formatTests`), never folded into
   * `wholeModuleImports` or `isUnresolvableWholeModuleImport` (#875).
   */
  enclosingNamespaceAccess?: boolean;

  /**
   * True when a BARE (non-relative), potentially multi-segment import
   * specifier in this language always names a single file, never a
   * directory whose files are all implicitly members of the same unit
   * (#887).
   *
   * Ruby sets this: `require 'rack/protection'` loads exactly one file
   * (`rack/protection.rb`, resolved via `$LOAD_PATH`) — a sibling file like
   * `rack/protection/base.rb` is a separate, unrelated module that merely
   * shares a directory, not an implicit member of the `rack/protection`
   * specifier. Go is the opposite and deliberately leaves this unset:
   * `import "mymodule/internal/fs"` normalizes (after #877's module-prefix
   * stripping) to the bare `internal/fs`, which names a PACKAGE — every
   * `.go` file inside that directory is a member of the package, so
   * `internal/fs` legitimately matches `internal/fs/fs.go`,
   * `internal/fs/utils.go`, etc. Absent/false (the default for every
   * language except Ruby) preserves that permissive package-directory
   * matching. Every other currently-supported language is unaffected either
   * way and leaves this unset too: TypeScript/JavaScript resolve specifiers
   * to a concrete file before `matchesFile` ever runs, and Python/PHP use
   * their own dedicated matching strategies (`matchesPythonModule`/
   * `matchesPHPNamespace`). See `matchesFile`'s `requireExactTailForMultiSegment`
   * parameter for how this flag is consumed (only `importMatchesTarget`
   * derives it from the importer's language; the two build-side sites and
   * the two stay-raw `matchesFile` call sites don't have a specific target
   * to disambiguate against).
   *
   * Rust is a DELIBERATE non-example, not an oversight: its `mod x;`
   * declarations do name an exact file (never a package directory), but
   * this per-LANGUAGE flag can't express that alone -- a single Rust file
   * routinely has both a `mod x;` (single-file) and a `use crate::y;`
   * (needs this same package-directory leniency, since `crate::`-relative
   * paths are missing their real `src/`-style prefix) among its own
   * imports, and this flag can't disambiguate between two entries in one
   * file's import list the way it disambiguates between two LANGUAGES.
   * `mod`-derived specifiers instead carry their own per-specifier marker
   * (#1021) straight past this flag entirely -- see `rust-mod-marker.ts`
   * and `matchesRustModSpecifier` in `../../utils/path-matching.ts`. Rust's
   * `use`/`self::`/`super::` specifiers are unaffected by that marker and
   * keep relying on this flag staying unset for Rust, exactly as before.
   */
  singleFileImports?: boolean;

  /**
   * True when this language's dominant test convention colocates a test file
   * in the same directory as its subject with NO import statement connecting
   * them at all (#902).
   *
   * Go confirmed: a `_test.go` file in `package foo` tests `package foo`'s
   * other files in the same directory purely by Go's own compiler-enforced
   * one-package-per-directory rule — no `import` is needed or even legal for
   * a package to import itself, so `chunk.metadata.imports` carries zero
   * signal for this, the dominant Go unit-test shape (measured at 94.4% of
   * a real codebase's `_test.go` files basename-pairing with a same-named
   * sibling; 100% same-directory). This is a structural gap, not a matching
   * bug, the same category as `wholeModuleImports`/`enclosingNamespaceAccess`
   * above — except here the directory itself IS reliable, deterministic
   * evidence (unlike those two), so callers recover a real association from
   * it (see `go-same-directory-tests.ts`) rather than only an honesty label.
   * Absent/false (the default for every language except Go) means no
   * directory-based signal is consulted; only set this where the convention
   * has been verified against real code.
   */
  sameDirectoryTestConvention?: boolean;

  /**
   * True when this language's dominant test convention places a test file in
   * the SAME PACKAGE as its subject with NO import statement connecting them
   * at all (like `sameDirectoryTestConvention` above), but where "same
   * package" is NOT bounded to a single directory the way Go's is (#925).
   *
   * Java confirmed: same-package members are visible with no `import`, the
   * same rule that motivates `sameDirectoryTestConvention` for Go -- but Java
   * has no compiler-enforced one-package-per-directory rule, and a real
   * multi-module Gradle/Maven build routinely puts a test class in a
   * *different* module's source root that happens to declare the identical
   * package (measured against a real square/retrofit clone: ALL 101 test
   * files share a package with their subject while living in a different
   * module's `src/<sourceSet>/java/` tree). What IS universal is the
   * Maven/Gradle Standard Directory Layout itself
   * (`src/<sourceSet>/java/<package/path>/...`), which makes the
   * package-relative path (after stripping that fixed marker) an equally
   * reliable, deterministic recovery -- see `java-same-package-tests.ts`.
   * Absent/false (the default for every language except Java) means no
   * package-relative signal is consulted; only set this where the
   * convention has been verified against real code.
   */
  samePackageTestConvention?: boolean;

  /**
   * True when this language has a same-unit (package/namespace/module)
   * access shape that lets a real caller reach this language's exports with
   * NO import statement at all, for a reason not already covered by
   * `enclosingNamespaceAccess`, `samePackageTestConvention`, or
   * `wholeModuleImports` above (#1005's Mechanism 2).
   *
   * Kotlin confirmed: JVM same-package visibility is the same underlying
   * fact `samePackageTestConvention` documents for Java (Klaxon's 104 files
   * sit in one package and reference each other with zero `import`
   * statements). Rather than setting `samePackageTestConvention` on Kotlin
   * too, this is a SEPARATE flag: that one is deliberately scoped by its own
   * doc comment to TEST association specifically (`java-same-package-tests.ts`'s
   * package-relative-path recovery, verified against Java's Maven/Gradle
   * Standard Directory Layout, #925) — no equivalent recovery mechanism has
   * been verified for Kotlin's own Gradle conventions, so setting that flag
   * for Kotlin would imply a real recovery this codebase doesn't have.
   * `sameUnitAccessWithoutImport` exists purely so
   * `hasDependentAttributionBlindSpot` (registry.ts) can give Kotlin the
   * same GENERAL `get_dependents` honesty caveat C#/Java/Swift already get
   * (#1005's Mechanism 2 fix is scoped to the caveat only, not real
   * resolution) without implying a recovery mechanism exists.
   *
   * Absent/false (the default for every language except Kotlin) means this
   * flag contributes nothing; only set it where the same-unit-without-import
   * shape has been verified against real code.
   */
  sameUnitAccessWithoutImport?: boolean;

  /**
   * True when this language's import specifiers use case-insensitive,
   * directory-structure-mirroring namespaces, so `matchesFile`'s Strategy 4
   * (`matchesPHPNamespace`) is a real, intended semantic for it rather than
   * an incidental leniency (#1028).
   *
   * PHP confirmed: PSR-4 autoloading maps a namespace like `App\Models\User`
   * onto a file path (`app/Models/User.php`) where the FIRST segment's case
   * routinely differs from the directory's actual case on disk (Laravel's
   * `App\` vs. `app/`), and case-insensitive filesystems make this doubly
   * real. That is a genuine per-language semantic worth its own matching
   * strategy, unlike `matchesFile`'s other case-sensitive boundary strategies.
   *
   * `matchesPHPNamespace` was applied UNCONDITIONALLY to every language
   * (never gated on this flag, because this flag didn't exist before
   * #1028) — harmless for the other ten languages' *legitimate* matches
   * (which all resolve through Strategies 1-3 first, see #1028's own
   * investigation), but its bare-single-component leniency (added by #883
   * for an unrelated Swift/Go/Ruby fix — see `matchesPHPNamespace`'s doc
   * comment) is ALSO case-insensitive, unlike Strategy 2's equivalent
   * one-leading-segment leniency. On Rust, `use crate::{Error, StdError}`'s
   * first-wins bare specifier `"Error"` case-insensitively self-matched
   * `src/error.rs` (a real `dtolnay/anyhow` repro: `chain.rs`/`context.rs`/
   * `error.rs` each became their own dependent via a self-referential bare
   * `use crate::X` naming their own type). The same case-insensitivity can
   * also fabricate an edge between two DIFFERENT files whenever an unrelated
   * bare specifier happens to share a target's basename modulo case, within
   * the same one-leading-directory window — not just the self-edge shape.
   *
   * Absent/false (the default for every language except PHP) means
   * `matchesFile` skips Strategy 4 entirely for that language's imports —
   * see `allowNamespaceMatching` in `../../utils/path-matching.ts` and
   * `hasNamespaceMatchingSemantics`, the one place this flag is consulted
   * (mirroring the established `singleFileImports`/#887 and Python/#929
   * per-language-gate pattern, rather than adding an eighteenth patch to the
   * shared matcher itself, per #1028's own recommendation). Only set this
   * where the case-insensitive-namespace-to-directory convention has been
   * verified against real code.
   */
  namespaceStyleImports?: boolean;
}
