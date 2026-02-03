---
"@liendev/lien": minor
---

### Features
- Add diagnostic notes to empty search results so LLMs get actionable guidance to self-correct (semantic_search, find_similar, list_functions)
- Derive `enclosingSymbol` in tool response metadata for richer context
- Add response size budgeting to prevent oversized MCP responses
- Add limit/offset pagination to `list_functions`

### Fixes
- Fix `get_files_context` returning empty chunks for some indexed files
- Fix `querySymbols` symbolType filtering by converting Arrow Vectors
- Fix barrel/re-export files producing zero chunks during indexing
- Cap `list_functions` offset to 10,000 to prevent pathological DB queries

### Docs
- Document response shapes in MCP tool descriptions
- Document that symbol tracking only works for direct imports
