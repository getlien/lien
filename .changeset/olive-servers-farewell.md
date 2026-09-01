---
'@liendev/lien': patch
---

**`lien serve` now warns that it is being removed in the next release.** This version is the last one that ships the MCP server, the persisted SQLite index and FTS5 lexical search; the next removes all three.

The notice prints to stderr on every `lien serve` start — never to stdout, which carries the MCP protocol stream — and it cannot be suppressed. That is deliberate: an editor configured against `lien serve` will simply stop working when the next version lands, and a user who never sees a warning experiences that as a tool that silently broke.

Nothing else changes. `lien serve` and every MCP tool behave exactly as before in this release.

What replaces it is a CLI you run directly, with no server, no index and no editor configuration:

| Command | Answers |
|---|---|
| `lien health` | Which functions are risky to change? (complexity × fan-in ÷ test coverage) |
| `lien delta` | Did this change push a function over a threshold it was under before? |
| `lien review` | What deterministic signals fire on this diff? |
| `lien complexity` | Where is the tech debt? |

The MCP tools themselves — `search_code`, `get_dependents`, `get_files_context`, `list_functions`, `find_similar`, `get_complexity` — have no replacement. Use your editor's own search and your agent's own file-reading tools.

If you need the server, pin this version: run `lien --version`, then `npm install -g @liendev/lien@<that version>`.
