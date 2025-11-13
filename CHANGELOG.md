# Changelog

All notable changes to Lien will be documented in this file.
## [0.3.0] - 2025-11-13

### Added
- **Framework plugin architecture with monorepo support**



## [0.3.0] - 2025-01-14

### 🚀 Major Features

#### Framework Plugin Architecture
- **Monorepo Support**: Index multiple frameworks in a single repository with proper isolation
- **Path-Aware Indexing**: Each framework maintains its own include/exclude patterns and test detection rules
- **Smart Framework Detection**: Automatically detects Node.js, Laravel, and more via project markers
- **Interactive `lien init`**: Guided setup with framework recommendations and customization prompts

#### Supported Frameworks (Launch)
- **Node.js/TypeScript**: Automatic detection via `package.json`, supports Jest, Vitest, Mocha, AVA test patterns
- **Laravel/PHP**: Automatic detection via `composer.json`, supports PHPUnit, Pest test patterns
- **Generic**: Fallback support for any codebase with customizable patterns

### ✨ Enhancements
- **Automatic Config Migration**: Seamless upgrade from v0.2.0 to v0.3.0 with backup creation
- **Framework-Aware Test Association**: Test detection respects framework boundaries in monorepos
- **Per-Framework .gitignore**: Each framework can have its own .gitignore rules
- **Improved Scanner**: Framework-specific file scanning with proper path resolution
- **Interactive Configuration**: `lien init` now provides guided setup with framework selection
- **Automatic Cursor Rules Installation**: `lien init` now offers to install recommended Cursor rules automatically

### 🔧 Breaking Changes
- **Config Schema Change**: `.lien.config.json` now uses `frameworks` array instead of flat `indexing` config
  - Old configs are automatically migrated with backup saved to `.lien.config.json.v0.2.0.backup`
  - No manual intervention required - migration happens on first config load
  - All custom settings (chunk size, concurrency, exclusions) are preserved
  - New format enables monorepo support and per-framework configuration

### 📚 Documentation
- Added comprehensive monorepo usage guide in README
- Added framework plugin development guide in CONTRIBUTING.md
- Updated Quick Start with new initialization flow
- Added migration instructions for v0.2.0 users

### 🧪 Testing
- Added 22 new integration tests (264 total, up from 242)
- Added monorepo framework integration tests (8 tests)
- Added test pattern filtering tests (7 tests)
- Added E2E workflow tests (5 tests)
- Added Cursor rules installation tests (2 tests)
- All tests pass with <5s execution time

### 🏗️ Architecture
- New framework plugin system in `packages/cli/src/frameworks/`
  - Pluggable detector interface for extensibility
  - Per-framework configuration generation
  - Framework-specific test pattern definitions
- Config migration system for backwards compatibility
- Deep merge utility for config upgrades

### 🔄 Migration Notes

**Upgrading from v0.2.0:**

Your config will be automatically migrated on first use. The old config format:
```json
{
  "version": "0.2.0",
  "indexing": { "include": [...], "exclude": [...] }
}
```

Becomes:
```json
{
  "version": "0.3.0",
  "frameworks": [
    {
      "name": "generic",
      "path": ".",
      "config": { "include": [...], "exclude": [...] }
    }
  ]
}
```

No action required - just run any Lien command and migration will happen automatically.

## [0.2.0] - 2025-01-13

### Added
- **Automated release script**: New `npm run release` command handles version bumping, building, changelog updates, commits, and git tags automatically
  - Supports patch, minor, and major version bumps
  - Follows semantic versioning and conventional commits
  - Updates CHANGELOG.md automatically
  - Example: `npm run release -- patch "fix: bug description"`
- **Development guidelines**: Added comprehensive CONTRIBUTING.md with:
  - Release process documentation
  - Development workflow guide
  - Testing guidelines
  - Code review checklist
- **Updated .cursor/rules**: Added detailed versioning and release guidelines for AI-assisted development

### Changed
- Enhanced README with Contributing & Development section
- Added release script to root package.json

## [0.1.10] - 2025-01-13

### Added
- **Index version metadata in tool responses**: All MCP tools now include `indexInfo` field with `indexVersion` (timestamp) and `indexDate` (human-readable) in their responses. This makes it easy to verify that Cursor is using the latest reindexed data without needing to restart.
  - Added `getCurrentVersion()` and `getVersionDate()` methods to `VectorDB`
  - All tools (`semantic_search`, `find_similar`, `get_file_context`, `list_functions`) now return index metadata
  - Example output: `"indexInfo": { "indexVersion": 1704845454321, "indexDate": "1/13/2025, 3:34:14 PM" }`

## [0.1.9] - 2025-01-13

### Fixed
- **Improved automatic reconnection after reindex**: Enhanced the reconnection logic to properly close and reload database connections. Added background polling every 2 seconds to detect index updates, so Cursor no longer needs to be restarted after reindexing.
  - `VectorDB.reconnect()` now forces a complete connection reset by nulling db/table before reinitializing
  - `VectorDB.initialize()` now caches the initial version to prevent false positives
  - Added background version check polling (every 2s) independent of tool calls
  - MCP server automatically reconnects within 2 seconds of any reindex operation

## [0.1.8] - 2025-01-13

### Fixed
- **[CRITICAL] Test associations now returned by all MCP tools**: Fixed `VectorDB.search()` to include test association metadata fields (`isTest`, `relatedTests`, `relatedSources`, `testFramework`, `detectionMethod`) in search results. Previously, these fields were stored in the database but not returned by the search function, causing MCP tools to show "Test associations not available" even after reindexing.
  - This was the root cause of test associations appearing empty in `semantic_search` and `get_file_context`
  - Fixed both the main search path and the retry/reconnection path
  - No reindexing required - existing indices will now work correctly

## [0.1.7] - 2025-01-13

### Fixed
- **[CRITICAL] Source→Test associations now work for Laravel and monorepo structures**: Fixed test file discovery for projects where paths include parent directories (e.g., `cognito-backend/tests/Unit/UserTest.php`). Now correctly finds tests regardless of path prefix.
  - Changed from `f.startsWith('tests/')` to `pathParts.includes('tests')`
  - Fixes issue where test→source worked but source→test didn't
  - Laravel projects now fully supported with both directions working

## [0.1.6] - 2025-01-13

### Added
- **`--verbose` flag for indexing commands**: Added `-v, --verbose` flag to `lien index` and `lien reindex` commands. Shows detailed logging including:
  - First 5 successful source→test associations
  - First 5 successful test→source associations  
  - Sample file paths when no associations are found
  - Helps debug test detection issues in Laravel and other frameworks

### Fixed
- **Crash when using verbose flag**: Fixed ReferenceError where `verbose` variable wasn't being extracted from options parameter

## [0.1.5] - 2025-01-13

### Fixed
- **Test association detection now visible during indexing**: Added clear output showing how many test files and source-test associations were found during indexing. This helps debug test detection issues.

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

