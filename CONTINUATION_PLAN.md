# Lien v0.3.0 Implementation - Continuation Plan

**Session Date:** November 13, 2025  
**Status:** Phase 4 in progress (Scanner complete)  
**Target Version:** v0.3.0 (minor version - backwards compatible architectural change)

---

## 🎯 Mission: Framework Plugin Architecture with Full Monorepo Support

Transform Lien from a monolithic language config to a modular, framework-aware system that:
- **Detects** multiple frameworks in a monorepo (Node.js at root + Laravel in subfolder)
- **Indexes** each framework with path-aware patterns
- **Associates** tests correctly within framework boundaries
- **Migrates** old configs gracefully
- **Tests** against real-world repos (Lien itself + Laravel Breeze)

---

## ✅ Completed Work (Phases 1-3 + Partial Phase 4)

### Phase 1: Core Architecture ✓
**Files Created:**
1. `packages/cli/src/frameworks/types.ts` - Core interfaces
2. `packages/cli/src/frameworks/registry.ts` - Framework registration system
3. `packages/cli/src/frameworks/detector-service.ts` - Recursive detection logic

**Files Modified:**
1. `packages/cli/src/config/schema.ts` - Refactored to use `frameworks: FrameworkInstance[]`

**Key Changes:**
```typescript
// OLD schema.ts:
export interface LienConfig {
  include: string[];
  exclude: string[];
  languages: string[];
  // ... rest
}

// NEW schema.ts:
export interface LienConfig {
  core: { projectName: string; /* ... */ };
  frameworks: FrameworkInstance[];
  mcp: { /* ... */ };
  // ... rest
}

export interface FrameworkInstance {
  name: string;           // "nodejs" | "laravel" | ...
  path: string;           // "." | "cognito-backend" | ...
  config: FrameworkConfig; // Framework-specific settings
}
```

### Phase 2: Node.js Support ✓
**Files Created:**
1. `packages/cli/src/frameworks/nodejs/detector.ts` - Detects package.json, TS/JS files
2. `packages/cli/src/frameworks/nodejs/config.ts` - Default patterns (Jest, Vitest, Mocha, AVA)
3. `packages/cli/src/frameworks/nodejs/test-patterns.ts` - Node.js test conventions

**Detection Logic:**
```typescript
// detector.ts: detect()
✓ Checks for package.json
✓ Scans for .js/.ts/.jsx/.tsx files
✓ Identifies test frameworks (jest, vitest, mocha, ava)
✓ Returns confidence: high if package.json exists, medium otherwise
```

### Phase 3: Laravel Support ✓
**Files Created:**
1. `packages/cli/src/frameworks/laravel/detector.ts` - Detects composer.json, artisan
2. `packages/cli/src/frameworks/laravel/config.ts` - Default patterns (PHPUnit, Pest)
3. `packages/cli/src/frameworks/laravel/test-patterns.ts` - Laravel conventions

**Detection Logic:**
```typescript
// detector.ts: detect()
✓ Checks for composer.json with "laravel/framework"
✓ Looks for artisan file
✓ Verifies tests/Feature and tests/Unit directories
✓ Returns confidence: high if all Laravel markers present
```

### Phase 4: Path-Aware Indexing (PARTIAL) ✓
**Files Modified:**
1. `packages/cli/src/indexer/scanner.ts` - NEW `scanCodebaseWithFrameworks()`

**Key Implementation:**
```typescript
// scanner.ts: NEW function
export async function scanCodebaseWithFrameworks(
  config: LienConfig
): Promise<Map<string, string>> {
  const allFiles = new Map<string, string>();

  for (const fw of config.frameworks) {
    const fwFiles = await scanFramework(fw, config.core.projectRoot);
    for (const [path, lang] of fwFiles) {
      allFiles.set(path, lang);
    }
  }

  return allFiles;
}

// Handles:
✓ Per-framework .gitignore loading
✓ Path prefixing (e.g., "cognito-backend/app/Models/User.php")
✓ Framework-specific include/exclude patterns
✓ Backwards compatibility via legacy scanCodebase()
```

---

## 🚧 Remaining Work (Next Session Starts Here)

### **PHASE 4: Path-Aware Indexing (CONTINUE)**

