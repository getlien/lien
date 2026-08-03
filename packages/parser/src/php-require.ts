import fs from 'fs';
import path from 'path';

/**
 * Verifies a `PHPImportExtractor.extractStaticRequireTargets` result actually
 * names a real file before `ast/symbols.ts`'s `appendStaticRequireTargets`
 * trusts it as a genuine dependency edge (#1009).
 *
 * A `require`/`require_once`/`include`/`include_once` target is inferred from
 * a string-literal / `__DIR__`-concatenation HEURISTIC, not a language-level
 * guarantee the way a `use` statement's namespace is — PHP resolves the
 * overwhelming majority of `require`/`include` call sites (a variable, a bare
 * constant, a function call) at runtime, which is genuinely unresolvable
 * statically and already skipped upstream in `PHPImportExtractor`. For the
 * minority that DOES look statically resolvable, this is the one remaining
 * guard against a plausible-looking guess: unlike `resolvePsr4Import`'s
 * single-candidate shortcut (which trusts the PSR-4 map without checking
 * disk, because a `use` statement's namespace mapping is a project-level
 * declaration, not a per-call-site inference), a `require`/`include` target
 * is only trusted once the resolved path is confirmed to exist. This is the
 * same #928/#1008/#1056 discipline — never emit an edge for a specifier that
 * merely LOOKS resolvable — applied to PHP's own file-inclusion mechanism.
 *
 * @param specifier - The already relative-resolved (workspace-relative)
 *   candidate path, as produced by `resolveImportSpecifier`. `resolveRelativeImport`
 *   permits a `../`-heavy specifier to climb above `workspaceRoot` (accepted,
 *   tested behavior shared with JS/TS/Python's own relative-import
 *   resolution — see `path-matching.test.ts`'s `'../../../../outside/thing'`
 *   case), but unlike those languages' resolution, THIS function is the only
 *   place in that whole pipeline that touches the real filesystem for the
 *   resolved result. A CodeRabbit finding (#1009) correctly flagged that
 *   without a boundary check, a crafted `require __DIR__ . '/../../../../etc/passwd'`
 *   could `statSync` a real file outside the project entirely. Rejected
 *   below via a relative-path escape check before the existence check ever
 *   runs, rather than trusting `path.join`'s result as-is.
 * @param workspaceRoot - Absolute project root. Returns `false` when absent
 *   (nothing to check against) — callers with no workspace root in scope
 *   (most unit tests, and any indexing run that never provided one)
 *   correctly see zero require/include edges rather than an unverified guess.
 */
export function requireTargetExists(specifier: string, workspaceRoot: string | undefined): boolean {
  if (!workspaceRoot) return false;

  const resolvedRoot = path.resolve(workspaceRoot);
  const candidate = path.resolve(resolvedRoot, specifier);
  const relativeToRoot = path.relative(resolvedRoot, candidate);
  // A specifier that resolves outside workspaceRoot produces a relative path
  // that IS '..' (candidate is the parent itself) or starts with a '..'
  // PARENT SEGMENT (`..` + the path separator) -- or, on Windows, an
  // absolute path when the two are on different drives. Either way, never
  // trust it as a real project file.
  //
  // Deliberately NOT `relativeToRoot.startsWith('..')`: that also matches a
  // legitimate in-project file whose own NAME happens to start with two
  // dots (e.g. `..foo.php`) -- `path.relative('/project', '/project/..foo.php')`
  // returns the literal string `'..foo.php'`, which starts with `'..'` as a
  // substring without being a parent-directory escape at all. That shape
  // over-rejects a real file (a correctness bug in the safe direction for a
  // security check, but still a regression from this function's own
  // pre-boundary-check behavior, which resolved such a file correctly).
  const escaped = relativeToRoot === '..' || relativeToRoot.startsWith(`..${path.sep}`);
  if (escaped || path.isAbsolute(relativeToRoot)) return false;

  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}
