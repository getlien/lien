# Auto-Reconnection Test Guide

This guide tests that the MCP server automatically reconnects after reindexing without requiring a Cursor restart.

## Test Setup

1. **Start MCP server in one terminal:**
   ```bash
   cd /Users/alfhenderson/Code/lien
   lien serve --verbose
   ```

2. **Keep Cursor open** with the Lien MCP server connected

## Test Steps

### Step 1: Initial Search
In Cursor, run a semantic search:
```
Use Lien to search for "embeddings initialization"
```

Expected: Should return results from the current index.

### Step 2: Trigger Reindex
In a separate terminal:
```bash
cd /Users/alfhenderson/Code/lien
lien reindex
```

Expected output should include:
- "Indexed X files (Y chunks)"
- Version file is written to `~/.lien/indices/lien-{hash}/.lien-index-version`

### Step 3: Search Again (Without Restarting)
In Cursor, run another semantic search **WITHOUT restarting the MCP server**:
```
Use Lien to search for "vector database connection"
```

Expected behavior:
- In the MCP server terminal (with --verbose), you should see:
  ```
  [Lien MCP] Index version changed, reconnecting to database...
  [Lien MCP] Reconnected to updated index
  ```
- Search should return results successfully
- No errors should occur

### Step 4: Verify Version File
Check that the version file exists:
```bash
cat ~/.lien/indices/lien-*/lien-index-version
```

Should show a timestamp (e.g., `1762946000000`).

## Success Criteria

✅ MCP server detects version change automatically
✅ Server reconnects without manual restart
✅ Searches work correctly after reconnection
✅ No "Not found" or "corrupted index" errors
✅ Version file is created after reindexing

## Troubleshooting

If auto-reconnection doesn't work:
- Ensure MCP server was started with the latest build (`npm run build`)
- Check that version file exists: `~/.lien/indices/{project-hash}/.lien-index-version`
- Verify verbose logging shows version checks
- Cache expires after 1 second, so try waiting 2 seconds between reindex and next search