#### Task 4.2: Update Test Pattern Matching ✅ COMPLETED
**File:** `packages/cli/src/indexer/test-patterns.ts`

**Completed:** 2025-11-13
**Commit:** ab18bb4

**Implementation:**
- ✅ Added `frameworkPath` and `patterns` parameters to `findTestFiles()` and `findSourceFiles()`
- ✅ Implemented path normalization helpers (`normalizePathForFramework`, `addFrameworkPrefix`)
- ✅ Added framework boundary enforcement to prevent cross-framework matches
- ✅ Added 18 new monorepo test scenarios (all 55 tests passing)
- ✅ Maintained backward compatibility with default parameters

**Required Changes:**

1. **Add Framework Context to Functions:**
```typescript
// BEFORE:
export function findTestFiles(
  sourceFile: string,
  allFiles: string[],
  language: string
): string[]

// AFTER:
export function findTestFiles(
  sourceFile: string,
  allFiles: string[],
  language: string,
  frameworkPath: string = '.',  // NEW
  patterns?: TestPatternConfig  // NEW
): string[]
```

2. **Path Normalization Logic:**
```typescript
// Inside findTestFiles/findSourceFiles:
function normalizePathForFramework(file: string, fwPath: string): string {
  // If framework is at root, no change
  if (fwPath === '.') return file;
  
  // Strip framework prefix to get relative path
  // e.g., "cognito-backend/app/Models/User.php" → "app/Models/User.php"
  return file.startsWith(fwPath + '/') 
    ? file.slice(fwPath.length + 1) 
    : file;
}

function addFrameworkPrefix(file: string, fwPath: string): string {
  if (fwPath === '.') return file;
  return `${fwPath}/${file}`;
}
```

3. **Framework-Specific Pattern Usage:**
```typescript
// Use patterns from framework config if provided
const testPatterns = patterns?.testPatterns || LANGUAGE_TEST_PATTERNS[language];
```

**Testing Scenario:**
```
Root: /Users/alfhenderson/Code/shopify-cognito-app
├── src/index.ts              (Node.js framework, path: ".")
├── tests/index.test.ts
└── cognito-backend/          (Laravel framework, path: "cognito-backend")
    ├── app/Models/User.php
    └── tests/Unit/UserTest.php

Expected behavior:
- findTestFiles("src/index.ts", allFiles, "typescript", ".") 
  → ["tests/index.test.ts"]
  
- findTestFiles("cognito-backend/app/Models/User.php", allFiles, "php", "cognito-backend")
  → ["cognito-backend/tests/Unit/UserTest.php"]
```

**Files to Update:**
- `packages/cli/src/indexer/test-patterns.ts` (main logic)
- `packages/cli/src/indexer/test-patterns.test.ts` (add monorepo test cases)

---

#### Task 4.3: Update Index Orchestration ⏳
**File:** `packages/cli/src/indexer/index.ts`

**Current State:**
- `indexCodebase()` calls `scanCodebase()` (old, non-framework-aware)
- Test association analysis doesn't know about framework boundaries

**Required Changes:**

1. **Switch to Framework-Aware Scanner:**
```typescript
// BEFORE:
const files = await scanCodebase(config);

// AFTER:
const files = config.frameworks.length > 0
  ? await scanCodebaseWithFrameworks(config)
  : await scanCodebase(config); // Fallback for legacy configs
```

2. **Pass Framework Context to Test Analysis:**
```typescript
// Build framework lookup map
const frameworkLookup = new Map<string, FrameworkInstance>();
for (const fw of config.frameworks) {
  frameworkLookup.set(fw.path, fw);
}

// During test association:
for (const [absolutePath, chunks] of /* ... */) {
  const relativePath = path.relative(config.core.projectRoot, absolutePath);
  
  // Determine which framework owns this file
  const framework = findOwningFramework(relativePath, config.frameworks);
  
  const association = await analyzeTestAssociations(
    relativePath,
    allRelativePaths,
    language,
    {
      verbose,
      frameworkPath: framework?.path,
      patterns: framework?.config.testPatterns
    }
  );
  // ...
}

function findOwningFramework(
  filePath: string, 
  frameworks: FrameworkInstance[]
): FrameworkInstance | null {
  // Sort by path depth (deepest first) to handle nested frameworks
  const sorted = [...frameworks].sort((a, b) => 
    b.path.split('/').length - a.path.split('/').length
  );
  
  for (const fw of sorted) {
    if (fw.path === '.' || filePath.startsWith(fw.path + '/')) {
      return fw;
    }
  }
  return null;
}
```

