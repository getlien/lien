import fs from 'fs/promises';
import path from 'path';
import ora from 'ora';
import chalk from 'chalk';
import pLimit from 'p-limit';
import { scanCodebase, scanCodebaseWithFrameworks, detectLanguage } from './scanner.js';
import { chunkFile } from './chunker.js';
import { LocalEmbeddings } from '../embeddings/local.js';
import { VectorDB } from '../vectordb/lancedb.js';
import { loadConfig } from '../config/loader.js';
import { CodeChunk, TestAssociation } from './types.js';
import { writeVersionFile } from '../vectordb/version.js';
import { isTestFile, findTestFiles, findSourceFiles, detectTestFramework } from './test-patterns.js';
import { analyzeImports } from './import-analyzer.js';
import type { LienConfig, FrameworkInstance } from '../config/schema.js';

export interface IndexingOptions {
  rootDir?: string;
  verbose?: boolean;
}

interface ChunkWithContent {
  chunk: CodeChunk;
  content: string;
}

/**
 * Determine which framework owns a given file path
 * @param filePath - Relative file path from project root
 * @param frameworks - Array of framework instances
 * @param verbose - Enable debug logging
 * @returns The owning framework, or null if no match
 */
function findOwningFramework(
  filePath: string,
  frameworks: FrameworkInstance[],
  verbose: boolean = false
): FrameworkInstance | null {
  
  // Separate root framework from specific frameworks
  const rootFramework = frameworks.find(fw => fw.path === '.');
  const specificFrameworks = frameworks.filter(fw => fw.path !== '.');
  
  // Sort specific frameworks by path depth (deepest first)
  const sorted = specificFrameworks.sort((a, b) => 
    b.path.split('/').length - a.path.split('/').length
  );
  
  if (verbose && filePath.includes('CognitoServiceTest')) {
    console.log(chalk.cyan(`[DEBUG findOwningFramework] Finding owner for: ${filePath}`));
    console.log(chalk.cyan(`  Specific frameworks (sorted by depth):`));
    for (const fw of sorted) {
      console.log(chalk.cyan(`    - ${fw.name} at "${fw.path}" (enabled: ${fw.enabled})`));
    }
    if (rootFramework) {
      console.log(chalk.cyan(`  Root framework (fallback): ${rootFramework.name} at "."`));
    }
  }
  
  // Check specific frameworks first
  for (const fw of sorted) {
    if (verbose && filePath.includes('CognitoServiceTest')) {
      console.log(chalk.cyan(`  Checking ${fw.name} at "${fw.path}"...`));
    }
    
    if (filePath.startsWith(fw.path + '/')) {
      if (verbose && filePath.includes('CognitoServiceTest')) {
        console.log(chalk.cyan(`    ✓ Matched framework: ${fw.name}`));
      }
      return fw;
    } else if (verbose && filePath.includes('CognitoServiceTest')) {
      console.log(chalk.cyan(`    ✗ "${filePath}" doesn't start with "${fw.path}/"`));
    }
  }
  
  // Fall back to root framework if no specific framework matched
  if (rootFramework) {
    if (verbose && filePath.includes('CognitoServiceTest')) {
      console.log(chalk.cyan(`  ✓ Using fallback root framework: ${rootFramework.name}`));
    }
    return rootFramework;
  }
  
  return null;
}

/**
 * Two-pass test detection system:
 * Pass 1: Convention-based for all 12 languages (~80% accuracy)
 * Pass 2: Import analysis for Tier 1 only (~90% accuracy)
 */
async function analyzeTestAssociations(
  files: string[],
  rootDir: string,
  config: LienConfig,
  spinner: ora.Ora,
  verbose: boolean = false
): Promise<Map<string, TestAssociation>> {
  // Pass 1: Convention-based (all languages)
  const associations = findTestsByConvention(files, config.frameworks, verbose);
  
  // Pass 2: Import analysis (Tier 1 only, if enabled)
  // Note: Legacy configs don't have frameworks array, skip import analysis for them
  const hasLegacyConfig = !config.frameworks || config.frameworks.length === 0;
  if (!hasLegacyConfig && (config as any).indexing?.useImportAnalysis) {
    const tier1Languages = ['typescript', 'javascript', 'python', 'go', 'php'];
    const importAssociations = await analyzeImports(files, tier1Languages, rootDir);
    
    // Merge: imports add missed associations and override convention where found
    mergeTestAssociations(associations, importAssociations);
  }
  
  return associations;
}

