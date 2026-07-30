---
'@liendev/lien': patch
---

`SERVER_INSTRUCTIONS` — the always-on guidance every MCP client receives on
`initialize` — told models to "call `search_code` FIRST" for discovery,
unconditionally, while its own opening paragraph reserved grep for "exact
literals" and omitted exact symbol names entirely. So an agent that already knew
the identifier it wanted was being instructed to paraphrase it into a BM25 query
first.

CLAUDE.md already carried the correct split ("Use grep/glob ONLY for: exact symbol
names, literal strings, config keys, TODOs"), so this was one-directional drift —
and the surface a **model** actually reads was the wrong half.

Reframed around what the caller already knows: an exact symbol name goes to
`list_functions`, an exact literal to grep — *don't paraphrase a name you already
have* — and a concept without a name goes to `search_code` before falling back to
grep/glob. Same tools, same BM25 / camelCase-split / no-embeddings caveats, no new
policy.

Both texts also now state that **zero results is not proof of absence**: an index
that hasn't caught up with a recent edit makes a symbol that exists on disk
unfindable, and the tool cannot tell you which case you're in. Observed during the
post-release dogfood — a search for a symbol added after the last index returned
five results ranked `"highly_relevant"`, none of which contained it, and grep found
it immediately. The tool-side half of that honesty is in the same release; this is
the always-on guidance half.

The hand-sync between these two documents is guarded by
`instructions.claude-md-sync.test.ts`, which requires both to carry the discovery
framing and all three search caveats.