**Files to Update:**
- `packages/cli/src/indexer/index.ts` (main orchestration)

---

### **PHASE 5: Config Migration & Init Enhancement** ⏳

#### Task 5.1: Implement Config Migration ⏳
**File:** `packages/cli/src/config/migration.ts` (NEW)

**Goal:** Auto-upgrade v0.2.0 configs to v0.3.0 without breaking existing setups.

**Migration Strategy:**
```typescript
export interface LegacyLienConfig {
  include: string[];
  exclude: string[];
  languages: string[];
  indexTests: boolean;
  // ... old structure
}

export function migrateConfig(oldConfig: LegacyLienConfig): LienConfig {
  // Step 1: Create core settings from old fields
  const core: CoreConfig = {
    projectName: oldConfig.projectName || 'my-project',
    projectRoot: oldConfig.projectRoot || process.cwd(),
    indexVersion: 1,
  };

  // Step 2: Convert old patterns to a single "generic" framework
  const genericFramework: FrameworkInstance = {
    name: 'generic',
    path: '.',
    config: {
      include: oldConfig.include,
      exclude: oldConfig.exclude,
      // ... map other fields
    }
  };

  // Step 3: Return new structure
  return {
    core,
    frameworks: [genericFramework],
    mcp: oldConfig.mcp || defaultConfig.mcp,
    // ...
  };
}

export function needsMigration(config: any): boolean {
  // Check if config uses old structure (has top-level 'include' instead of 'frameworks')
  return !config.frameworks && (config.include || config.languages);
}
```

**Usage in loader.ts:**
```typescript
// config/loader.ts: loadConfig()
let config = JSON.parse(await fs.readFile(configPath, 'utf-8'));

if (needsMigration(config)) {
  console.log('🔄 Migrating config from v0.2.0 to v0.3.0...');
  config = migrateConfig(config);
  
  // Save migrated config with backup
  await fs.copyFile(configPath, `${configPath}.v0.2.0.backup`);
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  console.log('✓ Migration complete. Backup saved as .lien.config.json.v0.2.0.backup');
}
```

**Files to Create/Modify:**
- `packages/cli/src/config/migration.ts` (NEW)
- `packages/cli/src/config/loader.ts` (add migration call)
- `packages/cli/src/config/migration.test.ts` (NEW - test migration scenarios)

---

#### Task 5.2: Enhance `lien init` with Interactive Detection ⏳
**File:** `packages/cli/src/cli/init.ts`

**Current State:**
- `lien init` creates a static default config
- No framework detection
- No interactivity

**New Flow:**
```
$ lien init

🔍 Detecting frameworks in /Users/alfhenderson/Code/lien...

Found frameworks:
  ✓ Node.js (confidence: high)
    Location: . (root)
    Test frameworks: Vitest
    
  ✓ Laravel (confidence: high)
    Location: cognito-backend/
    Test frameworks: PHPUnit

? Configure these frameworks? (Y/n) y

? Customize Node.js settings? (y/N) n
  → Using defaults (extensions: .ts, .js, tests in __tests__/)

? Customize Laravel settings? (y/N) n
  → Using defaults (extensions: .php, tests in tests/Feature, tests/Unit)

✓ Created .lien.config.json
✓ Configured 2 frameworks
✓ Ready to index! Run: lien index
```

