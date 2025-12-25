---
"@liendev/lien": minor
"@liendev/core": minor
---

- **Branch & commit tracking for Qdrant backend**: Automatically isolates indices by git branch and commit SHA, preventing data overwrites when working with multiple branches or PRs
- **Fail-fast validation**: Factory now throws clear errors when config file exists but has syntax errors, instead of silently falling back to LanceDB

- Fixed factory silently falling back to LanceDB when Qdrant was explicitly configured but encountered errors
- Fixed payload mapper incorrectly converting `0`, empty strings, and empty arrays to default values
- Fixed `searchCrossRepo` missing validation logic that other search methods provide

- Refactored Qdrant filter builder for better code reuse and consistency
- Tightened TypeScript types for Qdrant payload metrics
- Enhanced error messages for Qdrant configuration issues
- Updated documentation for branch/commit isolation behavior

When using Qdrant backend, all index operations now automatically:

- Extract current git branch and commit SHA
- Include branch/commit in point IDs to prevent collisions
- Filter all search queries by current branch (unless explicitly disabled)

**Migration**: None required. This release is 100% backward compatible with existing indices.