/**
 * Convention-based test detection for all 12 languages
 * Now framework-aware for monorepo support
 */
function findTestsByConvention(
  files: string[], 
  frameworks: FrameworkInstance[], 
  verbose: boolean = false
): Map<string, TestAssociation> {
  // Separate test files from source files
  const testFiles: string[] = [];
  const sourceFiles: string[] = [];
  
  for (const file of files) {
    const language = detectLanguage(file);
    if (isTestFile(file, language)) {
      testFiles.push(file);
    } else {
      sourceFiles.push(file);
    }
  }
  
  const associations = new Map<string, TestAssociation>();
  
  // Build associations: source → tests
  let sourcesWithTests = 0;
  for (const sourceFile of sourceFiles) {
    const language = detectLanguage(sourceFile);
    
    // Determine which framework owns this file
    const framework = findOwningFramework(sourceFile, frameworks, verbose);
    const frameworkPath = framework?.path || '.';
    const patterns = framework?.config.testPatterns;
    
    // Find tests within the same framework
    const relatedTests = findTestFiles(sourceFile, language, files, frameworkPath, patterns);
    
    if (verbose && relatedTests.length > 0) {
      sourcesWithTests++;
      if (sourcesWithTests <= 5) {
        console.log(chalk.gray(`[Verbose] ${sourceFile} → ${relatedTests.join(', ')}`));
      }
    }
    
    associations.set(sourceFile, {
      file: sourceFile,
      relatedTests,
      isTest: false,
      detectionMethod: 'convention'
    });
  }
  
  // Build associations: test → sources (bidirectional)
  let testsWithSources = 0;
  
  if (verbose && testFiles.length > 0) {
    console.log(chalk.cyan(`\n[DEBUG] Building test→source associations for ${testFiles.length} test files...`));
  }
  
  for (const testFile of testFiles) {
    const language = detectLanguage(testFile);
    
    // Determine which framework owns this test file
    const framework = findOwningFramework(testFile, frameworks, verbose);
    const frameworkPath = framework?.path || '.';
    const patterns = framework?.config.testPatterns;
    
    if (verbose && testFiles.indexOf(testFile) < 3) {
      console.log(chalk.cyan(`\n[DEBUG] Processing test #${testFiles.indexOf(testFile) + 1}: ${testFile}`));
      console.log(chalk.cyan(`  language: ${language}`));
      console.log(chalk.cyan(`  framework: ${framework?.name || 'none'}`));
      console.log(chalk.cyan(`  frameworkPath: ${frameworkPath}`));
      console.log(chalk.cyan(`  patterns: ${patterns ? 'yes' : 'no'}`));
    }
    
    // Find sources within the same framework
    const relatedSources = findSourceFiles(testFile, language, files, frameworkPath, patterns, verbose);
    
    if (verbose && relatedSources.length > 0) {
      testsWithSources++;
      if (testsWithSources <= 5) {
        console.log(chalk.gray(`[Verbose] ${testFile} → ${relatedSources.join(', ')}`));
      }
    }
    
    associations.set(testFile, {
      file: testFile,
      relatedSources,
      isTest: true,
      detectionMethod: 'convention'
    });
  }
  
  return associations;
}

/**
 * Merge import-based associations with convention-based ones
 */