**Implementation:**
```typescript
// cli/init.ts: initCommand()
export async function initCommand(options: InitOptions) {
  const rootDir = options.path || process.cwd();
  
  // 1. Run framework detection
  const detections = await detectAllFrameworks(rootDir);
  
  if (detections.length === 0) {
    console.log('⚠️  No frameworks detected. Creating generic config...');
    // Fall back to generic framework
    detections.push({
      name: 'generic',
      path: '.',
      confidence: 'low',
      metadata: {}
    });
  }
  
  // 2. Display findings
  console.log(`\n🔍 Found ${detections.length} framework(s):\n`);
  for (const det of detections) {
    console.log(`  ✓ ${det.name} (confidence: ${det.confidence})`);
    console.log(`    Location: ${det.path}`);
    if (det.metadata.testFrameworks) {
      console.log(`    Test frameworks: ${det.metadata.testFrameworks.join(', ')}`);
    }
  }
  
  // 3. Interactive confirmation (if not --yes flag)
  if (!options.yes) {
    const { confirm } = await inquirer.prompt([
      { type: 'confirm', name: 'confirm', message: 'Configure these frameworks?', default: true }
    ]);
    if (!confirm) {
      console.log('Aborted.');
      return;
    }
  }
  
  // 4. Generate configs (optionally customize per framework)
  const frameworks: FrameworkInstance[] = [];
  for (const det of detections) {
    const detector = frameworkDetectors.find(d => d.name === det.name);
    if (!detector) continue;
    
    let fwConfig = detector.generateConfig(det);
    
    // Optional: Ask to customize
    if (!options.yes && !options.useDefaults) {
      const { customize } = await inquirer.prompt([
        { type: 'confirm', name: 'customize', message: `Customize ${det.name} settings?`, default: false }
      ]);
      if (customize) {
        // Interactive prompts for include/exclude/extensions
        fwConfig = await promptForCustomization(fwConfig);
      }
    }
    
    frameworks.push({
      name: det.name,
      path: det.path,
      config: fwConfig
    });
  }
  
  // 5. Build final config
  const config: LienConfig = {
    core: {
      projectName: path.basename(rootDir),
      projectRoot: rootDir,
      indexVersion: 1,
    },
    frameworks,
    mcp: defaultConfig.mcp,
    // ...
  };
  
  // 6. Write config
  const configPath = path.join(rootDir, '.lien.config.json');
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  
  console.log(`\n✓ Created .lien.config.json`);
  console.log(`✓ Configured ${frameworks.length} framework(s)`);
  console.log(`✓ Ready to index! Run: lien index\n`);
}
```

**Dependencies:**
- Add `inquirer` to `packages/cli/package.json` for interactive prompts

**Files to Modify:**
- `packages/cli/src/cli/init.ts` (complete rewrite)
- `packages/cli/package.json` (add `inquirer` dependency)

---

### **PHASE 6: Integration Testing** ⏳

#### Task 6.1: Monorepo Integration Test ⏳
**File:** `packages/cli/test/integration/monorepo-framework.test.ts` (NEW)

**Test Scenario:**
```typescript
describe('Monorepo Framework Integration', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(path.join(os.tmpdir(), 'lien-monorepo-test-'));
    
    // Create monorepo structure:
    // root/
    //   package.json (Node.js)
    //   src/utils.ts
    //   tests/utils.test.ts
    //   backend/
    //     composer.json (Laravel)
    //     app/Models/User.php
    //     tests/Unit/UserTest.php
    
    await fs.mkdir(path.join(testDir, 'src'));
    await fs.mkdir(path.join(testDir, 'tests'));
    await fs.mkdir(path.join(testDir, 'backend', 'app', 'Models'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'backend', 'tests', 'Unit'), { recursive: true });
    
    await fs.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify({ name: 'test-monorepo', devDependencies: { vitest: '*' } })
    );
    await fs.writeFile(
      path.join(testDir, 'src/utils.ts'),
      'export function add(a: number, b: number) { return a + b; }'
    );
    await fs.writeFile(
      path.join(testDir, 'tests/utils.test.ts'),
      'import { add } from "../src/utils"; test("add", () => {});'
    );
    
    await fs.writeFile(
      path.join(testDir, 'backend/composer.json'),
      JSON.stringify({ require: { 'laravel/framework': '^10.0' } })
    );
    await fs.writeFile(
      path.join(testDir, 'backend/app/Models/User.php'),
      '<?php namespace App\\Models; class User {}'
    );
    await fs.writeFile(
      path.join(testDir, 'backend/tests/Unit/UserTest.php'),
      '<?php use PHPUnit\\Framework\\TestCase; class UserTest extends TestCase {}'
    );
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  test('detects both Node.js and Laravel frameworks', async () => {
    const detections = await detectAllFrameworks(testDir);
    
    expect(detections).toHaveLength(2);
    expect(detections.find(d => d.name === 'nodejs')).toMatchObject({
      name: 'nodejs',
      path: '.',
      confidence: 'high'
    });
    expect(detections.find(d => d.name === 'laravel')).toMatchObject({
      name: 'laravel',
      path: 'backend',
      confidence: 'high'
    });
  });

  test('indexes files with correct framework paths', async () => {
    const config = await generateConfigFromDetections(testDir);
    const files = await scanCodebaseWithFrameworks(config);
    
    expect(files.has('src/utils.ts')).toBe(true);
    expect(files.get('src/utils.ts')).toBe('typescript');
    
    expect(files.has('backend/app/Models/User.php')).toBe(true);
    expect(files.get('backend/app/Models/User.php')).toBe('php');
  });

  test('associates tests correctly within framework boundaries', async () => {
    const config = await generateConfigFromDetections(testDir);
    await indexCodebase(config, { embeddings: new MockEmbeddings(), verbose: false });
    
    const db = new VectorDB(path.join(testDir, '.lien'));
    await db.initialize();
    
    // Test Node.js associations
    const utilsResults = await db.search('utils', 1, { filepath: 'src/utils.ts' });
    expect(utilsResults[0].metadata.relatedTests).toContain('tests/utils.test.ts');
    
    // Test Laravel associations
    const userResults = await db.search('User', 1, { filepath: 'backend/app/Models/User.php' });
    expect(userResults[0].metadata.relatedTests).toContain('backend/tests/Unit/UserTest.php');
  });
});
```

