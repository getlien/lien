import path from 'path';
import type { TestPatternConfig } from '../config/schema.js';

/**
 * Language-specific test patterns for detecting and associating test files
 */

export interface LanguageTestPattern {
  // File extensions for test files
  extensions: string[];
  // Common test directories
  directories: string[];
  // Test file prefixes (e.g., "test_")
  prefixes: string[];
  // Test file suffixes (e.g., ".test", ".spec")
  suffixes: string[];
  // Test frameworks for detection
  frameworks: string[];
}

/**
 * Comprehensive test patterns for 12 languages
 */
export const LANGUAGE_TEST_PATTERNS: Record<string, LanguageTestPattern> = {
  // Tier 1: TypeScript/JavaScript, Python, Go, PHP
  typescript: {
    extensions: ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx'],
    directories: ['test', 'tests', '__tests__', 'spec', 'specs'],
    prefixes: [],
    suffixes: ['.test', '.spec'],
    frameworks: ['jest', 'vitest', 'mocha', 'jasmine', 'ava'],
  },
  javascript: {
    extensions: ['.test.js', '.test.jsx', '.spec.js', '.spec.jsx', '.test.mjs', '.test.cjs'],
    directories: ['test', 'tests', '__tests__', 'spec', 'specs'],
    prefixes: [],
    suffixes: ['.test', '.spec'],
    frameworks: ['jest', 'vitest', 'mocha', 'jasmine', 'ava'],
  },
  python: {
    extensions: [], // Python tests detected by prefix/suffix/directory only
    directories: ['test', 'tests', '__tests__', 'spec', 'specs'],
    prefixes: ['test_'],
    suffixes: ['_test'],
    frameworks: ['pytest', 'unittest', 'nose', 'doctest'],
  },
  go: {
    extensions: ['_test.go'],
    directories: [],
    prefixes: [],
    suffixes: ['_test'],
    frameworks: ['testing', 'testify'],
  },
  php: {
    extensions: ['Test.php'],
    directories: ['test', 'tests', 'Tests', 'spec', 'specs'],
    prefixes: [],
    suffixes: ['Test'],
    frameworks: ['phpunit', 'pest', 'codeception'],
  },

  // Tier 2: Java, Rust, C#, Ruby
  java: {
    extensions: ['Test.java', 'Tests.java'],
    directories: ['test', 'tests', 'src/test'],
    prefixes: [],
    suffixes: ['Test', 'Tests'],
    frameworks: ['junit', 'testng', 'mockito'],
  },
  rust: {
    extensions: [], // Rust tests detected by directory or _test suffix
    directories: ['tests'],
    prefixes: [],
    suffixes: ['_test'],
    frameworks: ['cargo-test'],
  },
  csharp: {
    extensions: ['Test.cs', 'Tests.cs'],
    directories: ['test', 'tests', 'Test', 'Tests'],
    prefixes: [],
    suffixes: ['Test', 'Tests'],
    frameworks: ['nunit', 'xunit', 'mstest'],
  },
  ruby: {
    extensions: ['_test.rb', '_spec.rb'],
    directories: ['test', 'tests', 'spec', 'specs'],
    prefixes: ['test_'],
    suffixes: ['_test', '_spec'],
    frameworks: ['minitest', 'rspec', 'test-unit'],
  },

  // Tier 3: Kotlin, Swift, Scala, C/C++
  kotlin: {
    extensions: ['Test.kt', 'Tests.kt'],
    directories: ['test', 'tests', 'src/test'],
    prefixes: [],
    suffixes: ['Test', 'Tests'],
    frameworks: ['junit', 'kotlintest', 'spek'],
  },
  swift: {
    extensions: ['Test.swift', 'Tests.swift'],
    directories: ['Tests', 'test', 'tests'],
    prefixes: [],
    suffixes: ['Test', 'Tests'],
    frameworks: ['xctest', 'quick', 'nimble'],
  },
  scala: {
    extensions: ['Test.scala', 'Spec.scala'],
    directories: ['test', 'tests', 'src/test'],
    prefixes: [],
    suffixes: ['Test', 'Spec'],
    frameworks: ['scalatest', 'specs2', 'munit'],
  },
  c: {
    extensions: ['_test.c', '_tests.c'],
    directories: ['test', 'tests'],
    prefixes: ['test_'],
    suffixes: ['_test', '_tests'],
    frameworks: ['unity', 'cmocka', 'check'],
  },
  cpp: {
    extensions: ['_test.cpp', '_tests.cpp', 'Test.cpp', 'Tests.cpp'],
    directories: ['test', 'tests'],
    prefixes: ['test_'],
    suffixes: ['_test', '_tests', 'Test', 'Tests'],
    frameworks: ['gtest', 'catch2', 'boost-test'],
  },
};

