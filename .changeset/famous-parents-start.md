---
"@liendev/core": minor
"@liendev/lien": minor
---

---

"@liendev/lien": minor
"@liendev/core": minor

---

- **Claude Code support** - New `CLAUDE.md` project rules file for Claude Code integration with tool quick reference and workflow guidelines

- **`list_functions` fallback bug** - Content scan fallback now correctly filters by `symbolName` instead of `content`, preventing markdown docs from appearing in results

- **Simplified `init` command** - Removed Cursor rules installation; init now just displays setup information (config-less approach)
- **Improved MCP tool descriptions** - `semantic_search` now positioned as "complements grep" rather than replacement
- **Better vectordb scan coverage** - `scanWithFilter` and `querySymbols` now scan all database records for complete results
