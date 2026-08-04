import { detectLanguage, hasDependentAttributionBlindSpot } from '@liendev/parser';
import type { ToolResult } from './metadata-shaper.js';

/**
 * Honesty pass over `search_code`'s `dependentCount` field (#1072).
 *
 * `search_code` publishes `metadata.dependentCount` on every result and, before
 * this module, asserted it as fact on every branch — no `note`, no
 * `attributionCaveat`, no degraded marker anywhere on the path.
 * `get_dependents` carries the whole vocabulary for exactly the same number;
 * this path carried none of it. That made #1072 the inverse of #1014: not a
 * caveat that over-fires and gets trained out, but one that never fires.
 *
 * ## The four situations that all render as `0`, and what each gets
 *
 * 1. **Resolved; genuinely nothing imports this file.** A real, useful answer.
 *    Gets NOTHING — no note, no omission, no marker. This is the load-bearing
 *    case: #1014's cost was a caveat that fired on essentially every healthy
 *    session, and a hedge on a genuine zero would rebuild it. The negative
 *    control in `test/integration/index-state-matrix.test.ts` pins it.
 *
 * 2. **The language's import forms cannot name this file at all** — C#'s
 *    `global using` / enclosing-namespace access, Java/Kotlin's same-package
 *    visibility, Swift's whole-module `import Foundation` (a tested, documented
 *    structural zero, #884). The field is OMITTED for that result. No note.
 *    Omission rather than a caveat because the value carries no information
 *    whatsoever there, and a wrong number is worse than an absent one; no note
 *    because a response-level warning would fire on most searches in four whole
 *    languages, which is precisely #1014's shape. Gated on
 *    `hasDependentAttributionBlindSpot` — the SAME predicate, applied to the
 *    same `detectLanguage` result, that `get_dependents` uses for its
 *    `dependent-attribution-incomplete` caveat — in conjunction with a zero
 *    count, exactly as `checkDependentAttributionIncomplete` does. Positive
 *    counts in those languages are kept: they are a real recovered floor (C#
 *    gets essentially all of its counts from the type-reference tier), and
 *    dropping them would destroy information rather than add honesty.
 *
 * 3. **The counts were never computed for this store** — an index written
 *    before `dependent_counts` existed has an empty table, so EVERY count reads
 *    0 for a reason that has nothing to do with the code. Whole-corpus, so it
 *    gets ONE response-level note plus omission on every result. This is the
 *    highest-value case and the cheapest: one note per call, actionable ("run
 *    lien index"), and it clears itself permanently after one index run. Gated
 *    on `VectorDBInterface.hasDependentCounts()` — stored state, never the
 *    shape of the numbers, because a corpus whose counts are legitimately all
 *    zero is indistinguishable from "never computed" on the numbers alone.
 *
 *    "Clears itself after one index run" is load-bearing prose, and it was
 *    FALSE as shipped (#1084): the upgrade path that produces this note is
 *    exactly the one where `lien index` finds no content changes, so the note's
 *    own instruction did nothing and only `--force` worked. It is true now
 *    because `core`'s `backfillDependentCounts` makes the counts a MIGRATION
 *    the next `lien index` completes regardless of whether anything changed.
 *    If that call is ever removed, this note becomes a lie again — a caveat
 *    that prescribes a remedy owes the reader a remedy that works, and a failed
 *    instruction spends more trust than silence would have.
 *
 *    It also must not fire when the counts DO exist somewhere the read path
 *    reaches. #1085: `OverlayBackend` asked only the worktree's own overlay, so
 *    every fresh linked worktree got this note while the shared base's counts
 *    ranked the very results it was attached to. That is #1014's failure mode
 *    with a different sign — a note firing on every agent session gets trained
 *    out, and takes the true ones with it.
 *
 * 4. **The count lags the working tree** by up to one full index run, because
 *    incremental single-file updates deliberately don't recompute whole-corpus
 *    counts. Gets NO response caveat at all. It is true on nearly every call,
 *    it is an accepted trade for a soft ranking tie-breaker (see
 *    `core`'s `dependent-counts.ts` "Freshness contract"), and "run a full
 *    index to refresh a tie-breaker" is not proportionate advice. A per-call
 *    note here would be pure noise — the #1014 shape again. It is documented
 *    instead, in `search_code`'s tool description and on `SearchResult`.
 *
 * ## Why `note` and not a sixth `AttributionCaveatReason`
 *
 * `AttributionCaveatReason` describes why a `get_dependents` answer about a
 * CALLER-SUPPLIED filepath can't be trusted; all five reasons are properties of
 * that one target. Case 3 is a property of the whole store, and case 2 is
 * expressed by omission rather than by a value, so neither has a reason to
 * carry. Reusing the union here would mean widening its documented meaning
 * across five prose surfaces (#980) to describe something none of them is
 * about. `note` is already this tool's response-level honesty channel
 * (`formatNoIndexNote`), and `CLAUDE.md`'s MCP disposition row names
 * `note`/`attributionCaveat` interchangeably. No new vocabulary is introduced —
 * see #1018 on the three that already exist.
 */

/**
 * The one response-level note this module can emit (case 3). Unmissable
 * `⚠ Lien:` tone, matching `formatNoIndexNote`/`formatUnindexedPathsNote`, and
 * it names the single action that fixes it.
 */
export const DEPENDENT_COUNTS_NOT_COMPUTED_NOTE =
  '⚠ Lien: this index predates reverse-dependency counting, so dependentCount has been ' +
  'omitted from these results rather than reported as 0 — the counts were never computed ' +
  'here, which tells you nothing about how connected the code is. Run "lien index" to ' +
  'populate them; use get_dependents meanwhile for an authoritative per-file answer.';

/** `results` with the honesty pass applied, plus the note it wants to add (if any). */
export interface DependentCountHonesty {
  results: ToolResult[];
  note?: string;
}

/** A copy of `result` with `dependentCount` absent — never present-but-wrong. */
function withoutDependentCount(result: ToolResult): ToolResult {
  const metadata = { ...result.metadata };
  delete metadata.dependentCount;
  return { ...result, metadata };
}

/**
 * True for case 2: a zero that this result's language could not have produced a
 * non-zero for. Mirrors `checkDependentAttributionIncomplete`'s conjunction
 * (zero count AND a blind-spot language, keyed off `detectLanguage` on the
 * path) rather than re-deriving either half.
 */
function isBlindSpotZero(result: ToolResult): boolean {
  if (result.metadata.dependentCount !== 0) return false;
  const language = detectLanguage(result.metadata.file);
  return language !== null && hasDependentAttributionBlindSpot(language);
}

/**
 * Apply the pass above to one `search_code` response's shaped results.
 *
 * `countsComputed` must come from `VectorDBInterface.hasDependentCounts()` —
 * the whole point is that this decision is made from stored index state, not
 * from how many zeros happen to be in `results`.
 */
export function applyDependentCountHonesty(
  results: ToolResult[],
  countsComputed: boolean,
): DependentCountHonesty {
  // Nothing to be honest about if no result carries the field in the first
  // place, so never speak about it then (a note about an absent field would be
  // over-firing by construction).
  if (!results.some(r => r.metadata.dependentCount !== undefined)) return { results };

  if (!countsComputed) {
    return {
      results: results.map(withoutDependentCount),
      note: DEPENDENT_COUNTS_NOT_COMPUTED_NOTE,
    };
  }

  return { results: results.map(r => (isBlindSpotZero(r) ? withoutDependentCount(r) : r)) };
}