/**
 * Check if a file is a test file based on language-specific patterns
 */
export function isTestFile(filepath: string, language: string): boolean {
  const patterns = LANGUAGE_TEST_PATTERNS[language];
  if (!patterns) {
    return false;
  }

  const basename = path.basename(filepath);
  const dirname = path.dirname(filepath);
  const parts = dirname.split(path.sep);

  // Check if file matches test extension patterns
  for (const ext of patterns.extensions) {
    if (basename.endsWith(ext)) {
      return true;
    }
  }

  // Check if file is in a test directory
  for (const testDir of patterns.directories) {
    if (parts.includes(testDir)) {
      // File is in a test directory
      // Check if language has "suffix-style" test extensions (like Test.php)
      // vs "additive" extensions (like .test.ts)
      // Key difference: "Test.php" has no dot before Test, while ".test.ts" has a dot before test
      const languageExtensions = getLanguageExtensions(language);
      const hasSuffixStyleExtensions = patterns.extensions.some(testExt => {
        // Check if any language extension is at the end
        const langExt = languageExtensions.find(ext => testExt.endsWith(ext));
        if (!langExt) return false;
        
        // Get the part before the language extension
        const prefix = testExt.slice(0, -langExt.length);
        // If prefix doesn't start with a dot, it's a suffix-style (like "Test" in "Test.php")
        // If prefix starts with a dot, it's additive (like ".test" in ".test.ts")
        return prefix.length > 0 && !prefix.startsWith('.');
      });
      
      if (hasSuffixStyleExtensions) {
        // Language uses suffix-style extensions (PHP Test.php, Java Test.java)
        // Require explicit suffix patterns to avoid matching helper files
        const nameWithoutExt = getNameWithoutExtension(basename, language);
        
        // Check suffixes
        for (const suffix of patterns.suffixes) {
          if (nameWithoutExt.endsWith(suffix)) {
            return true;
          }
        }
        
        // Check prefixes
        for (const prefix of patterns.prefixes) {
          if (nameWithoutExt.startsWith(prefix)) {
            return true;
          }
        }
      } else {
        // Language uses additive extensions (.test.ts) OR no extensions (Python)
        // Any language file in test dir is a test
        if (languageExtensions.some(ext => basename.endsWith(ext))) {
          return true;
        }
      }
    }
  }

  // Check prefix patterns (e.g., test_example.py)
  const nameWithoutExt = getNameWithoutExtension(basename, language);
  for (const prefix of patterns.prefixes) {
    if (nameWithoutExt.startsWith(prefix)) {
      return true;
    }
  }

  // Check suffix patterns (e.g., example_test.py)
  for (const suffix of patterns.suffixes) {
    if (nameWithoutExt.endsWith(suffix)) {
      return true;
    }
  }

  return false;
}

/**
 * Helper: Normalize path by stripping framework prefix
 * @param file - File path (e.g., "cognito-backend/app/Models/User.php")
 * @param fwPath - Framework path (e.g., "cognito-backend" or ".")
 * @returns Relative path within framework (e.g., "app/Models/User.php")
 */
function normalizePathForFramework(file: string, fwPath: string): string {
  // If framework is at root, no change needed
  if (fwPath === '.') return file;
  
  // Strip framework prefix to get relative path within framework
  // e.g., "cognito-backend/app/Models/User.php" → "app/Models/User.php"
  if (file.startsWith(fwPath + '/')) {
    return file.slice(fwPath.length + 1);
  }
  
  // File doesn't have framework prefix (shouldn't happen in practice)
  return file;
}

