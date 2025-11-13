# Changelog

All notable changes to Lien will be documented in this file.

## [0.1.4] - 2025-01-13

### Changed
- **All version strings now read from package.json**: CLI version (`--version`), MCP server version, and banner version all dynamically read from `package.json`. No more hardcoded version strings to update manually.

## [0.1.3] - 2025-01-13

### Fixed
- **TypeError during reindexing**: Fixed "Cannot read properties of undefined (reading 'map')" error when converting test association paths. Added proper null/undefined checks for `relatedTests` and `relatedSources` arrays.

## [0.1.2] - 2025-01-13

### Fixed
- **[CRITICAL] Test associations were never being calculated**: The indexer was using absolute file paths but test pattern matching expected relative paths. This meant NO test associations were being detected for ANY files. Now paths are properly converted to relative before pattern matching, and converted back to absolute for storage.
- **Test association metadata now properly saved to database**: The indexer was calculating test associations but they weren't being stored in LanceDB. Now all test metadata (`isTest`, `relatedTests`, `relatedSources`, `testFramework`, `detectionMethod`) is properly persisted and accessible.
- **Laravel-style test detection**: Now correctly finds tests organized by type (`tests/Feature/`, `tests/Unit/`) instead of requiring parallel directory structure. Works for any framework that organizes tests by type rather than mirroring source structure.
- **Better handling of old indices**: When `get_file_context` detects an index without test association data, it now shows a helpful message: "Test associations not available. Run 'lien reindex' to enable test detection."
- **ASCII banner version now reads from package.json**: The version displayed in the banner was hardcoded. Now it dynamically reads from `package.json` so it always stays in sync.
- **Banner now displays on `lien index` and `lien reindex`**: These commands were missing the banner display. Now all commands show the consistent branded banner.

### Changed
- **Removed `find_tests_for` tool (redundant)**: Test associations are automatically included in the metadata for all tools. Use:
  - `get_file_context({ filepath: "..." })` - returns `testAssociations` field
  - `semantic_search({ query: "..." })` - results include test metadata in each chunk
  - This provides a cleaner, more integrated experience

### Added
- Test association metadata fields to VectorDB schema
- Recursive search within test directories for matching filenames (Strategy 2b)
- Better file path normalization in query logic
- Documentation clarifying how to access test associations through existing tools
- Comprehensive tests for Laravel-style PHP test organization

### Migration
**Important:** If you have an existing index, you must run `lien reindex` in your project to enable test associations. The automatic reconnection will detect and reload the new index - **no need to restart Cursor**.

## [0.1.1] - 2025-01-13

_This version was skipped - all changes rolled into 0.1.2 after discovering critical bugs during testing._

## [0.1.0] - 2025-01-12

### Added
- Initial release
- Local semantic code search via MCP
- Support for 12 programming languages
- Two-pass test association detection (convention + import analysis)
- Automatic git detection and incremental reindexing
- File watching support
- Auto-indexing on first run
- Config upgrade system
- Comprehensive test suite