**Files to Create:**
- `packages/cli/test/integration/monorepo-framework.test.ts` (NEW)

---

#### Task 6.2: Lien Self-Test ⏳
**File:** `packages/cli/test/integration/lien-self.test.ts` (NEW)

**Test Scenario:**
```typescript
describe('Lien Self-Indexing', () => {
  test('detects Node.js framework at root', async () => {
    const lienRoot = path.resolve(__dirname, '../../..');
    const detections = await detectAllFrameworks(lienRoot);
    
    expect(detections).toHaveLength(1);
    expect(detections[0]).toMatchObject({
      name: 'nodejs',
      path: '.',
      confidence: 'high',
      metadata: {
        hasTypeScript: true,
        testFrameworks: ['vitest']
      }
    });
  });

  test('indexes Lien codebase and finds test associations', async () => {
    const lienRoot = path.resolve(__dirname, '../../..');
    const config = await loadConfig(lienRoot);
    
    await indexCodebase(config, { embeddings: new MockEmbeddings(), verbose: false });
    
    const db = new VectorDB(path.join(lienRoot, '.lien'));
    await db.initialize();
    
    // Verify chunker.ts → chunker.test.ts association
    const chunkerResults = await db.search('chunk code', 1, { 
      filepath: 'src/indexer/chunker.ts' 
    });
    expect(chunkerResults[0].metadata.relatedTests).toContain('src/indexer/chunker.test.ts');
  });
});
```

**Files to Create:**
- `packages/cli/test/integration/lien-self.test.ts` (NEW)

---

#### Task 6.3: Auto-Cloning Integration Test (Laravel Breeze) ⏳
**File:** `packages/cli/test/integration/laravel-breeze.test.ts` (NEW)

**Test Scenario:**
```typescript
import { execSync } from 'child_process';

describe('Laravel Breeze Integration', () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = await mkdtemp(path.join(os.tmpdir(), 'lien-laravel-test-'));
    
    // Clone Laravel Breeze
    console.log('Cloning Laravel Breeze (this may take a minute)...');
    execSync(
      'git clone --depth 1 https://github.com/laravel/breeze.git breeze',
      { cwd: testDir, stdio: 'inherit' }
    );
  }, 120000); // 2 minute timeout for cloning

  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  test('detects Laravel framework in Breeze', async () => {
    const breezeDir = path.join(testDir, 'breeze');
    const detections = await detectAllFrameworks(breezeDir);
    
    expect(detections).toHaveLength(1);
    expect(detections[0]).toMatchObject({
      name: 'laravel',
      path: '.',
      confidence: 'high'
    });
  });

  test('indexes Breeze and finds test associations', async () => {
    const breezeDir = path.join(testDir, 'breeze');
    const config = await generateConfigFromDetections(breezeDir);
    
    await indexCodebase(config, { embeddings: new MockEmbeddings(), verbose: false });
    
    const db = new VectorDB(path.join(breezeDir, '.lien'));
    await db.initialize();
    
    // Verify Laravel test patterns work
    const results = await db.search('authentication', 5);
    const authFiles = results.filter(r => r.metadata.filepath.includes('Auth'));
    
    expect(authFiles.length).toBeGreaterThan(0);
    expect(authFiles.some(f => f.metadata.isTest)).toBe(true);
  });
});
```