/**
 * Helper: Add framework prefix to a path
 * @param file - Relative path within framework (e.g., "app/Models/User.php")
 * @param fwPath - Framework path (e.g., "cognito-backend" or ".")
 * @returns Full path from project root (e.g., "cognito-backend/app/Models/User.php")
 */
function addFrameworkPrefix(file: string, fwPath: string): string {
  // If framework is at root, no change needed
  if (fwPath === '.') return file;
  
  // Add framework prefix
  return `${fwPath}/${file}`;
}

/**
 * Helper: Convert TestPatternConfig to LanguageTestPattern
 */
function testPatternConfigToLanguagePattern(config: TestPatternConfig): LanguageTestPattern {
  return {
    extensions: config.extensions,
    directories: config.directories,
    prefixes: config.prefixes,
    suffixes: config.suffixes,
    frameworks: config.frameworks,
  };
}

/**
 * Find test files associated with a source file
 * @param sourceFile - Source file path (relative to project root)
 * @param language - Programming language
 * @param allFiles - All files in the project (relative to project root)
 * @param frameworkPath - Framework path (e.g., "." for root, "cognito-backend" for subfolder)
 * @param patterns - Optional framework-specific test patterns (overrides language defaults)
 */
export function findTestFiles(
  sourceFile: string,
  language: string,
  allFiles: string[],
  frameworkPath: string = '.',
  patterns?: TestPatternConfig
): string[] {
  // Use framework-specific patterns if provided, otherwise fall back to language patterns
  const testPatterns = patterns 
    ? testPatternConfigToLanguagePattern(patterns)
    : LANGUAGE_TEST_PATTERNS[language];
  
  if (!testPatterns) {
    return [];
  }

  // Normalize paths relative to framework
  const normalizedSource = normalizePathForFramework(sourceFile, frameworkPath);
  const normalizedFiles = allFiles
    .filter(f => {
      if (frameworkPath === '.') {
        // At root, include all files that don't belong to other frameworks
        // (i.e., files that don't start with a subfolder that looks like a framework path)
        // For now, include all files since we can't determine which are framework roots
        return true;
      }
      // For non-root frameworks, only include files within this framework
      return f.startsWith(frameworkPath + '/');
    })
    .map(f => normalizePathForFramework(f, frameworkPath));

  const baseName = getBaseName(normalizedSource);
  const sourceDir = path.dirname(normalizedSource);
  const matches: string[] = [];

  // Strategy 1: Co-located tests (same directory)
  // Example: src/Button.tsx → src/Button.test.tsx
  for (const ext of testPatterns.extensions) {
    const candidate = path.join(sourceDir, baseName + ext);
    if (normalizedFiles.includes(candidate)) {
      matches.push(candidate);
    }
  }

  // Apply suffix patterns for co-located tests
  for (const suffix of testPatterns.suffixes) {
    const languageExts = getLanguageExtensions(language);
    for (const langExt of languageExts) {
      // Co-located (same directory as source)
      const candidate = path.join(sourceDir, baseName + suffix + langExt);
      if (normalizedFiles.includes(candidate)) {
        matches.push(candidate);
      }

      // At framework root (for files like calculator_test.py at root)
      const atRoot = baseName + suffix + langExt;
      if (normalizedFiles.includes(atRoot)) {
        matches.push(atRoot);
      }
    }
  }

  // Strategy 2: Parallel directory structure
  // Example: src/components/Button.tsx → tests/components/Button.test.tsx
  for (const testDir of testPatterns.directories) {
    const relativePath = getRelativePathFromSrc(normalizedSource);
    const relativeDir = path.dirname(relativePath);
    
    for (const ext of testPatterns.extensions) {
      const candidate = path.join(testDir, relativeDir, baseName + ext);
      if (normalizedFiles.includes(candidate)) {
        matches.push(candidate);
      }
    }

    // Also try without subdirectory nesting (flat structure)
    for (const ext of testPatterns.extensions) {
      const candidate = path.join(testDir, baseName + ext);
      if (normalizedFiles.includes(candidate)) {
        matches.push(candidate);
      }
    }

    // Strategy 2b: Search test directory recursively for matching filename
    // This handles Laravel-style organization (tests/Feature/, tests/Unit/)
    // and other frameworks that organize by test type rather than source structure
    for (const ext of testPatterns.extensions) {
      const targetFilename = baseName + ext;
      const matchingFiles = normalizedFiles.filter(f => {
        // Check if file contains the test directory in its path and ends with target filename
        const pathParts = f.split(path.sep);
        return pathParts.includes(testDir) && f.endsWith(targetFilename);
      });
      matches.push(...matchingFiles);
    }
  }

  // Strategy 3: Prefix patterns (Python, C, etc.)
  for (const prefix of testPatterns.prefixes) {
    const languageExts = getLanguageExtensions(language);
    for (const langExt of languageExts) {
      // Co-located (same directory as source)
      const colocated = path.join(sourceDir, prefix + baseName + langExt);
      if (normalizedFiles.includes(colocated)) {
        matches.push(colocated);
      }

      // At framework root (for files like test_calculator.py at root)
      const atRoot = prefix + baseName + langExt;
      if (normalizedFiles.includes(atRoot)) {
        matches.push(atRoot);
      }

      // In test directories
      for (const testDir of testPatterns.directories) {
        const inTestDir = path.join(testDir, prefix + baseName + langExt);
        if (normalizedFiles.includes(inTestDir)) {
          matches.push(inTestDir);
        }
      }
    }
  }

  // Remove duplicates and add framework prefix back
  const uniqueMatches = [...new Set(matches)];
  return uniqueMatches.map(m => addFrameworkPrefix(m, frameworkPath));
}

