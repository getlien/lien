/**
 * The set of paths a change touched, unioned across the three places a
 * `SignalContext` records them.
 *
 * `changedFiles` is filtered to what the parser can analyze, `allChangedFiles`
 * adds the non-code paths (docs, config), and `pr.patches` is keyed by every
 * file in the diff. A module asking "did this PR touch X?" wants all three:
 * any single one of them alone misses files.
 *
 * Three modules had a byte-identical private copy of this — one of them
 * carrying a comment explaining that it was duplicated because the original
 * was private to another module. That was true while they lived in separate
 * packages; they are now siblings in one directory, so the duplication has no
 * remaining justification.
 *
 * Deliberately not exported from this directory's barrel: it is an internal
 * helper, not part of the package's public surface.
 */

import type { SignalContext } from './signal-context.js';

/** The union of every path this change touched (analyzable + non-code + patched). */
export function collectChangedFiles(context: SignalContext): Set<string> {
  const files = new Set<string>(context.changedFiles ?? []);
  for (const f of context.allChangedFiles ?? []) files.add(f);
  for (const f of context.pr?.patches?.keys() ?? []) files.add(f);
  return files;
}