**Note:** This test is **optional** and can be marked as `.skip()` or run only in CI with the `--integration` flag.

**Files to Create:**
- `packages/cli/test/integration/laravel-breeze.test.ts` (NEW)

---

### **PHASE 7: Documentation & Release** ⏳

#### Task 7.1: Update README ⏳
**File:** `/Users/alfhenderson/Code/lien/README.md`

**Sections to Add/Update:**

1. **Monorepo Support Section:**
```markdown
## Monorepo Support

Lien supports indexing multiple frameworks within a single repository:

```bash
# Example monorepo structure
my-app/
  ├── src/                  # Node.js/TypeScript
  │   ├── utils.ts
  │   └── utils.test.ts
  ├── backend/              # Laravel
  │   ├── app/Models/
  │   └── tests/Unit/
  └── .lien.config.json

# Run lien init from the root
cd my-app
lien init  # Detects both Node.js and Laravel

# Generated config:
{
  "frameworks": [
    {
      "name": "nodejs",
      "path": ".",
      "config": { /* Node.js patterns */ }
    },
    {
      "name": "laravel",
      "path": "backend",
      "config": { /* Laravel patterns */ }
    }
  ]
}
```

Lien will:
- Index files from both frameworks
- Apply framework-specific test patterns
- Associate tests correctly within framework boundaries
```

2. **Update Quick Start:**
```markdown
## Quick Start

1. **Initialize configuration:**
   ```bash
   lien init  # Detects frameworks automatically
   ```

2. **Index your codebase:**
   ```bash
   lien index
   ```

3. **Start the MCP server:**
   ```bash
   lien serve
   ```
```

3. **Migration Guide:**
```markdown
## Migrating from v0.2.0

If you have an existing `.lien.config.json` from v0.2.0:

```bash
# Automatic migration on first load
lien index  # or any command that loads config

# Manual upgrade via init
lien init --upgrade
```

Your old config will be:
- Backed up to `.lien.config.json.v0.2.0.backup`
- Converted to a single "generic" framework at root
- Fully compatible with v0.3.0 features
```

**Files to Modify:**
- `/Users/alfhenderson/Code/lien/README.md`

---

#### Task 7.2: Update CONTRIBUTING.md ⏳
**File:** `/Users/alfhenderson/Code/lien/CONTRIBUTING.md`

**Section to Add:**
```markdown
## Adding a New Framework

To add support for a new framework (e.g., Django, Ruby on Rails):

1. **Create framework directory:**
   ```
   packages/cli/src/frameworks/myframework/
     ├── detector.ts
     ├── config.ts
     └── test-patterns.ts
   ```

2. **Implement detector.ts:**
   ```typescript
   import type { FrameworkDetector } from '../types';

   export const myframeworkDetector: FrameworkDetector = {
     name: 'myframework',

     async detect(dir: string) {
       // Check for framework markers (e.g., package files, config files)
       const hasMarker = await fs.access(path.join(dir, 'myframework.json'));
       if (!hasMarker) return null;

       return {
         name: 'myframework',
         path: '.',
         confidence: 'high',
         metadata: { /* framework-specific data */ }
       };
     },

     generateConfig(detection: DetectionResult) {
       return defaultMyFrameworkConfig(detection.path);
     }
   };
   ```

3. **Register in registry.ts:**
   ```typescript
   import { myframeworkDetector } from './myframework/detector';
   registerFramework(myframeworkDetector);
   ```

4. **Add tests:**
   ```
   packages/cli/test/integration/myframework.test.ts
   ```

5. **Submit PR with:**
   - Detector implementation
   - Default config and test patterns
   - Integration test
   - Documentation update
```

**Files to Modify:**
- `/Users/alfhenderson/Code/lien/CONTRIBUTING.md`

---

#### Task 7.3: Update CHANGELOG ⏳
**File:** `/Users/alfhenderson/Code/lien/CHANGELOG.md`

