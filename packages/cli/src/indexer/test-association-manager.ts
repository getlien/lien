import path from 'path';
import chalk from 'chalk';
import { type RelativePath } from '../types/paths.js';
import { type FrameworkInstance } from '../config/schema.js';
import { type TestAssociation } from './types.js';
import { detectLanguage } from './scanner.js';
import { 
  isTestFile, 
  getBaseName,
  getLanguageExtensions,
  findOwningFramework,
  LANGUAGE_TEST_PATTERNS,
  testPatternConfigToLanguagePattern,
  type LanguageTestPattern
} from './test-patterns.js';

/**
 * Manages test-source file associations with clear invariants:
 * 
 * 1. All paths are RelativePath (to project root)
 * 2. Bidirectional associations built in one pass
 * 3. Framework ownership determined once per file (cached)
 * 4. Validation catches errors early
 */
export class TestAssociationManager {
  private associations = new Map<RelativePath, TestAssociation>();
  private filesByFramework = new Map<string, Set<RelativePath>>();
  private frameworkCache = new Map<RelativePath, FrameworkInstance | null>();
  
  constructor(
    private files: RelativePath[],
    private frameworks: FrameworkInstance[],
    private verbose: boolean = false
  ) {
    this.partitionFilesByFramework();
  }
  
  /**
   * Pre-compute which framework owns each file
   * Reduces complexity from O(n×m) to O(n)
   */
  private partitionFilesByFramework(): void {
    if (this.verbose) {
      console.log(chalk.cyan(`[AssociationManager] Partitioning ${this.files.length} files by framework...`));
    }
    
    for (const file of this.files) {
      const framework = findOwningFramework(file, this.frameworks, false);
      const key = framework?.path || '.';
      
      // Cache framework lookup
      this.frameworkCache.set(file, framework);
      
      // Group files by framework
      if (!this.filesByFramework.has(key)) {
        this.filesByFramework.set(key, new Set());
      }
      this.filesByFramework.get(key)!.add(file);
    }
    
    if (this.verbose) {
      console.log(chalk.cyan(`[AssociationManager] Found ${this.filesByFramework.size} framework(s)`));
    }
  }
  
  /**
   * Get cached framework for a file
   */
  private getFramework(file: RelativePath): FrameworkInstance | null {
    return this.frameworkCache.get(file) || null;
  }
  
  /**
   * Build all associations in a single pass
   */
  buildAssociations(): void {
    if (this.verbose) {
      console.log(chalk.cyan('[AssociationManager] Building associations...'));
    }
    
    // Separate test and source files
    const testFiles: RelativePath[] = [];
    const sourceFiles: RelativePath[] = [];
    
    for (const file of this.files) {
      const language = detectLanguage(file);
      if (isTestFile(file, language)) {
        testFiles.push(file);
      } else {
        sourceFiles.push(file);
      }
    }
    
    if (this.verbose) {
      console.log(chalk.cyan(`[AssociationManager] ${sourceFiles.length} source files, ${testFiles.length} test files`));
    }
    
    // Build bidirectional associations
    this.buildSourceToTestAssociations(sourceFiles);
    this.buildTestToSourceAssociations(testFiles);
    
    // Validate associations
    if (this.verbose) {
      this.validateAssociations();
    }
  }
  
  /**
   * Build source → test associations
   */
  private buildSourceToTestAssociations(sourceFiles: RelativePath[]): void {
    let count = 0;
    
    for (const sourceFile of sourceFiles) {
      const language = detectLanguage(sourceFile);
      const framework = this.getFramework(sourceFile);
      const relatedTests = this.findTestsForSource(sourceFile, language, framework);
      
      this.associations.set(sourceFile, {
        file: sourceFile,
        relatedTests,
        isTest: false,
        detectionMethod: 'convention'
      });
      
      if (this.verbose && relatedTests.length > 0 && count++ < 5) {
        console.log(chalk.gray(`[Verbose] ${sourceFile} → ${relatedTests.join(', ')}`));
      }
    }
    
    const sourcesWithTests = Array.from(this.associations.values())
      .filter(a => !a.isTest && a.relatedTests && a.relatedTests.length > 0).length;
    
    if (this.verbose) {
      console.log(chalk.green(`[AssociationManager] ${sourcesWithTests} source files have tests`));
    }
  }
  
