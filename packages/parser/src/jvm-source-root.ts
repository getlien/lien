import fs from 'fs';
import path from 'path';
import { globSync } from 'glob';

/**
 * Resolves Java/Kotlin dotted fully-qualified names (`com.squareup.javapoet.TypeName`)
 * to workspace-relative file paths (`src/main/java/com/squareup/javapoet/TypeName`),
 * by locating the project's conventional Maven/Gradle source-set directories
 * on disk and requiring the resolved candidate to actually exist as a file.
 *
 * This closes Mechanism 1 of #1005 / #1046: `JavaImportExtractor` and
 * `KotlinImportExtractor` both store the raw DOTTED specifier verbatim
 * (`java.ts`, `kotlin.ts` -- neither converts `.` to `/`), so a Java/Kotlin
 * import never reaches any of `path-matching.ts`'s slash-oriented matching
 * strategies at all. Strategy 5 (`matchesPythonModule`) is the only strategy
 * that understands a dotted specifier, but it is gated off for every
 * non-Python importer (#929, `allowPythonModuleMatching`) -- correctly, since
 * re-enabling it for Java/Kotlin would resurrect exactly the false-hub shape
 * #929 was gated to fix (a resolved bare/dotted specifier fuzzy-matching an
 * unrelated file that merely shares a package prefix).
 *
 * The fix mirrors `php-psr4.ts` (Composer PSR-4) and `rust-crate-map.ts`
 * (Cargo workspace members): resolve the specifier to a concrete path BEFORE
 * `path-matching.ts` ever sees it, gated by this project's own build-system
 * convention, and require the resolved candidate to exist as a real file on
 * disk before rewriting anything. An unresolvable specifier (external
 * library, wildcard package import, non-standard layout) passes through
 * unchanged -- exactly as unresolvable today, never a guess. This is
 * deliberately NOT a new `matchesFile` strategy: once resolved, the
 * specifier IS the target's own normalized path, so it satisfies `matchesFile`'s
 * existing exact-match fast path directly, with no new fuzzy-matching surface
 * introduced (see #928's "language-blind bare-module matching" precedent for
 * why that would be the wrong shape).
 *
 * Unlike PHP's Composer manifest or Rust's `Cargo.toml`, Maven/Gradle have no
 * single, reliably-declared field naming the source directory -- Gradle's
 * default (`src/main/java`, `src/main/kotlin`, `src/test/java`,
 * `src/test/kotlin`) is convention, not a declared value in `build.gradle`
 * for the overwhelming majority of projects (Maven's `pom.xml` technically
 * allows a `<sourceDirectory>` override but almost never sets one away from
 * the default). Detection here is therefore filesystem-based, mirroring
 * `python-src-layout.ts`'s precedent for the same reason (Python's `src/`
 * layout is equally convention-over-declaration) -- a real, on-disk
 * `src/<sourceSet>/<lang>/` directory is itself the deterministic signal.
 *
 * v1 scope (KISS/YAGNI, matching the PHP/Python/Rust precedent): only the
 * four conventional Maven/Gradle source-set directories are recognized, and
 * a project with no `src/main/{java,kotlin}` anywhere (a flat, non-standard
 * layout) resolves nothing -- an honest, documented gap rather than a guess.
 *
 * A MULTI-MODULE Gradle build nests each module's own source set under a
 * module subdirectory (confirmed on Klaxon's real layout:
 * `klaxon/src/main/kotlin/...`, not a top-level `src/main/kotlin/...`), so
 * candidates are found at ANY depth (`**\/src/main/java`, glob-matched),
 * not just directly under the workspace root the way PHP/Python/Rust's
 * single-manifest-at-the-root precedent does.
 *
 * Java and Kotlin share this module (rather than one per language) because
 * both use the identical dotted-FQN-over-Maven/Gradle-source-set convention
 * -- confirmed for both languages against real corpora (JavaPoet, Klaxon).
 * A mixed-language Gradle module (a Kotlin file referencing a same-module
 * Java helper class, or vice versa) is also why candidate source roots and
 * file extensions are each the union of both languages' conventions, rather
 * than scoped to only the resolving file's own language.
 */

/** Per-workspace-root cache so repeated calls during a single index run are O(1) map lookups. */
const jvmSourceRootCache = new Map<string, string[]>();

/** Clears the cached source-root lists. Exported for test isolation. */
export function clearJvmSourceRootCache(): void {
  jvmSourceRootCache.clear();
}

/**
 * Conventional Maven/Gradle source-set directories, in preference order:
 * production before test (a production class should resolve to its
 * production source before a same-named test double), Java before Kotlin
 * within each (arbitrary tie-break -- existence checking is what actually
 * disambiguates real collisions, this only matters when a name exists under
 * more than one candidate).
 */
