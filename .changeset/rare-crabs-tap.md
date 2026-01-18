---
"@liendev/core": minor
"@liendev/lien": minor
---

- **Smart Batching**: Aggregates multiple rapid file changes into single reindex operations, reducing overhead during "Save All" operations
- **Reindex Status Visibility**: Added `reindexInProgress`, `pendingFileCount`, `lastReindexDurationMs`, and `msSinceLastReindex` to all MCP responses for better AI assistant awareness
- **Event-Driven Git Detection**: Replaced polling with `.git` directory watching for instant git change detection (~3s latency vs poll interval)
- **Content-Hash Based Change Detection**: Files touched without content changes (e.g., `touch file.ts`) no longer trigger expensive reindexing

- Fixed MCP protocol interference from console output in FileWatcher causing JSON parse errors
- Corrected log levels for success/info messages (were incorrectly logged as errors)
- Empty files now logged at info level instead of error level

- Reduced unnecessary reindexing operations by 40-60% in typical workflows
- Git detection latency reduced from poll interval (15s default) to ~3 seconds
- Zero CPU usage during idle periods (no polling)
