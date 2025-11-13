# Contributing to Lien

Thank you for your interest in contributing to Lien! This document provides guidelines for development and releasing.

## Development Setup

```bash
# Clone the repository
git clone https://github.com/alfhenderson/lien.git
cd lien

# Install dependencies
npm install

# Build the project
npm run build

# Test locally
cd packages/cli
npm link
```

## Project Structure

```
lien/
├── packages/cli/          # Main CLI package
│   ├── src/
│   │   ├── cli/          # Command-line interface
│   │   ├── mcp/          # MCP server implementation
│   │   ├── indexer/      # Code indexing logic
│   │   ├── embeddings/   # Local embedding generation
│   │   └── vectordb/     # LanceDB integration
│   ├── test/             # Test suites
│   └── package.json
├── scripts/              # Build and release automation
└── .cursor/              # Cursor AI rules and guidelines
```

## Making Changes

### 1. Development Workflow

```bash
# Create a feature branch
git checkout -b feat/my-feature

# Make your changes
# ... edit files ...

# Build and test
npm run build

# Test the CLI locally
lien --help
```

### 2. Testing

Before committing, ensure:
- [ ] Code builds successfully (`npm run build`)
- [ ] No TypeScript errors (`npm run typecheck`)
- [ ] Manual testing with `lien` CLI
- [ ] Test with a real project/codebase

### 3. Commit Guidelines

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```bash
# Features
git commit -m "feat: add Python test detection"
git commit -m "feat(indexer): support for Go modules"

# Bug fixes
git commit -m "fix: resolve reconnection race condition"
git commit -m "fix(mcp): handle empty search results"

# Documentation
git commit -m "docs: update README with new examples"

# Other types
git commit -m "refactor: simplify chunking logic"
git commit -m "test: add integration tests for MCP"
git commit -m "chore: update dependencies"
```

## Releasing

### Automated Release Process

Lien uses an automated release script that handles version bumping, building, changelog updates, commits, and tagging.

#### Usage

```bash
npm run release -- <patch|minor|major> "commit message"
```

#### Examples

```bash
# Patch release (bug fixes, small improvements)
npm run release -- patch "fix: improve reconnection logic"

# Minor release (new features, backwards compatible)
npm run release -- minor "feat: add Ruby test detection"

# Major release (breaking changes)
npm run release -- major "BREAKING: new configuration format"
```

### What the Script Does

1. ✅ Validates arguments and checks for uncommitted changes
2. 📦 Bumps version in `packages/cli/package.json`
3. 🔨 Builds the project (`npm run build`)
4. 📋 Updates `CHANGELOG.md` with new version entry
5. 💾 Creates git commit with version number
6. 🏷️ Creates git tag (e.g., `v0.1.11`)
7. 📢 Shows next steps (push to origin)

### Manual Release (Not Recommended)

If you need to release manually:

```bash
# 1. Update version in packages/cli/package.json
# 2. Build
npm run build

# 3. Update CHANGELOG.md
# Add entry with version, date, and changes

# 4. Commit and tag
git add packages/cli/package.json packages/cli/dist/ CHANGELOG.md
git commit -m "feat: my feature (v0.1.11)"
git tag -a v0.1.11 -m "Release v0.1.11: My feature"

# 5. Push
git push origin main
git push origin v0.1.11
```

## Versioning

