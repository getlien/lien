# Test Association Flow

This document describes Lien's two-pass test detection system that links test files to their source files.

## Overview

Test association helps AI assistants understand which tests cover which source code, enabling better code comprehension and test-aware refactoring suggestions.

## Two-Pass Detection Strategy

```mermaid
graph LR
    FILES[All Source Files] --> PASS1[Pass 1:<br/>Convention-Based<br/>~80% accuracy]
    PASS1 --> MAP1[Association Map<br/>Coverage: 80%]
    MAP1 --> PASS2[Pass 2:<br/>Import Analysis<br/>~90% accuracy]
    PASS2 --> FINAL[Final Association Map<br/>Coverage: 85-90%]
    
    style PASS1 fill:#fff3e0,stroke:#e65100,stroke-width:2px
    style PASS2 fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px
    style FINAL fill:#e1f5ff,stroke:#01579b,stroke-width:3px
```

**Why Two Passes?**

1. **Pass 1 (Convention)**: Fast, language-agnostic, covers 12 languages
2. **Pass 2 (Import)**: Slower, language-specific, more accurate for Tier 1 languages

## Pass 1: Convention-Based Detection

```mermaid
flowchart TB
    START[Scan All Files]
    PARTITION[Partition by Framework]
    
    subgraph "For Each File"
        CHECK_TYPE{Is Test File?}
        CHECK_PATTERN[Check Patterns]
        CHECK_DIR[Check Directories]
        MARK_TEST[Mark as Test]
    end
    
    subgraph "Pattern Matching"
        EXT_MATCH{Extension<br/>Match?}
        NAME_MATCH{Filename<br/>Match?}
        DIR_MATCH{Directory<br/>Match?}
    end
    
    subgraph "Association Logic"
        FIND_SOURCE[Find Corresponding Source]
        REMOVE_TEST[Remove test suffix/prefix]
        TRY_PATHS[Try Common Paths]
        MATCH_FOUND{Source<br/>Found?}
        CREATE_ASSOC[Create Association]
    end
    
    RESULT[Association Map]
    
    START --> PARTITION
    PARTITION --> CHECK_TYPE
    
    CHECK_TYPE -->|Maybe| CHECK_PATTERN
    CHECK_PATTERN --> EXT_MATCH
    EXT_MATCH -->|Yes| MARK_TEST
    EXT_MATCH -->|No| NAME_MATCH
    NAME_MATCH -->|Yes| MARK_TEST
    NAME_MATCH -->|No| CHECK_DIR
    CHECK_DIR --> DIR_MATCH
    DIR_MATCH -->|Yes| MARK_TEST
    DIR_MATCH -->|No| CHECK_TYPE
    
    MARK_TEST --> FIND_SOURCE
    FIND_SOURCE --> REMOVE_TEST
    REMOVE_TEST --> TRY_PATHS
    TRY_PATHS --> MATCH_FOUND
    MATCH_FOUND -->|Yes| CREATE_ASSOC
    MATCH_FOUND -->|No| RESULT
    CREATE_ASSOC --> RESULT
    
    CHECK_TYPE -->|No| RESULT
    
    style MARK_TEST fill:#fff3e0
    style CREATE_ASSOC fill:#c8e6c9
```

### Pattern Examples

**Extension Patterns:**
```
test.ts   → user.test.ts ✓
spec.js   → auth.spec.js ✓
_test.py  → parser_test.py ✓
Test.java → UserTest.java ✓
```

**Filename Patterns:**
```
PREFIX:
test_user.py  ✓ (prefix: "test_")
test-auth.js  ✓ (prefix: "test-")

SUFFIX:
user_test.py  ✓ (suffix: "_test")
auth.test.ts  ✓ (suffix: ".test")
```

**Directory Patterns:**
```
tests/unit/user.py        ✓ (directory: "tests/")
__tests__/auth.test.ts    ✓ (directory: "__tests__/")
test/integration/api.js   ✓ (directory: "test/")
spec/models/user_spec.rb  ✓ (directory: "spec/")
```

### Source File Resolution

