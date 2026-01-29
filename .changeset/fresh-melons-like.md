---
"@liendev/lien": minor
---

MCP tool responses now include only the metadata fields relevant to each tool, reducing context window usage by ~55%. Each tool has a per-tool allowlist that strips unnecessary fields (e.g., semantic_search
no longer returns Halstead metrics or import maps). Results are also deduplicated across all search handlers, and find_similar filters out low-score self-matches.
