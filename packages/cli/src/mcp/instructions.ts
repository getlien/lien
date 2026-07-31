import { ATTRIBUTION_CAVEAT_REASON_TEXT } from './attribution-caveat-reasons.js';

/**
 * MCP server instructions returned on `initialize`.
 *
 * Every connecting MCP client receives this string as always-on guidance
 * for how to use Lien's tools. Keep it tight — it travels with every turn.
 */
export const SERVER_INSTRUCTIONS = `Lien provides fast lexical code search and dependency analysis over this codebase.
Use Lien tools proactively — they complement grep/glob rather than replace each
other. Prefer Lien for keyword discovery and structural impact; use grep for
things you can name exactly: a known symbol name, an error string, a config key,
a TODO.

REQUIRED before Edit/Write on any file:
  get_files_context({ filepaths }) — returns imports, callSites, and test
  associations. Batch form: { filepaths: [...] } for multi-file edits.
  Always check testAssociations and run those tests after changes.
  If it returns complexityHeadroom, those functions are at/near their
  complexity budget — avoid adding complexity to them. complexityHeadroomWarning
  (when present) is the same signal as one imperative line — read it first.

REQUIRED before renaming, removing, or changing the signature of any exported
symbol:
  get_dependents({ filepath, symbol }) — check dependentCount and riskLevel.
  If riskLevel is "high" or "critical", list affected dependents to the user
  before editing. Read riskReasoning for the "why" (e.g. "14 callers, 3
  untested, max complexity 18") before deciding how cautious to be. A
  high/critical complexity signal among dependents always lifts riskLevel
  above "low", even if every dependent is fully tested.

  For "what else could break?" impact analysis, pass depth: 2 (or up to 5) to
  walk the import graph transitively. Each dependent carries a 'hops' field;
  'truncated: true' means the BFS stopped at 'maxNodes' (default 500).
  Symbol-level queries stay at depth 1 — pass depth only for file-level.

  If a result carries attributionCaveat, dependentCount/riskLevel cannot be
  trusted as a verified clear — never treat a low count (especially 0) as
  "safe" or "unused" without checking it first. Its reason tells you why:
  "unresolved-target" means ${ATTRIBUTION_CAVEAT_REASON_TEXT['unresolved-target']}
  "symbol-attribution-degraded" means ${ATTRIBUTION_CAVEAT_REASON_TEXT['symbol-attribution-degraded']}
  "dependent-attribution-partial" means ${ATTRIBUTION_CAVEAT_REASON_TEXT['dependent-attribution-partial']}
  "dependent-attribution-incomplete" means ${ATTRIBUTION_CAVEAT_REASON_TEXT['dependent-attribution-incomplete']}
  (The latter two reasons only fire for FILE-level queries, i.e. no "symbol"
  argument.) riskLevel is not adjusted for any of the latter three and may
  still read "low"; attributionCaveat is the authoritative signal in all
  four cases.

For discovery ("where is X?", "how does Y work?"), choose by what you already
know. If you know the exact name, go straight to list_functions (a symbol) or
grep (a literal) — do not paraphrase a name you already have. If you know the
concept but not the name, call search_code BEFORE falling back to grep/glob.

search_code runs full-text BM25 keyword search over code, docstrings, and
camelCase-split identifiers. Query with concrete KEYWORDS, identifiers, and
domain terms ("chunk overlap config", "parse import statement") — NOT
natural-language questions. There are no embeddings, so a meaning-only paraphrase
that shares no words with the code will not match; use vocabulary that appears in
the code or comments.

Zero results is NOT proof of absence. The index may simply not have caught up
with a recent edit, in which case a symbol that exists on disk is unfindable and
the tool cannot tell you which case you are in. Before concluding something does
not exist, grep for it, or re-run after "lien index". Same rule for a result set
that looks plausible but omits what you asked for.

Tool selection:
  search_code       — keyword/full-text discovery
  list_functions    — exact by-name/pattern lookup; fastest for structural queries
  find_similar      — before adding new code, check for existing patterns
  get_complexity    — before refactoring; identify real hotspots
  get_files_context — before editing (MANDATORY)
  get_dependents    — before symbol changes (MANDATORY)

Batch when possible — batched calls are materially cheaper than sequential
singletons.`;