```typescript
// Example: user.test.ts → user.ts

1. Remove test suffix/prefix:
   "user.test.ts" → "user.ts"

2. Try common paths:
   - Same directory: src/__tests__/user.test.ts → src/user.ts
   - Parent directory: tests/user.test.ts → user.ts
   - Sibling directory: tests/unit/user.test.ts → src/user.ts
   - Mirror structure: backend/tests/user.test.ts → backend/src/user.ts

3. Check if file exists:
   fs.access(resolvedPath)

4. If found: Create association
   test: "src/__tests__/user.test.ts"
   source: "src/user.ts"
```

## Pass 2: Import Analysis

Only runs for Tier 1 languages (TypeScript, JavaScript, Python)

```mermaid
sequenceDiagram
    participant Manager as Test Association Manager
    participant Parser as Import Analyzer
    participant FS as File System
    participant Resolver as Path Resolver
    
    Note over Manager: Filter to Tier 1 languages
    Manager->>Manager: Get test files (from Pass 1)
    
    loop For each test file
        Manager->>Parser: analyzeTestImports(testFile)
        
        Parser->>FS: Read test file content
        FS-->>Parser: File content
        
        rect rgb(255, 243, 224)
            Note over Parser: Extract Imports
            
            alt TypeScript/JavaScript
                Parser->>Parser: Match: import X from 'Y'
                Parser->>Parser: Match: require('Y')
                Parser->>Parser: Match: import('Y')
            else Python
                Parser->>Parser: Match: import X
                Parser->>Parser: Match: from X import Y
            end
        end
        
        rect rgb(232, 245, 233)
            Note over Parser,Resolver: Resolve Paths
            
            loop For each import
                Parser->>Resolver: Resolve relative path
                Resolver->>Resolver: path.resolve(testDir, importPath)
                Resolver->>Resolver: Try extensions: .ts, .tsx, .js, .jsx
                Resolver->>FS: Check if file exists
                FS-->>Resolver: Exists: true/false
                
                alt File exists
                    Resolver-->>Parser: Resolved path
                    Parser->>Parser: Add to source files list
                else Not found
                    Resolver-->>Parser: Skip (external module)
                end
            end
        end
        
        Parser-->>Manager: Array of source file paths
        Manager->>Manager: Merge with Pass 1 results
    end
    
    Manager->>Manager: Build final association map
```

### Import Pattern Recognition

**TypeScript/JavaScript:**
```typescript
// ES6 imports
import { User } from './user';               ✓
import * as utils from '../utils';           ✓
import type { Config } from './config';      ✓

// CommonJS
const user = require('./user');              ✓
const { auth } = require('../auth');         ✓

// Dynamic imports
const module = await import('./module');     ✓

// External modules (ignored)
import React from 'react';                   ✗
import { expect } from 'vitest';             ✗
```

**Python:**
```python
# Absolute imports
import user                                  ✓
from auth import login                       ✓

# Relative imports
from . import utils                          ✓
from ..models import User                    ✓

# External modules (ignored)
import pytest                                ✗
from unittest import TestCase                ✗
```

### Path Resolution Algorithm

```typescript
function resolvePath(testFilePath: string, importPath: string): string | null {
  // 1. Get test file directory
  const testDir = path.dirname(testFilePath);
  
  // 2. Resolve relative to test file
  let resolved = path.resolve(testDir, importPath);
  
  // 3. Try common extensions
  for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.py']) {
    const withExt = resolved + ext;
    if (fs.existsSync(withExt)) {
      return withExt;
    }
  }
  
  // 4. Try index files
  for (const index of ['/index.ts', '/index.js']) {
    const indexPath = resolved + index;
    if (fs.existsSync(indexPath)) {
      return indexPath;
    }
  }
  
  // 5. Not found
  return null;
}
```

## Merging Results

```mermaid
flowchart LR
    PASS1_MAP[Pass 1 Map:<br/>Convention-Based]
    PASS2_RESULTS[Pass 2 Results:<br/>Import Analysis]
    
    MERGE[Merge Logic]
    
    subgraph "Merge Strategy"
        UNION[Union of both sources]
        DEDUPE[Deduplicate]
        BIDIRECTIONAL[Create bidirectional links]
    end
    
    FINAL_MAP[Final Association Map]
    
    PASS1_MAP --> MERGE
    PASS2_RESULTS --> MERGE
    MERGE --> UNION
    UNION --> DEDUPE
    DEDUPE --> BIDIRECTIONAL
    BIDIRECTIONAL --> FINAL_MAP
    
    style PASS1_MAP fill:#fff3e0
    style PASS2_RESULTS fill:#e8f5e9
    style FINAL_MAP fill:#e1f5ff,stroke:#01579b,stroke-width:3px
```

