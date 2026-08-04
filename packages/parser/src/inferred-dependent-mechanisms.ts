/**
 * Which non-import recovery mechanism produced a `confidence: 'inferred'`
 * dependent, and the canonical prose describing it (#1018).
 *
 * ## What this is, and what it deliberately is NOT
 *
 * This is a **refinement of one existing value**, not a new confidence
 * vocabulary. `DependentInfo.confidence` stays exactly as it was -- absent for
 * an ordinary import-verified dependent, `'inferred'` for one a fallback
 * recovered. All this module adds is the *identity* of the fallback that did
 * the recovering, which the parser has always known and used to throw away at
 * its own boundary.
 *
 * See `docs/architecture/decisions/0016-dependency-attribution-honesty-axes.md`
 * for why the three vocabularies #1018 named were NOT merged, and for the
 * routing rule that decides where a new honesty signal belongs.
 *
 * ## The defect this exists to make impossible
 *
 * `confidence: 'inferred'` was single-valued, so every prose surface
 * describing it had to name a mechanism from memory. When #930 shipped there
 * was exactly one (C#'s type-reference matching), so all six surfaces described
 * that mechanism specifically -- and four of the six named C# by name:
 * `get_dependents`' runtime caveat note ("its language, C#"), the
 * `AttributionCaveatReason` doc comment, `tools.ts`' tool description ("C#'s
 * global-using gap"), and the public docs page ("today only for C#"). The
 * remaining two -- `ATTRIBUTION_CAVEAT_REASON_TEXT` and, by interpolating it,
 * the server instructions -- didn't say "C#" but did say "text-matching
 * fallback", which is equally wrong for Go.
 *
 * #1039/#1064 then added a SECOND mechanism -- Go's root-package export lookup
 * -- which reuses the same `confidence: 'inferred'` marking and the same
 * `dependent-attribution-partial` caveat reason. None of the five surfaces was
 * updated, because nothing forced it: `attribution-caveat-reasons.ts`'
 * `Record<AttributionCaveatReason, string>` guards the *set of reasons*, and no
 * reason was added -- only an existing reason's mechanism coverage widened.
 * Measured on a real `go-chi/chi` clone against `origin/main`, every recovered
 * Go root file was told, verbatim: *"its language, C#, lets real callers use
 * its exports with no per-file import naming it at all"*, and that its
 * dependents were *"recovered by matching a uniquely-declared type name against
 * other files' source text"*. Both halves false for Go, on 24 of 24 recovered
 * edges across `context.go`/`mux.go`/`chain.go`.
 *
 * So the forcing function here is the point, not a side benefit: the prose is
 * a `Record` keyed by the mechanism union, and every surface *derives* from it
 * rather than restating it. Adding a third mechanism is a compile error until
 * its prose exists, and once it exists all five surfaces are correct with no
 * further edits. #1067's declaration-index tier is the third mechanism, and its
 * stated prerequisite -- a first-class home for *"unique among indexed
 * declarations in this scope; a reference may still resolve to an unindexed
 * stdlib/third-party declaration of the same name"*, currently prose in four
 * separate signal-module doc comments -- is a new entry in this table.
 */

/**
 * The non-import fallbacks that can produce a `confidence: 'inferred'`
 * dependent. Add a member here and `INFERRED_DEPENDENT_MECHANISMS` below fails
 * to compile until its prose is written.
 */
export type InferredDependentMechanism = 'csharp-type-reference' | 'go-root-package-export';

/** The canonical prose for one mechanism. Every prose surface reads these. */
export interface InferredDependentMechanismDescriptor {
  /**
   * How to name the language in prose -- the value that used to be hard-coded
   * as `'C#'` in `get_dependents`' caveat note regardless of the real language.
   */
  readonly languageLabel: string;
  /**
   * Why the import graph structurally finds nothing for this file, phrased to
   * follow "its language, <languageLabel>, ".
   */
  readonly importGraphBlindSpot: string;
  /** How the fallback actually resolved the dependents it recovered. */
  readonly recovery: string;
  /** What the fallback can still miss or misattribute. */
  readonly residualRisk: string;
}

