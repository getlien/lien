import { summarizeInferredDependentMechanisms } from '@liendev/parser';

/**
 * Why a `get_dependents` answer's counts can't be trusted as a verified
 * clear (#940). Exactly one reason can ever apply to a given response --
 * see `buildAttributionCaveat`'s doc comment in `handlers/get-dependents.ts`
 * for why these five are mutually exclusive by construction:
 *
 * - `unresolved-target`: `filepath` isn't resolvable in the index at all
 *   (not in the manifest, or has zero chunks in the current scan -- #927,
 *   #928, #937). Every count in the response is then a deliberate `0`, not
 *   a fuzzy-matched answer.
 * - `symbol-attribution-degraded`: `symbol` isn't a top-level export of
 *   `filepath` (the shape of a method or constructor -- #931). It may also
 *   be a typo'd/hallucinated/removed name -- those look identical on that
 *   signal alone, so the response widens to file-level dependents instead
 *   of asserting an unverifiable symbol-scoped count.
 * - `type-symbol-attribution-incomplete`: `symbol` IS a top-level export of
 *   `filepath`, but it names a TYPE declaration (class/struct/interface/
 *   enum) rather than a function or method (#1015). Usage attribution is
 *   call-site-driven, and nothing "calls" a type by its own name the way a
 *   function call does (constructor calls, type hints, `extends`/
 *   `implements` clauses, generic type arguments, and dependency-injected
 *   property access don't reliably surface as a tracked call site), so
 *   `totalUsageCount`/`usages` are a partial, best-effort floor -- often `0`
 *   even when real usages exist -- never a verified total. Distinct from
 *   `symbol-attribution-degraded`: that one fires when `symbol` is NOT a
 *   top-level export at all; this one fires when it very much IS one, just
 *   not the kind of export call-site tracking can see through.
 * - `dependent-attribution-partial`: a file-level query (no `symbol`) found
 *   zero import-based dependents, but ONE OF PARSER'S NON-IMPORT FALLBACKS
 *   recovered one or more -- those entries are tagged `confidence: 'inferred'`
 *   in `dependents` and name the mechanism that recovered them in
 *   `inferredVia`, and the counts are a recovered lower bound, not a
 *   verified/complete answer. Which fallbacks exist is deliberately NOT listed
 *   here: `@liendev/parser`'s `INFERRED_DEPENDENT_MECHANISMS` is the single
 *   source, and this reason's text below derives from it. Listing them here is
 *   exactly what went stale when #1039 added Go's alongside #930's C# one
 *   (#1018).
 * - `dependent-attribution-incomplete`: a file-level query (no `symbol`)
 *   came back with zero dependents in a language where the import graph
 *   structurally can't see every real usage, e.g. C#'s `global using` /
 *   implicit enclosing-namespace access (#930, #936), or Java/Kotlin's
 *   same-package visibility and Swift's whole-module access (#1005), EVEN
 *   AFTER any applicable fallback above also found nothing.
 *
 * This is the SINGLE SOURCE for the model/user-facing explanation of each
 * reason (`ATTRIBUTION_CAVEAT_REASON_TEXT` below). #941 hand-wrote this
 * prose into three model-facing surfaces at once; #951 fixed two and
 * needed a second sub-commit for the third; #980 found the remaining two
 * (a JSON schema description read by every MCP client on connect, and the
 * public docs page, which also omitted `dependent-attribution-partial`
 * entirely) still wrong at HEAD. Every prose surface -- tool description
 * (`tools.ts`), server instructions (`instructions.ts`), schema description
 * (`schemas/dependents.schema.ts`), and the docs page
 * (`site/docs/guide/mcp-tools.md`) -- MUST interpolate the text below
 * rather than hand-writing this explanation again. A JSDoc comment can't
 * interpolate a runtime value, so `handlers/get-dependents.ts`'s doc
 * comment on `buildAttributionCaveat` points back here instead of
 * re-deriving the wording.
 */
export type AttributionCaveatReason =
  | 'unresolved-target'
  | 'symbol-attribution-degraded'
  | 'type-symbol-attribution-incomplete'
  | 'dependent-attribution-partial'
  | 'dependent-attribution-incomplete';