### Merge Example

```typescript
// Pass 1 (Convention):
{
  "src/user.ts": {
    relatedTests: ["src/__tests__/user.test.ts"],
    detectionMethod: "convention"
  }
}

// Pass 2 (Import Analysis):
{
  "src/__tests__/user.test.ts": {
    relatedSources: ["src/user.ts", "src/utils.ts"], // Found via imports
    detectionMethod: "import"
  }
}

// Merged:
{
  "src/user.ts": {
    relatedTests: ["src/__tests__/user.test.ts"],
    detectionMethod: "convention+import"
  },
  "src/utils.ts": {
    relatedTests: ["src/__tests__/user.test.ts"],
    detectionMethod: "import"  // New discovery!
  },
  "src/__tests__/user.test.ts": {
    isTest: true,
    relatedSources: ["src/user.ts", "src/utils.ts"],
    testFramework: "vitest",
    detectionMethod: "convention+import"
  }
}
```

## Framework Detection

Test frameworks are detected from file content:

```mermaid
flowchart TD
    READ[Read Test File]
    SCAN[Scan for Framework Markers]
    
    subgraph "Framework Signatures"
        JEST["'jest' in imports?"]
        VITEST["'vitest' in imports?"]
        MOCHA["describe/it without import?"]
        PYTEST["'pytest' in imports?"]
        PHPUNIT["'PHPUnit' in class name?"]
        JUNIT["@Test annotation?"]
        RSPEC["'RSpec' in imports?"]
        XUNIT["'Xunit' in imports?"]
    end
    
    MATCH{Match<br/>Found?}
    SET_FRAMEWORK[Set framework in metadata]
    UNKNOWN[framework: null]
    
    READ --> SCAN
    SCAN --> JEST
    SCAN --> VITEST
    SCAN --> MOCHA
    SCAN --> PYTEST
    SCAN --> PHPUNIT
    SCAN --> JUNIT
    SCAN --> RSPEC
    SCAN --> XUNIT
    
    JEST -->|Yes| MATCH
    VITEST -->|Yes| MATCH
    MOCHA -->|Yes| MATCH
    PYTEST -->|Yes| MATCH
    PHPUNIT -->|Yes| MATCH
    JUNIT -->|Yes| MATCH
    RSPEC -->|Yes| MATCH
    XUNIT -->|Yes| MATCH
    
    JEST -->|No| VITEST
    
    MATCH -->|Yes| SET_FRAMEWORK
    MATCH -->|No| UNKNOWN
    
    style SET_FRAMEWORK fill:#c8e6c9
```

## Metadata Enrichment

Once associations are built, metadata is added to each code chunk:

```typescript
interface ChunkMetadata {
  file: string;
  startLine: number;
  endLine: number;
  language: string;
  
  // Test association metadata:
  isTest?: boolean;                    // Is this chunk from a test file?
  relatedTests?: string[];             // For source files: which tests cover this?
  relatedSources?: string[];           // For test files: which sources are tested?
  testFramework?: string;              // jest, vitest, pytest, etc.
  detectionMethod?: 'convention' | 'import' | 'convention+import';
  
  symbols?: {
    functions: string[];
    classes: string[];
    interfaces: string[];
  };
}
```

## Performance Characteristics

### Pass 1 (Convention-Based)

```
1,000 files, mixed languages
Time: ~2-3 seconds
Coverage: ~80% accuracy
Memory: Minimal (Map<string, TestAssociation>)
```

### Pass 2 (Import Analysis)

```
250 test files (TypeScript/JavaScript/Python only)
Average 5 imports per test
Time: ~2 seconds
Coverage: ~90% accuracy for analyzed files
Memory: Moderate (parses file contents)
```

### Combined