Lien follows [Semantic Versioning](https://semver.org/):

- **PATCH** (0.1.X → 0.1.X+1): Bug fixes, performance improvements, small changes
- **MINOR** (0.X.0 → 0.X+1.0): New features, backwards compatible additions
- **MAJOR** (X.0.0 → X+1.0.0): Breaking changes, major API changes

### When to Bump

| Change Type | Version | Example |
|-------------|---------|---------|
| Bug fix | Patch | Fixed reconnection timeout |
| New tool | Minor | Added `find_tests_for` tool |
| New language | Minor | Added Ruby support |
| Performance | Patch | Improved indexing speed |
| Breaking API | Major | Changed MCP tool signatures |
| Config change (breaking) | Major | New config file format |
| Config change (compatible) | Minor | Added optional field |

## Changelog Guidelines

Update `CHANGELOG.md` with every release following [Keep a Changelog](https://keepachangelog.com/):

### Categories

- **Added**: New features
- **Changed**: Changes to existing functionality
- **Deprecated**: Soon-to-be removed features
- **Removed**: Removed features
- **Fixed**: Bug fixes
- **Security**: Security fixes

### Example Entry

```markdown
## [0.1.11] - 2025-01-13

### Added
- **Ruby test detection**: Added support for RSpec and Minitest test patterns
- Support for `.rb` files in the indexer

### Fixed
- **Reconnection timeout**: Fixed issue where MCP server wouldn't reconnect after reindex
- Improved error handling for missing index files
```

## Adding a New Framework

Lien's framework plugin system makes it easy to add support for new languages and frameworks. Here's how to add support for a new framework (e.g., Django, Ruby on Rails):

### 1. Create Framework Directory

```
packages/cli/src/frameworks/myframework/
  ├── detector.ts         # Detection logic
  ├── config.ts          # Default configuration
  └── test-patterns.ts   # Test file patterns
```

### 2. Implement detector.ts

```typescript
import fs from 'fs/promises';
import path from 'path';
import { FrameworkDetector, DetectionResult } from '../types.js';
import { generateMyFrameworkConfig } from './config.js';

export const myframeworkDetector: FrameworkDetector = {
  name: 'myframework',
  
  async detect(rootDir: string, relativePath: string): Promise<DetectionResult> {
    const fullPath = path.join(rootDir, relativePath);
    const result: DetectionResult = {
      detected: false,
      name: 'myframework',
      path: relativePath,
      confidence: 'low',
      evidence: [],
    };
    
    // Check for framework markers (e.g., package files, config files)
    const markerPath = path.join(fullPath, 'myframework.json');
    try {
      await fs.access(markerPath);
      result.detected = true;
      result.confidence = 'high';
      result.evidence.push('Found myframework.json');
    } catch {
      return result;
    }
    
    // Add more detection logic...
    
    return result;
  },
  
  async generateConfig(rootDir: string, relativePath: string) {
    return generateMyFrameworkConfig(rootDir, relativePath);
  },
};
```

### 3. Implement config.ts

```typescript
import { FrameworkConfig } from '../../config/schema.js';
import { myframeworkTestPatterns } from './test-patterns.js';

export async function generateMyFrameworkConfig(
  rootDir: string,
  relativePath: string
): Promise<FrameworkConfig> {
  return {
    include: [
      'src/**/*.myext',
      'lib/**/*.myext',
    ],
    exclude: [
      'vendor/**',
      'build/**',
      'dist/**',
    ],
    testPatterns: myframeworkTestPatterns,
  };
}
```

### 4. Implement test-patterns.ts

```typescript
import { TestPatternConfig } from '../../config/schema.js';

export const myframeworkTestPatterns: TestPatternConfig = {
  directories: ['tests', 'spec'],
  extensions: ['.test.myext', '.spec.myext'],
  prefixes: ['test_'],
  suffixes: ['_test', '.test'],
  frameworks: ['mytest', 'myspec'],
};
```

### 5. Register in registry.ts

```typescript
// packages/cli/src/frameworks/registry.ts
import { myframeworkDetector } from './myframework/detector.js';

// Add to the detectors array
registerFramework(myframeworkDetector);
```

### 6. Add Integration Tests

Create `packages/cli/test/integration/myframework.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { detectAllFrameworks } from '../../src/frameworks/detector-service.js';

describe('MyFramework Detection', () => {
  it('detects myframework in project', async () => {
    // Test detection logic...
  });
  
  it('generates correct config', async () => {
    // Test config generation...
  });
});
```

### 7. Submit Pull Request

Your PR should include:
- Detector implementation with high-quality detection logic
- Default config and test patterns
- Integration tests with >80% coverage
- Documentation update in README.md (add to Supported Frameworks section)
- Example usage if the framework has unique requirements

### Testing Your Framework Plugin

```bash
# Build
npm run build

# Test detection
lien init --path /path/to/myframework/project

# Verify config generation
cat /path/to/myframework/project/.lien.config.json

# Run integration tests
cd packages/cli
npm test -- test/integration/myframework.test.ts
```

## Code Review

All contributions should:

- Follow TypeScript best practices
- Include JSDoc comments for public APIs
- Handle errors gracefully
- Update documentation if needed
- Add tests for new features (when applicable)

## Questions?

Feel free to open an issue for:
- Bug reports
- Feature requests
- Questions about development
- Ideas for improvements

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
