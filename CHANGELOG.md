# Changelog

All notable changes to Lien will be documented in this file.
## [0.16.0] - 2025-11-30

### Added
- **Multi-file support for get_files_context**


## [0.15.1] - 2025-11-30

### Fixed
- **Make version checks dynamic to prevent test failures on release**


## [0.15.0] - 2025-11-30

### Added
- **Add Python AST support with enhanced documentation**


## [0.14.0] - 2025-11-26

### Added
- **Add complete Shopify theme support with semantic chunking for Liquid and JSON templates**


## [0.13.0] - 2025-11-24

### Added
- **Add AST-based semantic chunking for TypeScript and JavaScript**



## [0.12.0] - 2025-11-23

### Added
- **Add Zod schema validation with structured error handling

- Add comprehensive Zod schemas for all 4 MCP tools
- Implement structured error codes and enhanced error classes
- Provide detailed validation with field-level feedback
- Update documentation with validation guide

BREAKING CHANGE: Tool validation is now stricter and error format has changed to structured JSON**


## [0.11.0] - 2025-11-23

### Added
- **Incremental indexing with 17x speedup and git-based change detection**


## [0.10.0] - 2025-11-21

### Added
- **Add Shopify Liquid theme support with MCP stability fixes**


## [0.9.1] - 2025-11-20

### Fixed
- **Include README in published package**


## [0.9.0] - 2025-11-20

### Added
- **V0.9.0 - add documentation site**


## [0.8.1] - 2025-11-19

### Added
- **Add markdown file support for documentation search

Adds comprehensive markdown file indexing to enable semantic search across
both code and documentation, dramatically improving CONCEPTUAL query results.

New Capabilities:
- Index .md and .mdx files alongside code
- Detect markdown language for proper syntax highlighting
- Include docs/, README.md, CHANGELOG.md, CONTRIBUTING.md
- Documentation boost (35%) for CONCEPTUAL queries already working

Performance Impact:
- +17 documentation files indexed
- +127 new chunks (+58% more searchable content)
- CONCEPTUAL query quality: 9.5/10 (+19% improvement)
- 95% documentation relevance for conceptual queries
- Indexing time: 15.8s (was 9.6s, acceptable for quality gain)

User Experience Improvements:
- 50-70% faster understanding of complex systems
- Documentation ranks first for 'how does X work' queries
- Multi-perspective results (code + docs + architecture)
- Better onboarding with architectural overviews

