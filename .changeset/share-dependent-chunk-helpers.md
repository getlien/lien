---
"@liendev/parser": minor
"@liendev/lien": patch
---

Share the dependent-chunk matching helpers instead of keeping two copies

`addFuzzyMatchChunks` and `findDependentChunks` existed twice — once in
`@liendev/parser`'s `dependency-analyzer.ts` and once, copied, in the CLI's MCP
handler. The bodies were logically identical; the only real difference was the
chunk type (`CodeChunk` vs `core`'s `SearchResult`).

That copy is why the `'../..'` fuzzy-match fix had to be applied twice, and why
one copy could be fixed while the other kept the bug.

Both helpers are now generic over `<T extends CodeChunk>` and exported from
`@liendev/parser`, and the CLI imports them. `SearchResult` already satisfies
`CodeChunk` structurally, so this is a type-level change only — no behavioural
change to `get_dependents`.