function mergeTestAssociations(
  conventionAssociations: Map<string, TestAssociation>,
  importAssociations: Map<string, string[]>
): void {
  for (const [file, importedFiles] of importAssociations) {
    const existing = conventionAssociations.get(file);
    if (existing) {
      // Merge imported files into existing associations
      if (existing.isTest) {
        // For test files, add to relatedSources
        const combined = new Set([...(existing.relatedSources || []), ...importedFiles]);
        existing.relatedSources = Array.from(combined);
      } else {
        // For source files, check if any imports are test files
        for (const importedFile of importedFiles) {
          const importedAssoc = conventionAssociations.get(importedFile);
          if (importedAssoc?.isTest) {
            const combined = new Set([...(existing.relatedTests || []), importedFile]);
            existing.relatedTests = Array.from(combined);
          }
        }
      }
      // Mark as enhanced by imports
      existing.detectionMethod = 'import';
    }
  }
}

export async function indexCodebase(options: IndexingOptions = {}): Promise<void> {
  const rootDir = options.rootDir ?? process.cwd();
  const verbose = options.verbose ?? false;
  const spinner = ora('Starting indexing process...').start();
  
  try {
    // 1. Load configuration
    spinner.text = 'Loading configuration...';
    const config = await loadConfig(rootDir);
    
    // 2. Scan for files (framework-aware if frameworks configured)
    spinner.text = 'Scanning codebase...';
    let files: string[];
    
    if (config.frameworks && config.frameworks.length > 0) {
      // Use framework-aware scanning for new configs
      files = await scanCodebaseWithFrameworks(rootDir, config);
    } else {
      // Fall back to legacy scanning for old configs
      const legacyConfig = config as any;
      files = await scanCodebase({
      rootDir,
        includePatterns: legacyConfig.indexing?.include || [],
        excludePatterns: legacyConfig.indexing?.exclude || [],
    });
    }
    
    if (files.length === 0) {
      spinner.fail('No files found to index');
      return;
    }
    
    spinner.text = `Found ${files.length} files`;
    
    // 3. Analyze test associations (if enabled)
    let testAssociations = new Map<string, TestAssociation>();
    const hasFrameworks = config.frameworks && config.frameworks.length > 0;
    const indexTests = hasFrameworks || (config as any).indexing?.indexTests;
    
    if (indexTests && hasFrameworks) {
      spinner.start('Analyzing test associations...');
      // Convert absolute paths to relative for test pattern matching
      const relativeFiles = files.map(f => path.relative(rootDir, f));
      const relativeAssociations = await analyzeTestAssociations(relativeFiles, rootDir, config, spinner, verbose);
      
      // Convert back to absolute paths for the map keys
      for (const [relPath, association] of relativeAssociations.entries()) {
        const absPath = path.join(rootDir, relPath);
        testAssociations.set(absPath, {
          ...association,
          file: absPath,
          relatedTests: association.relatedTests ? association.relatedTests.map(t => path.join(rootDir, t)) : [],
          relatedSources: association.relatedSources ? association.relatedSources.map(s => path.join(rootDir, s)) : [],
        });
      }
      
      const testFileCount = Array.from(testAssociations.values()).filter(a => a.isTest).length;
      const sourceWithTestsCount = Array.from(testAssociations.values()).filter(a => !a.isTest && a.relatedTests.length > 0).length;
      spinner.succeed(`Found ${testFileCount} test files with ${sourceWithTestsCount} source files that have tests`);
      
      if (verbose && sourceWithTestsCount === 0 && testFileCount > 0) {
        // Show debug info when verbose is enabled
        const sampleTest = relativeFiles.find(f => {
          const lang = detectLanguage(f);
          return isTestFile(f, lang);
        });
        const sampleSource = relativeFiles.find(f => {
          const lang = detectLanguage(f);
          return !isTestFile(f, lang);
        });
        console.log(chalk.yellow(`\n[Verbose] No source→test associations found`));
        if (sampleTest) console.log(chalk.gray(`[Verbose] Sample test file: ${sampleTest}`));
        if (sampleSource) console.log(chalk.gray(`[Verbose] Sample source file: ${sampleSource}\n`));
      }
    }
    
    // 4. Initialize embeddings model
    spinner.text = 'Loading embedding model (this may take a minute on first run)...';
    const embeddings = new LocalEmbeddings();
    await embeddings.initialize();
    spinner.succeed('Embedding model loaded');
    
    // 5. Initialize vector database
    spinner.start('Initializing vector database...');
    const vectorDB = new VectorDB(rootDir);
    await vectorDB.initialize();
    spinner.succeed('Vector database initialized');
    
    // 6. Process files concurrently
    const concurrency = config.core?.concurrency || (config as any).indexing?.concurrency || 4;
    const batchSize = config.core?.embeddingBatchSize || (config as any).indexing?.embeddingBatchSize || 50;
    
    spinner.start(`Processing files with ${concurrency}x concurrency...`);
    
    const startTime = Date.now();
    let processedFiles = 0;
    let processedChunks = 0;
    
    // Accumulator for chunks across multiple files
    const chunkAccumulator: ChunkWithContent[] = [];
    const limit = pLimit(concurrency);
    
    // Function to process accumulated chunks
    const processAccumulatedChunks = async () => {
      if (chunkAccumulator.length === 0) return;
      
      const toProcess = chunkAccumulator.splice(0, chunkAccumulator.length);
      
      // Process in batches
      for (let i = 0; i < toProcess.length; i += batchSize) {
        const batch = toProcess.slice(i, Math.min(i + batchSize, toProcess.length));
        
        const texts = batch.map(item => item.content);
        const embeddingVectors = await embeddings.embedBatch(texts);
        
        await vectorDB.insertBatch(
          embeddingVectors,
          batch.map(item => item.chunk.metadata),
          texts
        );
        
        processedChunks += batch.length;
      }
    };
    
    // Process files with concurrency limit
    const filePromises = files.map((file) =>
      limit(async () => {
        try {
          const content = await fs.readFile(file, 'utf-8');
          const chunkSize = config.core?.chunkSize || (config as any).indexing?.chunkSize || 75;
          const chunkOverlap = config.core?.chunkOverlap || (config as any).indexing?.chunkOverlap || 10;
          
          const chunks = chunkFile(file, content, {
            chunkSize,
            chunkOverlap,
          });
          
          if (chunks.length === 0) {
            processedFiles++;
            return;
          }
          
          // Enrich chunks with test association metadata
          const association = testAssociations.get(file);
          if (association) {
            const language = detectLanguage(file);
            const testFramework = association.isTest 
              ? detectTestFramework(content, language) 
              : undefined;
            
            for (const chunk of chunks) {
              chunk.metadata.isTest = association.isTest;
              chunk.metadata.relatedTests = association.relatedTests;
              chunk.metadata.relatedSources = association.relatedSources;
              chunk.metadata.testFramework = testFramework;
              chunk.metadata.detectionMethod = association.detectionMethod;
            }
          }
          
          // Add chunks to accumulator
          for (const chunk of chunks) {
            chunkAccumulator.push({
              chunk,
              content: chunk.content,
            });
          }
          
          // Process when batch is large enough
          if (chunkAccumulator.length >= batchSize) {
            await processAccumulatedChunks();
          }
          
          processedFiles++;
          
          // Update progress
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = processedFiles / elapsed;
          const eta = rate > 0 ? Math.round((files.length - processedFiles) / rate) : 0;
          
          spinner.text = `Indexed ${processedFiles}/${files.length} files (${processedChunks} chunks) | ${concurrency}x concurrency | ETA: ${eta}s`;
        } catch (error) {
          if (options.verbose) {
            console.error(chalk.yellow(`\n⚠️  Skipping ${file}: ${error}`));
          }
          processedFiles++;
        }
      })
    );
    
    // Wait for all files to be processed
    await Promise.all(filePromises);
    
    // Process remaining chunks
    await processAccumulatedChunks();
    
    // Write version file to mark successful completion
    // This allows the MCP server to detect when reindexing is complete
    await writeVersionFile(vectorDB.dbPath);
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    spinner.succeed(
      `Indexed ${processedFiles} files (${processedChunks} chunks) in ${totalTime}s using ${concurrency}x concurrency`
    );
    
    console.log(chalk.dim('\nNext step: Run'), chalk.bold('lien serve'), chalk.dim('to start the MCP server'));
  } catch (error) {
    spinner.fail(`Indexing failed: ${error}`);
    throw error;
  }
}

