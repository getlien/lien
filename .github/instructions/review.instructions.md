---
applyTo: "**"
excludeAgent: "coding-agent"
---

# Lien Code Review Instructions

Review PRs for the Lien project - a local-first semantic code search tool for AI coding assistants via MCP.

---

## ⚠️ Critical: Lien-Specific Issues

**These break Lien in ways that are hard to debug. Flag immediately.**

### MCP Server (packages/cli/src/mcp/)

- **NEVER use `console.log()` in MCP server code** - stdout is reserved for JSON-RPC. Use the `log()` function passed via `ToolContext`, or `console.error()` for fatal errors.
- **All MCP tool responses must include `indexInfo`** - AI assistants rely on this for freshness detection.
- **Tool handlers must call `checkAndReconnect()`** before database operations - index may have been rebuilt externally.

### File Paths (Cross-Platform)

- **Always use `path.join()` or `path.resolve()`** - never string concatenation for paths.
- **Normalize paths before comparison** - `getCanonicalPath()` exists for this.
- **Watch for backslash issues on Windows** - use `.replace(/\\/g, '/')` when needed.

### Vector Database (packages/core/src/vectordb/)

- **Database operations can fail after index rebuild** - handle "Not found" errors gracefully.
- **Batch inserts must handle size limits** - check `VECTOR_DB_MAX_BATCH_SIZE`.
- **Version checks prevent stale reads** - don't skip `checkVersion()` calls.

### File Watcher (packages/cli/src/watcher/)

- **Batch timer must be cleared on stop** - or pending changes are lost.
- **Git change handler must be null-checked** - `this.gitChangeHandler?.()`.
- **Debounce timers need cleanup** - memory leak if watcher restarts.

### Indexing (packages/core/src/indexer/)

- **Content hashes must match algorithm** - check `isHashAlgorithmCompatible()`.
- **Manifest updates need file locking** - concurrent writes corrupt state.
- **Embedding dimension must be 384** - `EMBEDDING_DIMENSION` constant exists.

---

## 🔍 Standard Review (Quick Scan)

### Must Have
- [ ] **No `any` types** without `// eslint-disable` comment explaining why
- [ ] **Async functions have try/catch** or caller handles errors
- [ ] **New features have tests** - check `testAssociations` in get_files_context
- [ ] **Resource cleanup** - intervals cleared, watchers stopped, file handles closed

### Should Have
- [ ] **Functions under 50 lines** - extract if longer
- [ ] **Early returns** for error cases, not nested if/else
- [ ] **Descriptive names** - `processFile` not `doIt`, `userCount` not `n`

### Nice to Have
- [ ] **collect.js for complex aggregations** - groupBy, countBy, sum chains
- [ ] **JSDoc on exported functions** - especially in `@liendev/core`

---

## 🚩 Red Flags

**Stop and question these patterns:**

```typescript
// ❌ stdout pollution in MCP server
console.log('Processing...'); // BREAKS MCP JSON-RPC

// ❌ Path concatenation
const fullPath = rootDir + '/' + filepath; // BREAKS ON WINDOWS

// ❌ Missing null check
await this.gitChangeHandler(); // CRASHES IF NOT SET

// ❌ Swallowed errors
try { ... } catch (e) { } // HIDES BUGS

// ❌ Hardcoded dimension
new Float32Array(384); // USE EMBEDDING_DIMENSION CONSTANT
```

---

## 📁 Review by Directory

### `packages/cli/src/mcp/`
- No console.log (use log function)
- Tool responses include indexInfo
- Handlers call checkAndReconnect()

### `packages/cli/src/watcher/`
- Timers cleared on stop
- Debounce logic correct
- Git handler null-safe

### `packages/core/src/vectordb/`
- Batch size limits respected
- Error recovery for stale index
- Version checking in place

### `packages/core/src/indexer/`
- Content hash backward compatible
- Manifest locking for concurrent access
- Embedding dimension from constant

### `packages/action/`
- Token usage tracked
- API errors handled gracefully
- JSON parsing has try/catch

---

## Example Comments

**Critical (Lien-specific):**
```
🚨 MCP Protocol: `console.log()` on line 45 will corrupt the JSON-RPC stream. 
Use `log()` from ToolContext or `console.error()` for diagnostics.
```

**Standard issue:**
```
⚠️ Missing error handling: If `vectorDB.search()` throws, this promise rejects 
without cleanup. Wrap in try/catch and call `reindexStateManager.failReindex()`.
```

**Suggestion:**
```
💡 This nested loop could use collect.js:
`collect(files).groupBy('language').map(g => g.count()).all()`
```

---

## Before Approving

1. **Does CI pass?** (typecheck, build, test)
2. **Are Lien-specific concerns addressed?** (MCP, paths, vectordb)
3. **Is this the simplest solution?**

**When in doubt: Is this code that a junior dev could debug at 2am?**