```
Total time: ~5 seconds
Overall coverage: 85-90% accuracy
Supported languages: 12 (Pass 1), 3 (Pass 2)
```

## Language Support Matrix

| Language | Pass 1 (Convention) | Pass 2 (Import) | Test Frameworks Detected |
|----------|:-------------------:|:---------------:|-------------------------|
| TypeScript | ✅ | ✅ | Jest, Vitest, Mocha |
| JavaScript | ✅ | ✅ | Jest, Vitest, Mocha |
| Python | ✅ | ✅ | pytest, unittest |
| Go | ✅ | ❌ | Go test |
| Rust | ✅ | ❌ | Cargo test |
| Java | ✅ | ❌ | JUnit, TestNG |
| C# | ✅ | ❌ | xUnit, NUnit |
| PHP | ✅ | ❌ | PHPUnit |
| Ruby | ✅ | ❌ | RSpec, Minitest |
| C/C++ | ✅ | ❌ | GoogleTest |
| Scala | ✅ | ❌ | ScalaTest |
| Kotlin | ✅ | ❌ | JUnit, Kotest |

## Real-World Example

### Input Files

```
project/
├── src/
│   ├── user.ts                (Source)
│   ├── auth.ts                (Source)
│   └── utils.ts               (Source)
└── tests/
    └── unit/
        └── user.test.ts       (Test)
```

**user.test.ts:**
```typescript
import { describe, it, expect } from 'vitest';
import { User } from '../../src/user';
import { hashPassword } from '../../src/auth';

describe('User', () => {
  it('creates user with hashed password', () => {
    // ...
  });
});
```

### Pass 1 Results

```typescript
{
  "src/user.ts": {
    relatedTests: ["tests/unit/user.test.ts"],
    detectionMethod: "convention"
  },
  "tests/unit/user.test.ts": {
    isTest: true,
    relatedSources: ["src/user.ts"],  // Guessed from filename
    testFramework: "vitest",
    detectionMethod: "convention"
  }
}
```

### Pass 2 Discovers More

```typescript
{
  "src/user.ts": {
    relatedTests: ["tests/unit/user.test.ts"],
    detectionMethod: "convention+import"
  },
  "src/auth.ts": {  // NEW! Found via import analysis
    relatedTests: ["tests/unit/user.test.ts"],
    detectionMethod: "import"
  },
  "tests/unit/user.test.ts": {
    isTest: true,
    relatedSources: ["src/user.ts", "src/auth.ts"],  // Both discovered
    testFramework: "vitest",
    detectionMethod: "convention+import"
  }
}
```

### User Benefit

When AI assistant asks about `src/auth.ts`:

```
> "What tests cover this authentication module?"

Lien response:
- tests/unit/user.test.ts (imports hashPassword function)
- Detection method: Import analysis
- Framework: Vitest
```

## Error Handling

### Graceful Degradation

```typescript
try {
  // Pass 1: Always runs
  const conventionAssociations = buildConventionBasedAssociations(files);
  
  try {
    // Pass 2: May fail for some files
    const importAssociations = await analyzeImports(testFiles);
    return mergeAssociations(conventionAssociations, importAssociations);
  } catch (error) {
    console.warn('Import analysis failed, using convention-based only');
    return conventionAssociations;  // Fall back to Pass 1
  }
} catch (error) {
  console.warn('Test association failed, continuing without associations');
  return new Map();  // Empty map, indexing continues
}
```

### File-Level Errors

```typescript
// Skip problematic files, continue with others
for (const testFile of testFiles) {
  try {
    const sources = await analyzeTestImports(testFile);
    associations.set(testFile, sources);
  } catch (error) {
    console.warn(`Failed to analyze ${testFile}: ${error.message}`);
    // Continue with next file
  }
}
```

## Future Enhancements

### Planned Improvements

1. **Tree-sitter parsing**: More accurate import extraction
2. **Caching**: Save associations between runs
3. **Confidence scores**: Rate association quality
4. **User overrides**: Manual association configuration
5. **More languages**: Expand Pass 2 to Go, Java, etc.

### Requested Features

- Association visualization
- Orphaned test detection
- Coverage gap reporting
- Test impact analysis (which tests to run for a change)

