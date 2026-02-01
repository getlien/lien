---
name: dogfood
description: Build Lien, restart the MCP server, then thoroughly test all MCP tools against this codebase.
disable-model-invocation: true
user-invocable: true
allowed-tools: Bash(npm run build), Bash(npm run typecheck), Bash(npm test), Bash(npx lien *), Bash(kill *), Bash(lsof *), Bash(node *), mcp__lien__semantic_search, mcp__lien__list_functions, mcp__lien__get_complexity, mcp__lien__get_files_context, mcp__lien__get_dependents, mcp__lien__find_similar, Read, Glob, Grep
---

# Lien Dogfooding Session

You are running a full dogfooding session for Lien's MCP tools on the Lien codebase itself.

## Phase 1: Build

1. Run `npm run typecheck` — must pass with 0 errors
2. Run `npm run build` — must compile successfully

If either fails, stop and report the errors.

## Phase 2: Restart MCP Server

The Lien MCP server needs to be restarted so it picks up the fresh build.

1. Find the running Lien MCP server process: `lsof -i :7133` or look for the `node` process running `dist/index.js serve`
2. Kill it if running: `kill <pid>`
3. Wait a moment, then tell the user: **"Please run `/mcp` and restart the `lien` server, then press Enter to continue."** Claude Code manages the MCP server lifecycle — you cannot reconnect it programmatically.

**IMPORTANT:** Wait for the user to confirm the MCP server is back before proceeding to Phase 3.

## Phase 3: Test All MCP Tools

Test each of the 6 Lien MCP tools. For each tool, run a meaningful query against the Lien codebase, verify the results make sense, and note any issues.

### 3.1 — `semantic_search`

Run at least 3 queries with varying specificity:

- Broad: `semantic_search({ query: "How does the indexing pipeline work?" })`
- Specific: `semantic_search({ query: "Where are code chunks stored in the vector database?" })`
- Cross-cutting: `semantic_search({ query: "How does Lien detect test file associations?" })`

**Check:** Results should return relevant files with reasonable relevance scores. Flag if results seem off-topic or if relevance categories don't match expectations.

### 3.2 — `list_functions`

Run at least 3 pattern queries:

- `list_functions({ pattern: ".*Service.*" })`
- `list_functions({ pattern: ".*Handler.*" })`
- `list_functions({ symbolType: "class" })`
- `list_functions({ symbolType: "interface" })`

**Check:** Results should match the regex patterns. Verify a few results by reading the actual files to confirm they exist and are correctly categorized.

### 3.3 — `get_files_context`

Test with single and batch calls:

- Single: `get_files_context({ filepaths: "packages/cli/src/mcp/tools.ts" })`
- Batch: `get_files_context({ filepaths: ["packages/cli/src/indexer/chunker.ts", "packages/cli/src/vectordb/lancedb.ts"] })`

**Check:** Verify `testAssociations` are returned and point to actual test files. Verify chunks contain meaningful code sections.

### 3.4 — `get_dependents`

Test impact analysis:

- `get_dependents({ filepath: "packages/cli/src/vectordb/lancedb.ts" })`
- `get_dependents({ filepath: "packages/cli/src/indexer/chunker.ts" })`
- With symbol: `get_dependents({ filepath: "packages/cli/src/vectordb/lancedb.ts", symbol: "VectorDB" })`

**Check:** Dependents should be files that actually import the target. Verify a few by reading the import statements.

### 3.5 — `get_complexity`

Test complexity analysis:

- Top hotspots: `get_complexity({ top: 10 })`
- Specific files: `get_complexity({ files: ["packages/cli/src/mcp/tools.ts"] })`

**Check:** Results should include complexity metrics (cyclomatic, cognitive, halstead). Verify the most complex functions are genuinely complex by reading them.

### 3.6 — `find_similar`

Test code similarity:

- Pick a real code snippet from the codebase (read a file first) and search for similar patterns
- Example: find code similar to an import pattern, a function signature, or a common pattern in the codebase

**Check:** Results should return structurally similar code. Verify matches are genuine similarities, not false positives.

## Phase 4: Report

After testing all tools, produce a summary report with:

| Tool | Status | Notes |
|------|--------|-------|
| semantic_search | ✅/⚠️/❌ | ... |
| list_functions | ✅/⚠️/❌ | ... |
| get_files_context | ✅/⚠️/❌ | ... |
| get_dependents | ✅/⚠️/❌ | ... |
| get_complexity | ✅/⚠️/❌ | ... |
| find_similar | ✅/⚠️/❌ | ... |

Legend: ✅ = working correctly, ⚠️ = working with issues, ❌ = broken

Include:
- Any errors or unexpected behavior
- Response quality observations (relevance, accuracy)
- Performance notes (any tool noticeably slow?)
- Suggestions for improvement

Save the full report to `.wip/dogfood-report.md` (per project conventions for temporary docs).