**Add v0.3.0 Entry:**
```markdown
## [0.3.0] - 2025-11-XX

### 🚀 Major Features

#### Framework Plugin Architecture
- **Monorepo Support**: Index multiple frameworks in a single repository
- **Path-Aware Indexing**: Each framework maintains its own include/exclude patterns
- **Smart Framework Detection**: Automatically detects Node.js, Laravel, and more
- **Interactive `lien init`**: Guided setup with framework recommendations

#### Supported Frameworks (Launch)
- **Node.js**: Jest, Vitest, Mocha, AVA test patterns
- **Laravel**: PHPUnit, Pest test patterns

### ✨ Enhancements
- **Config Migration**: Automatic upgrade from v0.2.0 to v0.3.0
- **Test Association Improvements**: Framework-aware test-source linking
- **Better Scanner**: Respects per-framework .gitignore files

### 🔧 Breaking Changes
- **Config Schema Change**: `.lien.config.json` now uses `frameworks` array
  - Old configs are auto-migrated with backup
  - No manual intervention required

### 📚 Documentation
- Added monorepo usage guide
- Added framework plugin development guide
- Updated migration instructions

### 🧪 Testing
- Added monorepo integration tests
- Added self-indexing tests (Lien on Lien)
- Added Laravel Breeze integration test
```

**Files to Modify:**
- `/Users/alfhenderson/Code/lien/CHANGELOG.md`

---

#### Task 7.4: Remove Old Hardcoded Language Support ⏳
**Files to Clean Up:**

These languages are no longer needed in the old monolithic structure:
- Java, Rust, C#, Ruby, Kotlin, Swift, Scala, C/C++

**Actions:**
1. Remove hardcoded patterns from `src/indexer/test-patterns.ts` (keep TypeScript, JavaScript, PHP)
2. Remove language-specific test fixtures if they exist
3. Update `detectLanguage()` in `scanner.ts` to only handle core languages (TS, JS, PHP, or detect via framework)

**Rationale:** 
- These will be re-added as framework plugins in future releases
- Keeps v0.3.0 focused and testable
- Community can contribute language support incrementally

---

#### Task 7.5: Release v0.3.0 ⏳
**Commands:**
```bash
# Run automated release script
npm run release minor

# This will:
# 1. Bump version to 0.3.0
# 2. Build project
# 3. Update CHANGELOG.md
# 4. Commit changes
# 5. Create git tag v0.3.0
```

**Manual Checklist Before Release:**
- [ ] All tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] README.md updated
- [ ] CONTRIBUTING.md updated
- [ ] CHANGELOG.md has v0.3.0 entry
- [ ] Integration tests pass (at least monorepo and self-test)

---

## 📁 Key File Locations (Quick Reference)

### Config System
- `packages/cli/src/config/schema.ts` - Config interfaces (MODIFIED)
- `packages/cli/src/config/loader.ts` - Loads and migrates configs (NEEDS MIGRATION CALL)
- `packages/cli/src/config/migration.ts` - Migration logic (TO CREATE)

### Framework System
- `packages/cli/src/frameworks/types.ts` - Interfaces (CREATED)
- `packages/cli/src/frameworks/registry.ts` - Framework registration (CREATED)
- `packages/cli/src/frameworks/detector-service.ts` - Recursive detection (CREATED)
- `packages/cli/src/frameworks/nodejs/` - Node.js support (CREATED)
- `packages/cli/src/frameworks/laravel/` - Laravel support (CREATED)

### Indexing Pipeline
- `packages/cli/src/indexer/scanner.ts` - File scanning (MODIFIED - framework-aware scanner added)
- `packages/cli/src/indexer/test-patterns.ts` - Test matching (NEEDS PATH-AWARE UPDATE)
- `packages/cli/src/indexer/index.ts` - Orchestration (NEEDS FRAMEWORK CONTEXT)

### CLI
- `packages/cli/src/cli/init.ts` - Init command (NEEDS INTERACTIVE REWRITE)
- `packages/cli/src/cli/index.ts` - CLI entry point

### Tests
- `packages/cli/test/integration/monorepo-framework.test.ts` (TO CREATE)
- `packages/cli/test/integration/lien-self.test.ts` (TO CREATE)
- `packages/cli/test/integration/laravel-breeze.test.ts` (TO CREATE)