/**
 * One canonical, hedged sentence per reason -- what it means for the caller
 * and what to do about it. Interpolate this into every prose surface; never
 * hand-write the explanation again at a new call site.
 *
 * `Record<AttributionCaveatReason, string>` makes the compiler reject this
 * object literal unless it has EXACTLY the union's members as keys -- add a
 * fifth reason to the union and this line fails to compile until its text
 * is added here too.
 *
 * That guard covers the set of REASONS, and only that. It cannot see a change
 * in what an existing reason COVERS, which is how #1039's second recovery
 * mechanism reached production with five surfaces still saying "C#" (#1018).
 * `dependent-attribution-partial` below therefore derives its mechanism list
 * from `@liendev/parser`'s own `Record`-guarded table instead of naming any
 * mechanism itself -- the two forcing functions compose, one per axis.
 */
export const ATTRIBUTION_CAVEAT_REASON_TEXT: Record<AttributionCaveatReason, string> = {
  'unresolved-target':
    "filepath isn't resolvable in the index at all (never indexed, misspelled, or a typo'd " +
    'directory prefix) — every count in the response is a deliberate 0, not a confirmed empty ' +
    'dependency graph. Try search_code or list_functions to find the real path, or run "lien ' +
    'index" if the file was added recently.',

  'symbol-attribution-degraded':
    "symbol isn't a top-level export and its call sites couldn't be confirmed — it may be a " +
    "real method/constructor, or it may be a typo'd/hallucinated/removed name (the note says " +
    'which); either way, dependentCount/riskLevel/dependents become the file-level answer ' +
    '(every file that imports filepath), not a verified count for symbol itself.',

  'type-symbol-attribution-incomplete':
    'symbol names a class/struct/interface/enum declaration, not a function or method — ' +
    'usage attribution is call-site-driven, and nothing "calls" a type by its own name the ' +
    'way a function call does (constructor calls, type hints, extends/implements clauses, ' +
    "generic type arguments, and dependency-injected property access don't reliably surface " +
    'as a tracked call site). totalUsageCount/usages are a partial, best-effort floor — often ' +
    '0 even when real usages exist — never a verified total. When the dependency graph can ' +
    'verify a non-call-site import for the symbol anyway (#1015), the response names those ' +
    'files in importedBy, with no line number attached (that would be fabricated). ' +
    "dependentCount/dependents (which files import symbol) remain reliable UNLESS filepath's " +
    'language also has an import-invisible same-unit access shape (C#/Java/Kotlin/Swift, ' +
    '#1005) — the note says so explicitly when that applies (#1057). Verify with grep before ' +
    'concluding the type is unused or safe to rename.',

  'dependent-attribution-partial':
    'a file-level query (no symbol) found zero import-based dependents, but a lower-confidence ' +
    'non-import fallback recovered some dependents anyway (those entries carry ' +
    'confidence: "inferred", and inferredVia names which fallback found them; today ' +
    `${summarizeInferredDependentMechanisms()} have one). Treat the counts as a recovered ` +
    'floor, not a complete answer — the note explains what that specific fallback can still ' +
    'miss.',

  'dependent-attribution-incomplete':
    'a file-level query (no symbol) came back with zero dependents in a language where the ' +
    "import graph structurally can't see every real usage (e.g. C#'s global using / implicit " +
    "enclosing-namespace access, Java/Kotlin's same-package visibility, or Swift's " +
    'whole-module access), even after any applicable non-import fallback above also found ' +
    'nothing. Treat dependentCount: 0 and riskLevel: "low" as a floor, not a finding — verify ' +
    'with grep before concluding the file is unused.',
};

/**
 * Every `AttributionCaveatReason`, in the order prose surfaces list them.
 * Derived from `ATTRIBUTION_CAVEAT_REASON_TEXT`'s keys rather than
 * hand-listed again, so this array can never silently fall out of sync with
 * the union the way the docs page did in #980.
 */
export const ATTRIBUTION_CAVEAT_REASONS = Object.keys(
  ATTRIBUTION_CAVEAT_REASON_TEXT,
) as AttributionCaveatReason[];
