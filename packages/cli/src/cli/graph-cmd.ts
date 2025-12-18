import chalk from 'chalk';
import { VectorDB } from '@liendev/core';
import { CodeGraphGenerator, AsciiGraphRenderer } from '@liendev/core';
import { configService } from '@liendev/core';

interface GraphOptions {
  rootFile: string;
  depth?: number;
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
  const depth = options.depth || 1;

  try {
    // Load config and database
    await configService.load(rootDir);
    const vectorDB = new VectorDB(rootDir);
    await vectorDB.initialize();
    await ensureIndexExists(vectorDB);

    // Get all chunks
    const allChunks = await vectorDB.scanAll();

    // Generate graph
    console.log(chalk.blue(`Generating dependency graph for: ${options.rootFile}`));
    const generator = new CodeGraphGenerator(allChunks, rootDir);
    const graph = await generator.generateGraph({
      rootFile: options.rootFile,
      depth,
      includeTests: false,
      includeComplexity: true,
    });

    // Render and display
    const renderer = new AsciiGraphRenderer();
    const output = renderer.render(graph);
    
    console.log('\n' + chalk.bold('Dependency Graph:'));
    console.log(output);
    console.log(chalk.gray(`\nNodes: ${graph.nodes.length}, Edges: ${graph.edges.length}`));
  } catch (error) {
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