---

## 🎯 Implementation Priority Order

**Next Session Start Here:**

1. ✅ ~~Phase 4.1: Scanner~~ (DONE)
2. ✅ ~~Phase 4.2: Test Pattern Matching~~ (DONE - commit ab18bb4)
3. **Phase 4.3: Index Orchestration** ← START HERE
4. **Phase 5.1: Config Migration**
5. **Phase 5.2: Enhanced Init**
6. **Phase 6.1: Monorepo Integration Test**
7. **Phase 6.2: Lien Self-Test**
8. **Phase 7.1: Update README**
9. **Phase 7.2: Update CONTRIBUTING**
10. **Phase 7.3: Update CHANGELOG**
11. **Phase 7.4: Remove Old Language Support**
12. **Phase 7.5: Release v0.3.0**

---

## 🧪 Testing Strategy

### Unit Tests
- Test migration logic with various old config shapes
- Test path normalization in test-patterns.ts
- Test framework detection edge cases

### Integration Tests
- **Monorepo test** (Node.js + Laravel) - MUST PASS
- **Self-indexing test** (Lien on Lien) - MUST PASS
- **Laravel Breeze test** (optional, CI only)

### Manual Testing Checklist
```bash
# 1. Test fresh init
cd /tmp/test-project
lien init
cat .lien.config.json  # Should show framework detection

# 2. Test migration
cd /Users/alfhenderson/Code/old-project  # Has v0.2.0 config
lien index  # Should auto-migrate and create backup

# 3. Test monorepo
cd /Users/alfhenderson/Code/shopify-cognito-app
lien init  # Should detect both Node.js and Laravel
lien index
lien serve
# In Cursor: @semantic_search "authentication"
# Should return both TS and PHP results with correct test associations
```

---

## 🐛 Known Gotchas

1. **Path Handling:**
   - Always normalize paths relative to framework root
   - Watch for trailing slashes in framework.path
   - Handle "." (root) vs "backend" correctly

2. **Migration Edge Cases:**
   - Empty configs
   - Partial configs (missing fields)
   - Configs with custom embeddings providers

3. **Framework Detection:**
   - Nested frameworks (e.g., Node.js app with embedded Laravel)
   - Depth limit (3) may miss very deep projects
   - False positives (e.g., test fixtures with package.json)

4. **Test Association:**
   - Files at framework boundaries
   - Shared test utilities across frameworks
   - Monorepo test helpers (e.g., test-utils/ at root)

---

## 📊 Success Criteria for v0.3.0

- [ ] **Dogfooding**: Lien indexes itself successfully with path-aware test associations
- [ ] **Monorepo**: User's Laravel + Node.js monorepo works without manual config tweaks
- [ ] **Migration**: All v0.2.0 configs upgrade seamlessly
- [ ] **Integration Tests**: At least 2/3 pass (monorepo + self, Breeze optional)
- [ ] **Documentation**: README has monorepo examples and migration guide
- [ ] **Performance**: Indexing time comparable to v0.2.0 (no regression)

---

## 🚀 Post-v0.3.0 Roadmap

### v0.4.0: Extended Framework Support
- Django (Python)
- Ruby on Rails
- Spring Boot (Java)

### v0.5.0: Advanced Features
- Framework-specific code intelligence (e.g., Laravel Eloquent, React hooks)
- Cross-framework imports (e.g., Node.js calling PHP API)
- Multi-language monorepo optimization

---

## 💬 Communication Notes

**For the Next Session AI:**

1. **Context is King:** Read the "Completed Work" section carefully. Don't redo Phase 1-3.
2. **Start at Phase 4.2:** Update `test-patterns.ts` with path-aware logic (see Task 4.2).
3. **Test Everything:** After each phase, run `npm test` to catch regressions.
4. **Commit Often:** Use `git commit` with descriptive WIP messages after each task.
5. **Ask Before Breaking:** If you find a better architecture, discuss before rewriting completed phases.

**Key Principles:**
- Path-awareness is critical for monorepos
- Backwards compatibility via migration (no breaking v0.2.0 users)
- Test detection must respect framework boundaries
- Integration tests are non-negotiable for v0.3.0 quality

---

**End of Continuation Plan**
*Generated: 2025-11-13*
*Version: v0.3.0-dev (pre-release)*

