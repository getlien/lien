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
 *   candidate path, as produced by `resolveImportSpecifier`.
 * @param workspaceRoot - Absolute project root. Returns `false` when absent
 *   (nothing to check against) — callers with no workspace root in scope
 *   (most unit tests, and any indexing run that never provided one)
 *   correctly see zero require/include edges rather than an unverified guess.
 */
export function requireTargetExists(specifier: string, workspaceRoot: string | undefined): boolean {
  if (!workspaceRoot) return false;
  try {
    return fs.statSync(path.join(workspaceRoot, specifier)).isFile();
  } catch {
    return false;
  }
}
