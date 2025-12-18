import chalk from 'chalk';
import { VectorDB } from '@liendev/core';
import { CodeGraphGenerator, AsciiGraphRenderer } from '@liendev/core';
import { configService } from '@liendev/core';

interface GraphOptions {
  rootFile?: string;
  rootFiles?: string[];
  depth?: number;
  direction?: 'forward' | 'reverse' | 'both';
  moduleLevel?: boolean;
}

/** Check if index exists */
async function ensureIndexExists(vectorDB: VectorDB): Promise<void> {
  try {
    await vectorDB.scanWithFilter({ limit: 1 });
  } catch {
    console.error(chalk.red('Error: Index not found'));
    console.log(chalk.yellow('\nRun'), chalk.bold('lien index'), chalk.yellow('to index your codebase first'));
    process.exit(1);
  }
}

/**
 * Generate code dependency graph from indexed codebase
 */
export async function graphCommand(options: GraphOptions): Promise<void> {
  const rootDir = process.cwd();
  const depth = options.depth; // undefined = unlimited (full depth)
  const direction = options.direction || 'forward';
  const moduleLevel = options.moduleLevel || false;

  // Validate that either rootFile or rootFiles is provided
  if (!options.rootFile && (!options.rootFiles || options.rootFiles.length === 0)) {
    console.error(chalk.red('Error: Either rootFile or rootFiles must be provided'));
    process.exit(1);
  }

  try {
    // Load config and database
    await configService.load(rootDir);
    const vectorDB = new VectorDB(rootDir);
    await vectorDB.initialize();
    await ensureIndexExists(vectorDB);

    // Get all chunks
    const allChunks = await vectorDB.scanAll();

    // Generate graph
    const rootLabel = options.rootFiles 
      ? `${options.rootFiles.length} file(s)`
      : options.rootFile!;
    const directionLabel = direction === 'reverse' ? 'reverse dependencies (impact analysis)' 
      : direction === 'both' ? 'forward and reverse dependencies'
      : 'dependencies';
    
    const generator = new CodeGraphGenerator(allChunks, rootDir);
    const graph = await generator.generateGraph({
      rootFile: options.rootFile,
      rootFiles: options.rootFiles,
      depth,
      direction,
      moduleLevel,
      includeTests: false,
      includeComplexity: true,
    });

    // Render and display
    const viewType = graph.moduleLevel ? 'module-level' : 'file-level';
    console.log(chalk.blue(`Generating ${directionLabel} graph (${viewType}) for: ${rootLabel}`));
    
    const renderer = new AsciiGraphRenderer();
    const output = renderer.render(graph);
    
    console.log('\n' + chalk.bold('Dependency Graph:'));
    console.log(output);
    console.log(chalk.gray(`\nNodes: ${graph.nodes.length}, Edges: ${graph.edges.length}`));
    if (graph.moduleLevel) {
      console.log(chalk.gray('(Module-level view)'));
    }
  } catch (error) {
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

