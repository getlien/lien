/**
 * Shared presentation helper for `computeBlastRadiusRisk`'s reasoning text.
 *
 * Every surface that computes blast-radius risk (`get_dependents`, `lien
 * annotate`) deliberately feeds `productionDependentCount` into
 * `computeBlastRadiusRisk`'s `dependentCount` -- a test file calling the
 * target shouldn't weigh into risk the same way a production caller does
 * (#928). But each surface's own top-level dependent count is the WIDER
 * total (production + test), reported alongside the risk verdict. Left
 * unrelabeled, a reader sees two different numbers answering what looks like
 * the same question ("14 callers" next to a wider total) with nothing
 * indicating they're deliberately scoped differently.
 *
 * `relabelCallerReasoning` makes that scoping explicit in the reasoning
 * text itself, instead of changing either number. Originally added for
 * `get_dependents` (#928); `lien annotate` fed the WIDER (production + test)
 * count into `computeBlastRadiusRisk` instead of the production-only count
 * until HOOKS-2 -- both surfaces now share this single relabeling
 * implementation so the "N callers" -> "N production callers" wording can
 * never drift out of sync between them the way the underlying population
 * once did.
 */
export function relabelCallerReasoning(reasoning: string[]): string[] {
  return reasoning.map(entry =>
    /^\d+ callers?$/.test(entry) ? entry.replace(/ callers?$/, m => ` production${m}`) : entry,
  );
}