/**
 * Find source files associated with a test file (reverse operation)
 * @param testFile - Test file path (relative to project root)
 * @param language - Programming language
 * @param allFiles - All files in the project (relative to project root)
 * @param frameworkPath - Framework path (e.g., "." for root, "cognito-backend" for subfolder)
 * @param patterns - Optional framework-specific test patterns (overrides language defaults)
 */
export function findSourceFiles(
  testFile: string,
  language: string,
  allFiles: string[],
  frameworkPath: string = '.',
  patterns?: TestPatternConfig
): string[] {
  // Use framework-specific patterns if provided, otherwise fall back to language patterns
  const testPatterns = patterns 
    ? testPatternConfigToLanguagePattern(patterns)
    : LANGUAGE_TEST_PATTERNS[language];
  
  if (!testPatterns) {
    return [];
  }

  // Normalize paths relative to framework
  const normalizedTest = normalizePathForFramework(testFile, frameworkPath);
  const normalizedFiles = allFiles
    .filter(f => f.startsWith(frameworkPath === '.' ? '' : frameworkPath + '/') || frameworkPath === '.')
    .map(f => normalizePathForFramework(f, frameworkPath));

  const testBasename = path.basename(normalizedTest);
  const testDir = path.dirname(normalizedTest);
  const matches: string[] = [];

  // Extract base name by removing test patterns
  let baseName = getNameWithoutExtension(testBasename, language);
  
  // Remove test extensions
  for (const ext of testPatterns.extensions) {
    if (testBasename.endsWith(ext)) {
      baseName = testBasename.slice(0, -ext.length);
      break;
    }
  }

  // Remove test suffixes
  for (const suffix of testPatterns.suffixes) {
    if (baseName.endsWith(suffix)) {
      baseName = baseName.slice(0, -suffix.length);
    }
  }

  // Remove test prefixes
  for (const prefix of testPatterns.prefixes) {
    if (baseName.startsWith(prefix)) {
      baseName = baseName.slice(prefix.length);
    }
  }

  const languageExts = getLanguageExtensions(language);

  // Strategy 1: Co-located source file
  for (const langExt of languageExts) {
    const candidate = path.join(testDir, baseName + langExt);
    if (normalizedFiles.includes(candidate) && !isTestFile(addFrameworkPrefix(candidate, frameworkPath), language)) {
      matches.push(candidate);
    }
  }

  // Strategy 2: Source in src/lib directories
  const sourceDirs = ['src', 'lib', 'app', 'core', 'main'];
  const testDirParts = testDir.split(path.sep);
  
  for (const sourceDir of sourceDirs) {
    // Try to maintain subdirectory structure
    const relativePath = getRelativePathFromTest(normalizedTest);
    const relativeDir = path.dirname(relativePath);
    
    for (const langExt of languageExts) {
      const candidate = path.join(sourceDir, relativeDir, baseName + langExt);
      if (normalizedFiles.includes(candidate) && !isTestFile(addFrameworkPrefix(candidate, frameworkPath), language)) {
        matches.push(candidate);
      }
    }

    // Try flat structure
    for (const langExt of languageExts) {
      const candidate = path.join(sourceDir, baseName + langExt);
      if (normalizedFiles.includes(candidate) && !isTestFile(addFrameworkPrefix(candidate, frameworkPath), language)) {
        matches.push(candidate);
      }
    }
  }

  // Strategy 3: Search entire framework codebase for matching basename
  for (const file of normalizedFiles) {
    if (isTestFile(addFrameworkPrefix(file, frameworkPath), language)) continue;
    
    const fileBaseName = getBaseName(file);
    if (fileBaseName === baseName) {
      matches.push(file);
    }
  }

  // Remove duplicates and add framework prefix back
  const uniqueMatches = [...new Set(matches)];
  return uniqueMatches.map(m => addFrameworkPrefix(m, frameworkPath));
}