const CONVENTIONAL_SOURCE_SETS = [
  'src/main/java',
  'src/main/kotlin',
  'src/test/java',
  'src/test/kotlin',
] as const;

/** Directories never worth descending into while globbing for source-set roots. */
const GLOB_IGNORE = [
  '**/node_modules/**',
  '**/build/**',
  '**/target/**',
  '**/.git/**',
  '**/out/**',
];

/**
 * Find (or retrieve from cache) every conventional Maven/Gradle source-set
 * directory present anywhere under `workspaceRoot`.
 *
 * Returns workspace-relative directories (POSIX separators, deduplicated),
 * ordered per `CONVENTIONAL_SOURCE_SETS` and alphabetically within each --
 * deterministic across runs, though real disambiguation comes from
 * `resolveJvmSourceRootImport`'s own existence check, not this ordering.
 * Returns an empty array when none exist -- callers can treat that as
 * "nothing to resolve" with zero behavior change.
 *
 * @param workspaceRoot - Absolute path to the project root.
 */
export function resolveJvmSourceRoots(workspaceRoot: string): string[] {
  const normalizedRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '');

  const cached = jvmSourceRootCache.get(normalizedRoot);
  if (cached) return cached;

  const roots: string[] = [];
  for (const sourceSet of CONVENTIONAL_SOURCE_SETS) {
    const matches = globSync(`**/${sourceSet}`, {
      cwd: normalizedRoot,
      ignore: GLOB_IGNORE,
    });
    for (const match of matches.map(m => m.replace(/\\/g, '/')).sort()) {
      if (!roots.includes(match)) roots.push(match);
    }
  }

  jvmSourceRootCache.set(normalizedRoot, roots);
  return roots;
}

/**
 * Only a bare/dotted Java or Kotlin identifier path -- excludes anything
 * already slash- or dot-relative. Unicode-aware (`\p{L}` letters, `\p{N}`
 * digits, plus `_`/`$`): both languages' specs permit any Unicode letter in
 * an identifier (JLS §3.8; Kotlin's grammar mirrors it), not just ASCII --
 * `[A-Za-z_]\w*` would silently leave a real, existing, non-ASCII-named
 * class (e.g. `例.クラス.Foo`) unresolved even when its file exists on disk.
 * `$` is included since it's a legal (if unusual) Java identifier character.
 */
const DOTTED_FQN_PATTERN = /^[\p{L}_$][\p{L}\p{N}_$]*(?:\.[\p{L}_$][\p{L}\p{N}_$]*)*$/u;

/** File extensions checked for each candidate, covering mixed-language Gradle modules (see module doc comment). */
const JVM_EXTENSIONS = ['java', 'kt'] as const;

/** True when `<workspaceRoot>/<candidate>.<ext>` exists on disk as a real file, for some `ext`. */
function existsUnderSourceRoot(workspaceRoot: string, candidate: string): boolean {
  return JVM_EXTENSIONS.some(ext => {
    try {
      return fs.statSync(path.join(workspaceRoot, `${candidate}.${ext}`)).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * Resolve a raw Java/Kotlin dotted FQN (e.g. `com.squareup.javapoet.TypeName`)
 * to a workspace-relative path (e.g. `src/main/java/com/squareup/javapoet/TypeName`),
 * by trying each of `sourceRoots` in order and requiring the candidate to
 * exist on disk as a real `.java` or `.kt` file (see this module's doc
 * comment for why existence, not a bare textual join, is required).
 *
 * No-op (returns `specifier` unchanged) when:
 * - `sourceRoots` is empty or `workspaceRoot` is absent (nothing to resolve
 *   against),
 * - `specifier` isn't a bare/dotted identifier path (already a slash path,
 *   a relative specifier, or a wildcard-suffixed package -- none of these
 *   are FILE-shaped, so an existence check against a single file candidate
 *   doesn't apply),
 * - no candidate resolves to a real file (an external library, a
 *   non-standard layout, or a package-only wildcard import that names a
 *   directory rather than a file all fall through here, exactly as
 *   unresolved today).
 *
 * @param specifier - The raw (pre-`normalizePath`) Java/Kotlin import specifier.
 * @param sourceRoots - Candidate source-set directories, from `resolveJvmSourceRoots`.
 * @param workspaceRoot - Absolute project root, for the existence check.
 */
export function resolveJvmSourceRootImport(
  specifier: string,
  sourceRoots: readonly string[],
  workspaceRoot: string | undefined,
): string {
  if (sourceRoots.length === 0 || !workspaceRoot) return specifier;
  if (!DOTTED_FQN_PATTERN.test(specifier)) return specifier;

  const asPath = specifier.replace(/\./g, '/');
  for (const root of sourceRoots) {
    const candidate = `${root}/${asPath}`;
    if (existsUnderSourceRoot(workspaceRoot, candidate)) return candidate;
  }
  return specifier;
}