  /**
   * Build test → source associations
   */
  private buildTestToSourceAssociations(testFiles: RelativePath[]): void {
    let count = 0;
    
    for (const testFile of testFiles) {
      const language = detectLanguage(testFile);
      const framework = this.getFramework(testFile);
      const relatedSources = this.findSourcesForTest(testFile, language, framework);
      
      this.associations.set(testFile, {
        file: testFile,
        relatedSources,
        isTest: true,
        detectionMethod: 'convention'
      });
      
      if (this.verbose && relatedSources.length > 0 && count++ < 5) {
        console.log(chalk.gray(`[Verbose] ${testFile} → ${relatedSources.join(', ')}`));
      }
    }
    
    const testsWithSources = testFiles.filter(tf => {
      const assoc = this.associations.get(tf);
      return assoc && assoc.relatedSources && assoc.relatedSources.length > 0;
    }).length;
    
    if (this.verbose) {
      console.log(chalk.green(`[AssociationManager] ${testsWithSources} test files found their sources`));
    }
  }
  
  /**
   * Find tests for a source file
   * Simplified from findTestFiles() - uses set filtering instead of array iteration
   */
  private findTestsForSource(
    sourceFile: RelativePath,
    language: string,
    framework: FrameworkInstance | null
  ): string[] {
    const patterns = framework?.config.testPatterns;
    const frameworkPath = framework?.path || '.';
    const frameworkFiles = this.filesByFramework.get(frameworkPath);
    
    if (!frameworkFiles) return [];
    
    const baseName = getBaseName(sourceFile);
    const testPatterns = patterns 
      ? testPatternConfigToLanguagePattern(patterns)
      : LANGUAGE_TEST_PATTERNS[language];
    
    if (!testPatterns) return [];
    
    const matches: string[] = [];
    
    // Iterate over pre-filtered framework files (much faster)
    for (const file of frameworkFiles) {
      if (this.isTestForSource(file, baseName, testPatterns)) {
        matches.push(file);
      }
    }
    
    return matches;
  }
  
