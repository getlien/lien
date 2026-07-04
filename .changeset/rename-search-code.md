---
'@liendev/lien': minor
---

**BREAKING:** the `semantic_search` MCP tool is renamed to `search_code`.

The old name promised embeddings-based semantic matching; since the switch to lexical FTS5 search it no longer does, so the name now says what the tool is: full-text keyword search over code. There is no alias — update `semantic_search` references in your CLAUDE.md, agent prompts, and MCP configs to `search_code`. Parameters, behavior, and response shape are unchanged.

Also fixes `lien index` spinner copy that still claimed embeddings were being generated ("Generating embeddings", "Downloading AI brain") — indexing messages now describe what actually happens: parsing, chunking, dependency mapping, and building the FTS5 index.
