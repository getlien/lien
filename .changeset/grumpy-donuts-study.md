---
"@liendev/lien": minor
"@liendev/core": minor
---

- **Qdrant backend support with multi-tenant capabilities**

  - Full `VectorDBInterface` implementation using Qdrant vector database
  - Multi-tenant support via `orgId`/`repoId` payload filtering
  - Collection-per-organization naming: `lien_org_{orgId}`
  - Automatic `orgId` detection from git remote URLs
  - Version management and reconnection support

- **Cross-repository semantic search**

  - Search across all repositories in your organization with a single query
  - Optional repository filtering via `repoIds` parameter
  - Results grouped by repository for easy navigation
  - Works with `semantic_search`, `get_dependents`, and `get_complexity` MCP tools

- **Global configuration system**

  - Optional `~/.lien/config.json` for backend selection (only needed for Qdrant)
  - Environment variable support: `LIEN_BACKEND`, `LIEN_QDRANT_URL`, `LIEN_QDRANT_API_KEY`
  - Auto-detection of frameworks and organization ID
  - Zero-config by default (LanceDB remains default backend)

- **Enhanced MCP tools for cross-repo operations**

  - `semantic_search`: Added `crossRepo` and `repoIds` parameters
  - `get_dependents`: Cross-repo dependency analysis support
  - `get_complexity`: Organization-wide complexity analysis support

- **Configuration system simplified**

  - Removed requirement for per-project `.lien.config.json` files
  - Removed config migration logic and version tracking
  - All functionality now works with sensible defaults
  - Old config files are ignored (no errors, backward compatible)

- **Backend selection via factory pattern**

  - `createVectorDB()` factory function selects backend based on global config
  - Automatic fallback to LanceDB if Qdrant configuration is invalid
  - Improved error messages for debugging backend setup

- **Better developer experience**

  - Zero configuration required for basic usage
  - Auto-detection of git organization from remote URLs
  - Clearer error messages for missing configuration
  - Comprehensive test coverage for Qdrant backend (448 tests)

- **Code organization**

  - Extracted dependency analysis into dedicated module
  - Introduced `QdrantPayloadMapper` for payload transformations
  - Refactored MCP server setup for better modularity
  - Improved file watcher and git org extraction logic

- Updated README with Qdrant setup instructions
- Added cross-repo search examples
- Updated MCP tools documentation with new parameters
- Removed references to per-project config files

- **Backward Compatible**: ✅ No breaking changes
- **Migration Required**: ❌ None - works with existing indices
- **Tests**: 583/583 passing
- **Files Changed**: 67 files (3,648 additions, 3,371 deletions)