  /**
   * Check if a file is a test for the given source
   * Simplified matching logic
   */
  private isTestForSource(
    candidateFile: RelativePath,
    sourceBaseName: string,
    patterns: LanguageTestPattern
  ): boolean {
    const fileName = path.basename(candidateFile);
    const language = detectLanguage(candidateFile);
    
    // Strategy 1: Check test extensions (e.g., .test.ts, .spec.ts)
    for (const ext of patterns.extensions) {
      if (fileName === `${sourceBaseName}${ext}`) {
        return true;
      }
    }
    
    // Strategy 2: Check suffixes (e.g., AuthController + Test + .php)
    const langExts = getLanguageExtensions(language);
    for (const suffix of patterns.suffixes) {
      for (const langExt of langExts) {
        if (fileName === `${sourceBaseName}${suffix}${langExt}`) {
          return true;
        }
      }
    }
    
    // Strategy 3: Check prefixes (e.g., test_ + calculator + .py)
    for (const prefix of patterns.prefixes) {
      for (const langExt of langExts) {
        if (fileName === `${prefix}${sourceBaseName}${langExt}`) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  /**
   * Find sources for a test file
   * Simplified from findSourceFiles()
   */
  private findSourcesForTest(
    testFile: RelativePath,
    language: string,
    framework: FrameworkInstance | null
  ): string[] {
    const baseName = this.extractSourceBaseName(testFile, language);
    const frameworkPath = framework?.path || '.';
    const frameworkFiles = this.filesByFramework.get(frameworkPath);
    
    if (!frameworkFiles) return [];
    
    const matches: string[] = [];
    
    for (const file of frameworkFiles) {
      const fileBaseName = getBaseName(file);
      const fileLanguage = detectLanguage(file);
      
      // Match by base name and ensure it's not a test file
      if (fileBaseName === baseName && !isTestFile(file, fileLanguage)) {
        matches.push(file);
      }
    }
    
    return matches;
  }
  
  /**
   * Extract source base name from test file name
   * Examples:
   *   AuthControllerTest.php → AuthController
   *   test_calculator.py → calculator
   *   Button.test.tsx → Button
   */
  private extractSourceBaseName(testFile: RelativePath, language: string): string {
    const patterns = LANGUAGE_TEST_PATTERNS[language];
    if (!patterns) return getBaseName(testFile);
    
    let baseName = path.basename(testFile, path.extname(testFile));
    
    // Remove test suffixes
    for (const suffix of patterns.suffixes) {
      if (baseName.endsWith(suffix)) {
        baseName = baseName.slice(0, -suffix.length);
        break; // Only remove one suffix
      }
    }
    
    // Remove test prefixes
    for (const prefix of patterns.prefixes) {
      if (baseName.startsWith(prefix)) {
        baseName = baseName.slice(prefix.length);
        break; // Only remove one prefix
      }
    }
    
    return baseName;
  }
  
  /**
   * Validate associations to catch bugs early
   * This validation would have caught the v0.3.6 bug!
   */
  private validateAssociations(): void {
    let invalidCount = 0;
    const errors: string[] = [];
    
    for (const [file, assoc] of this.associations) {
      // Check 1: No absolute paths (should never happen with typed paths)
      if (file.startsWith('/') || file.match(/^[A-Z]:\\/)) {
        errors.push(`❌ Absolute path in associations: ${file}`);
        invalidCount++;
      }
      
      // Check 2: No empty strings in related arrays
      const related = assoc.isTest ? assoc.relatedSources : assoc.relatedTests;
      const hasEmptyStrings = related?.some(r => !r || r === '');
      if (hasEmptyStrings) {
        errors.push(`⚠️  Empty string in associations for ${file}`);
        invalidCount++;
      }
      
      // Check 3: Related files should exist in our files list
      if (related) {
        for (const relatedFile of related) {
          if (!this.associations.has(relatedFile as RelativePath)) {
            errors.push(`⚠️  Related file not in associations: ${relatedFile} (from ${file})`);
            invalidCount++;
          }
        }
      }
    }
    
    if (invalidCount > 0) {
      console.error(chalk.red('\n[AssociationManager] Validation errors:'));
      errors.forEach(err => console.error(chalk.red(err)));
      throw new Error(`Found ${invalidCount} invalid associations`);
    }
    
    console.log(chalk.green('[AssociationManager] ✓ All associations validated'));
  }
  
  /**
   * Get all associations
   */
  getAssociations(): Map<RelativePath, TestAssociation> {
    return this.associations;
  }
  
  /**
   * Get association for a specific file with helpful warning
   */
  getAssociation(file: RelativePath): TestAssociation | undefined {
    const assoc = this.associations.get(file);
    
    if (!assoc && this.verbose) {
      console.warn(chalk.yellow(`⚠️  No association found for: ${file}`));
    }
    
    return assoc;
  }
  
  /**
   * Get statistics about associations
   */
  getStats(): {
    totalFiles: number;
    testFiles: number;
    sourceFiles: number;
    sourcesWithTests: number;
    testsWithSources: number;
  } {
    const values = Array.from(this.associations.values());
    const testFiles = values.filter(a => a.isTest);
    const sourceFiles = values.filter(a => !a.isTest);
    
    return {
      totalFiles: this.files.length,
      testFiles: testFiles.length,
      sourceFiles: sourceFiles.length,
      sourcesWithTests: sourceFiles.filter(a => a.relatedTests && a.relatedTests.length > 0).length,
      testsWithSources: testFiles.filter(a => a.relatedSources && a.relatedSources.length > 0).length,
    };
  }
}