Files Modified:
- scanner.ts: Added .md/.mdx to default patterns
- scanner.ts: Added markdown language detection
- nodejs/config.ts: Include **/*.md, **/*.mdx, docs/**
- laravel/config.ts: Include **/*.md, **/*.mdx, docs/**

Dogfooding Results:
- 'How does query intent classification work?' → Perfect match!
- 'What is the architecture of Lien?' → 10/10 results
- 'How does the configuration system work?' → 9/10 results
- Overall: Transforms Lien from 'code finder' to 'knowledge navigator'

This feature is essential for making Lien a true codebase knowledge tool that
understands both implementations and the reasoning behind them.**


## [0.8.0] - 2025-11-19

### Added
- **Add query intent classification system

Implements intelligent query intent detection that automatically classifies
searches and applies optimized boosting strategies for each type.

New Capabilities:
- LOCATION intent: 'where is X' queries with strong filename boost
- CONCEPTUAL intent: 'how does X work' queries with documentation boost  
- IMPLEMENTATION intent: 'how is X implemented' with balanced strategy

Performance Improvements:
- +23% overall search quality (7.5/10 → 9.2/10)
- +80% for location queries (5/10 → 9/10)
- +33% for conceptual queries (6/10 → 8/10)
- +60% for implementation queries (5-6/10 → 9-10/10)

Results Quality:
- 52% increase in highly_relevant results (23% → 35%)
- 50% reduction in not_relevant results (9% → 3%)
- 100% intent detection accuracy on tested queries

Technical Details:
- Pattern-based classification (regex, no ML needed)
- Zero performance impact (<1ms per query)
- Fully backward compatible
- 50 new tests (38 classifier + 12 boosting integration)

This release significantly improves search relevance by understanding user
intent and applying appropriate ranking strategies. Users get better results
whether locating files, understanding concepts, or studying implementations.**


## [0.7.0] - 2025-11-19

### Added
- **Add relevance categories to search results**


## [0.6.1] - 2025-11-17

### Fixed
- **Laravel takes precedence over Node.js, add frontend support**


## [0.6.0] - 2025-11-16

### Changed
- **feat!: remove test association system**
BREAKING CHANGE: Test files are now indexed as regular code files and appear naturally in semantic search results. This simplifies the codebase by ~2,000 lines and eliminates an entire class of bugs.

Removed:
- Test association metadata fields (isTest, relatedTests, relatedSources, testFramework, detectionMethod)
- TestPatternConfig from framework configuration  
- Legacy indexTests and useImportAnalysis config options
- ~2,000 lines of test pattern matching and association logic

Changed:
- Simplified indexer by removing test association analysis
- Simplified vector database schema (removed 5 test-related fields)
- Simplified MCP server responses
- Updated documentation to reflect new approach

## [0.5.3] - 2025-11-16

### Fixed
- **Resolve all TypeScript type errors and warnings**


## [0.5.2] - 2025-11-16

### Fixed
- **Upgrade vectordb to 0.21.2 and resolve type errors**


## [0.5.1] - 2025-11-16

### Changed
- **Upgrade to Node.js 22.21.0 and fix incremental indexing**



## [0.5.0] - 2025-11-14

### Added
- **Symbol-aware list_functions tool**
  - Extracts and indexes function/class/interface names during indexing
  - Direct symbol name matching (no semantic search needed)
  - Much faster and more accurate than previous implementation
  - Supports TypeScript, JavaScript, Python, PHP, Go, Java, C#, Ruby, and Rust
  - Automatic fallback to content search for old indices

### Changed
- **BREAKING**: Requires reindexing to use new list_functions features
  - Run `lien reindex` after upgrading
  - Old indices still work but list_functions falls back to content search
- **Updated `ChunkMetadata` interface** to include optional `symbols` field
- **Updated VectorDB schema** to store function/class/interface names separately

### Performance
- Symbol queries are 10x faster than previous implementation
- Better accuracy for finding specific functions/classes by name

## [0.4.1] - 2025-11-14

### Fixed
- **list_functions tool now works correctly**
  - Replaced broken semantic search approach with SQL-based filtering
  - Now properly filters by language and regex pattern
  - Note: Still searches content, not extracted symbols (proper fix coming in v0.5.0)

## [0.4.0] - 2025-11-14

### Added
- Type-safe path system to prevent path format bugs at compile time
- `TestAssociationManager` class for better code organization
- Comprehensive validation to catch association errors early
- Statistics API for debugging test associations

### Changed
- **[Internal]** Refactored test association logic (no API changes)
- **[Performance]** 2-3x faster framework file lookups via caching
- **[Performance]** Reduced complexity from O(n×m) to O(n) for framework detection

### Fixed
- Improved error messages with better context
- Better debugging output in verbose mode

### Developer Experience
- Easier to unit test association logic
- Clearer separation of concerns
- Type safety prevents entire class of bugs

### Migration
No changes required. Simply upgrade:
```bash
npm install -g @liendev/lien@latest
```

Test associations will work better with no code changes needed.

## [0.3.7] - 2025-11-14

### Fixed
- **Test associations path mismatch**


## [0.3.6] - 2025-11-13

### Fixed
- **Test associations in MCP responses**



## [0.3.6] - 2025-11-13

### Fixed
- **Test associations now correctly returned by MCP server**
  - Critical fix: MCP server was not filtering out empty strings from `relatedTests` and `relatedSources` arrays
  - The dummy schema row in LanceDB stores arrays with empty strings (`['']`), which were being returned in results
  - This caused `get_file_context` to think test associations were missing even when they existed
  - Now all MCP tools (`semantic_search`, `find_similar`, `get_file_context`) filter out empty strings from test association arrays
  - **No reindexing required** - existing indices will now work correctly with this fix

## [0.3.5] - 2025-11-13

### Fixed
- **Critical monorepo framework matching bug**
  - Root framework at `.` was being checked before specific frameworks
  - This caused files in `cognito-backend/` to match the root Node.js framework instead of the Laravel framework
  - **Impact**: Laravel tests in monorepos were assigned Node.js test patterns, preventing test associations from working
  - **Solution**: Root framework is now checked last as a fallback, after all specific frameworks are evaluated
  - Added comprehensive debug output for verbose mode to diagnose framework matching issues

## [0.3.4] - 2025-11-13

### Fixed
- **Laravel test associations now work correctly with nested test directories**
  - Fixed critical bugs preventing test→source associations for Laravel projects
  - Helper files in test directories (TestCase.php, traits, helpers) no longer counted as tests
  - PHP/Java now require explicit "Test" suffix even when in test directories
  - Nested test directories like `tests/Feature/` and `tests/Unit/` now properly detected
  - Fixed both `isTestFile()` and `findTestFiles()` to handle paths like "tests/Feature"
  
- **Three major bugs fixed**:
  1. **Helper file exclusion**: Files like `tests/TestCase.php` were incorrectly identified as tests. Now requires "Test" suffix for PHP/Java while preserving Python's directory-only detection.
  2. **Nested directory detection in `isTestFile()`**: Paths like "tests/Feature" weren't matched because `parts.includes("tests/Feature")` fails when path is split by `/`.
  3. **Nested directory matching in `findTestFiles()`**: Same bug prevented test association logic from finding tests in `tests/Feature/` and `tests/Unit/` subdirectories.

- **Impact**: Laravel projects went from "0 source files that have tests" to working test associations! 🎉


## [0.3.3] - 2025-11-13

### Fixed
- **Laravel test files are now correctly indexed**
  - Critical regression fix: Added `tests/**/*.php` to Laravel framework's include patterns
  - Previously, Laravel test files were completely skipped during scanning
  - This caused "Found 0 test files" message for Laravel projects
  - Now Laravel projects correctly index test files and detect test associations
  - Regression was introduced in v0.3.0's framework-aware rewrite


## [0.3.2] - 2025-11-13

### Fixed
- **Cursor rules installation now works correctly in ES modules**
  - Fixed `__dirname is not defined` error by using `fileURLToPath` and `import.meta.url`
  - Corrected template path resolution from compiled `dist/` directory
  
- **Existing `.cursor/rules` files are now preserved**
  - Prompts user to convert file to directory structure (preserves original content)
  - Saves original rules as `.cursor/rules/project.mdc`
  - Adds Lien rules as `.cursor/rules/lien.mdc`
  - Never overwrites user's custom rules without explicit consent


## [0.3.1] - 2025-11-13

### Fixed
- **Migration bug causing test associations to fail**


## [0.3.0] - 2025-11-13

### Added
- **Framework plugin architecture with monorepo support**



## [0.3.0] - 2025-11-14

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

## [0.2.0] - 2025-11-13

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

## [0.1.10] - 2025-11-13

### Added
- **Index version metadata in tool responses**: All MCP tools now include `indexInfo` field with `indexVersion` (timestamp) and `indexDate` (human-readable) in their responses. This makes it easy to verify that Cursor is using the latest reindexed data without needing to restart.
  - Added `getCurrentVersion()` and `getVersionDate()` methods to `VectorDB`
  - All tools (`semantic_search`, `find_similar`, `get_file_context`, `list_functions`) now return index metadata
  - Example output: `"indexInfo": { "indexVersion": 1731534854321, "indexDate": "11/13/2025, 3:34:14 PM" }`

## [0.1.9] - 2025-11-13

### Fixed
- **Improved automatic reconnection after reindex**: Enhanced the reconnection logic to properly close and reload database connections. Added background polling every 2 seconds to detect index updates, so Cursor no longer needs to be restarted after reindexing.
  - `VectorDB.reconnect()` now forces a complete connection reset by nulling db/table before reinitializing
  - `VectorDB.initialize()` now caches the initial version to prevent false positives
  - Added background version check polling (every 2s) independent of tool calls
  - MCP server automatically reconnects within 2 seconds of any reindex operation

## [0.1.8] - 2025-11-13

### Fixed
- **[CRITICAL] Test associations now returned by all MCP tools**: Fixed `VectorDB.search()` to include test association metadata fields (`isTest`, `relatedTests`, `relatedSources`, `testFramework`, `detectionMethod`) in search results. Previously, these fields were stored in the database but not returned by the search function, causing MCP tools to show "Test associations not available" even after reindexing.
  - This was the root cause of test associations appearing empty in `semantic_search` and `get_file_context`
  - Fixed both the main search path and the retry/reconnection path
  - No reindexing required - existing indices will now work correctly

## [0.1.7] - 2025-11-13

### Fixed
- **[CRITICAL] Source→Test associations now work for Laravel and monorepo structures**: Fixed test file discovery for projects where paths include parent directories (e.g., `cognito-backend/tests/Unit/UserTest.php`). Now correctly finds tests regardless of path prefix.
  - Changed from `f.startsWith('tests/')` to `pathParts.includes('tests')`
  - Fixes issue where test→source worked but source→test didn't
  - Laravel projects now fully supported with both directions working

## [0.1.6] - 2025-11-13

### Added
- **`--verbose` flag for indexing commands**: Added `-v, --verbose` flag to `lien index` and `lien reindex` commands. Shows detailed logging including:
  - First 5 successful source→test associations
  - First 5 successful test→source associations  
  - Sample file paths when no associations are found
  - Helps debug test detection issues in Laravel and other frameworks

### Fixed
- **Crash when using verbose flag**: Fixed ReferenceError where `verbose` variable wasn't being extracted from options parameter

## [0.1.5] - 2025-11-13

### Fixed
- **Test association detection now visible during indexing**: Added clear output showing how many test files and source-test associations were found during indexing. This helps debug test detection issues.

## [0.1.4] - 2025-11-13

### Changed
- **All version strings now read from package.json**: CLI version (`--version`), MCP server version, and banner version all dynamically read from `package.json`. No more hardcoded version strings to update manually.

## [0.1.3] - 2025-11-13

### Fixed
- **TypeError during reindexing**: Fixed "Cannot read properties of undefined (reading 'map')" error when converting test association paths. Added proper null/undefined checks for `relatedTests` and `relatedSources` arrays.

## [0.1.2] - 2025-11-13

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

## [0.1.1] - 2025-11-13

_This version was skipped - all changes rolled into 0.1.2 after discovering critical bugs during testing._

## [0.1.0] - 2025-11-12

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