/**
 * `Record<InferredDependentMechanism, ...>` makes the compiler reject this
 * object literal unless it has EXACTLY the union's members as keys -- the same
 * deliberate forcing function `ATTRIBUTION_CAVEAT_REASON_TEXT` uses for caveat
 * reasons (#984), applied to the axis that one could not see.
 */
export const INFERRED_DEPENDENT_MECHANISMS: Record<
  InferredDependentMechanism,
  InferredDependentMechanismDescriptor
> = {
  'csharp-type-reference': {
    languageLabel: 'C#',
    importGraphBlindSpot:
      'lets real callers use its exports with no per-file import naming it at all — "global ' +
      'using" / implicit enclosing-namespace member access',
    recovery:
      "matching a uniquely-declared type name against other files' source text (#930) — the " +
      'name is only trusted when exactly one C# file project-wide declares it',
    residualRisk:
      'can still miss a real dependent that references the type via an alias, a generic type ' +
      'argument, or reflection',
  },
  'go-root-package-export': {
    languageLabel: 'Go',
    importGraphBlindSpot:
      'gives a file outside the root package no way to spell a reference to it except the ' +
      'module\'s own bare import path ("github.com/org/mod"), which names no specific file',
    recovery:
      'looking up which single root-level file actually exports a distinctive symbol the ' +
      "importing file's own call sites name (#1039) — only files that already import the " +
      'root package are considered, and an export declared by two root files is never guessed at',
    residualRisk:
      'cannot distinguish a genuine root-package reference from an unrelated call that merely ' +
      'shares the same distinctive name, and recovers nothing for a root file whose entire ' +
      'exported surface is single-segment',
  },
};

/**
 * Every mechanism id, derived from the table's keys rather than hand-listed
 * again -- so this array can never fall out of sync with the union the way the
 * docs page did in #980.
 */
export const INFERRED_DEPENDENT_MECHANISM_IDS = Object.keys(
  INFERRED_DEPENDENT_MECHANISMS,
) as InferredDependentMechanism[];

/** Join a list of clauses as "a", "a and b", "a, b and c". */
function joinClauses(clauses: string[]): string {
  if (clauses.length <= 1) return clauses[0] ?? '';
  return `${clauses.slice(0, -1).join(', ')} and ${clauses[clauses.length - 1]}`;
}

/**
 * The static, query-independent sentence naming which languages have a
 * recovery fallback at all, for prose surfaces that describe the field in the
 * abstract (the tool description, the server instructions, the caveat-reason
 * text, the docs page). Derived from the table, so a new mechanism updates
 * every one of them with no further edits -- exactly the update that #1039
 * silently skipped.
 */
export function summarizeInferredDependentMechanisms(): string {
  return joinClauses(
    INFERRED_DEPENDENT_MECHANISM_IDS.map(id => INFERRED_DEPENDENT_MECHANISMS[id].languageLabel),
  );
}

/**
 * The mechanism-specific half of `get_dependents`' `dependent-attribution-partial`
 * caveat note, for the mechanism(s) that actually ran on THIS query.
 *
 * Takes a list because nothing structurally forbids two mechanisms
 * contributing to one answer, even though today's two are mutually exclusive by
 * language (`enrichWithCSharpTypeReferenceDependents` only fires for C#,
 * `enrichWithGoRootPackageDependents` only for Go). Describing whatever is
 * actually present costs one `map` and removes the assumption that broke when
 * the second mechanism landed.
 */
export function describeInferredDependentRecovery(
  mechanisms: readonly InferredDependentMechanism[],
): { languageLabel: string; importGraphBlindSpot: string; recovery: string; residualRisk: string } {
  const descriptors = mechanisms.map(id => INFERRED_DEPENDENT_MECHANISMS[id]);
  return {
    languageLabel: joinClauses([...new Set(descriptors.map(d => d.languageLabel))]),
    importGraphBlindSpot: joinClauses([...new Set(descriptors.map(d => d.importGraphBlindSpot))]),
    recovery: joinClauses([...new Set(descriptors.map(d => d.recovery))]),
    residualRisk: joinClauses([...new Set(descriptors.map(d => d.residualRisk))]),
  };
}
