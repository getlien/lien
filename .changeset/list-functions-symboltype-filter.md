---
'@liendev/lien': patch
'@liendev/core': patch
---

feat(mcp): add symbolType filter to list_functions tool

Adds an optional `symbolType` parameter to the `list_functions` MCP tool,
allowing callers to filter results by symbol kind: function, method, class,
or interface. The `function` filter includes methods for backward compatibility;
use `method` to target only class/object methods.