/**
 * Detect test framework from file content (optional enhancement)
 */
export function detectTestFramework(content: string, language: string): string | undefined {
  const patterns = LANGUAGE_TEST_PATTERNS[language];
  if (!patterns) {
    return undefined;
  }

  for (const framework of patterns.frameworks) {
    // Simple pattern matching for framework imports/usage
    const frameworkPattern = new RegExp(`\\b${framework}\\b`, 'i');
    if (frameworkPattern.test(content)) {
      return framework;
    }
  }

  return undefined;
}

// Helper functions

function getBaseName(filepath: string): string {
  const basename = path.basename(filepath);
  const lastDot = basename.lastIndexOf('.');
  if (lastDot === -1) return basename;
  
  // Handle double extensions like .test.ts
  const secondLastDot = basename.lastIndexOf('.', lastDot - 1);
  if (secondLastDot !== -1) {
    const possiblePattern = basename.slice(secondLastDot, lastDot);
    if (['.test', '.spec', '_test', '_spec'].includes(possiblePattern)) {
      return basename.slice(0, secondLastDot);
    }
  }
  
  return basename.slice(0, lastDot);
}

function getNameWithoutExtension(basename: string, language: string): string {
  const exts = getLanguageExtensions(language);
  for (const ext of exts) {
    if (basename.endsWith(ext)) {
      return basename.slice(0, -ext.length);
    }
  }
  return basename;
}

function getLanguageExtensions(language: string): string[] {
  const extMap: Record<string, string[]> = {
    typescript: ['.ts', '.tsx'],
    javascript: ['.js', '.jsx', '.mjs', '.cjs'],
    python: ['.py'],
    go: ['.go'],
    php: ['.php'],
    java: ['.java'],
    rust: ['.rs'],
    csharp: ['.cs'],
    ruby: ['.rb'],
    kotlin: ['.kt'],
    swift: ['.swift'],
    scala: ['.scala'],
    c: ['.c', '.h'],
    cpp: ['.cpp', '.cc', '.cxx', '.hpp', '.h'],
  };
  return extMap[language] || [];
}

function getRelativePathFromSrc(filepath: string): string {
  const parts = filepath.split(path.sep);
  const srcIndex = parts.findIndex(p => ['src', 'lib', 'app', 'core', 'main'].includes(p));
  if (srcIndex !== -1) {
    return parts.slice(srcIndex + 1).join(path.sep);
  }
  return filepath;
}

function getRelativePathFromTest(filepath: string): string {
  const patterns = Object.values(LANGUAGE_TEST_PATTERNS)
    .flatMap(p => p.directories);
  
  const parts = filepath.split(path.sep);
  const testIndex = parts.findIndex(p => patterns.includes(p));
  if (testIndex !== -1) {
    return parts.slice(testIndex + 1).join(path.sep);
  }
  return filepath;
}

