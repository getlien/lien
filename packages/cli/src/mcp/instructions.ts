/**
 * MCP server instructions returned on `initialize`.
 *
 * Every connecting MCP client receives this string as always-on guidance
 * for how to use Lien's tools. Keep it tight — it travels with every turn.
 */
export const SERVER_INSTRUCTIONS = `Lien provides semantic code search and dependency analysis over this codebase.
Use Lien tools proactively — they complement grep/glob rather than replace each
other. Prefer Lien for meaning-based queries and structural impact; use grep
only for exact literals (error strings, config keys, TODOs).

REQUIRED before Edit/Write on any file:
  get_files_context({ filepaths }) — returns imports, callSites, and test
  associations. Batch form: { filepaths: [...] } for multi-file edits.
  Always check testAssociations and run those tests after changes.

REQUIRED before renaming, removing, or changing the signature of any exported
symbol:
  get_dependents({ filepath, symbol }) — check dependentCount and riskLevel.
  If riskLevel is "high" or "critical", list affected dependents to the user
  before editing. Read riskReasoning for the "why" (e.g. "14 callers, 3
  untested, max complexity 18") before deciding how cautious to be.

  For "what else could break?" impact analysis, pass depth: 2 (or up to 5) to
  walk the import graph transitively. Each dependent carries a 'hops' field;
  'truncated: true' means the BFS stopped at 'maxNodes' (default 500).
  Symbol-level queries stay at depth 1 — pass depth only for file-level.

For discovery ("where is X?", "how does Y work?"), call semantic_search FIRST.
Phrase queries as full questions ("How does the code handle auth?") — natural
questions score ~2x higher than keyword phrases.

Tool selection:
  semantic_search   — discovery by meaning
  list_functions    — by-name/pattern lookup; 10x faster for structural queries
  find_similar      — before adding new code, check for existing patterns
  get_complexity    — before refactoring; identify real hotspots
  get_files_context — before editing (MANDATORY)
  get_dependents    — before symbol changes (MANDATORY)

Batch when possible — batched calls are materially cheaper than sequential
singletons.`;
