import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { CodeGraphSchema } from '../schemas/index.js';
import { CodeGraphGenerator, AsciiGraphRenderer } from '@liendev/core';
import type { ToolContext, MCPToolResult } from '../types.js';

/**
 * Handle code_graph tool calls.
 * Generates a dependency graph starting from a root file.
 */
export async function handleCodeGraph(
  args: unknown,
  ctx: ToolContext
): Promise<MCPToolResult> {
  const { vectorDB, log, checkAndReconnect, getIndexMetadata, rootDir } = ctx;

  return await wrapToolHandler(
    CodeGraphSchema,
    async (validatedArgs) => {
      log(`Generating code graph for: ${validatedArgs.rootFile}`);
      await checkAndReconnect();

      // Get all chunks
      const allChunks = await vectorDB.scanWithFilter({ limit: 10000 });
      log(`Scanning ${allChunks.length} chunks for dependencies...`);

      // Generate graph
      const generator = new CodeGraphGenerator(allChunks, rootDir);
      const graph = await generator.generateGraph({
        rootFile: validatedArgs.rootFile,
        rootFiles: validatedArgs.rootFiles,
        depth: validatedArgs.depth ?? 1,
        direction: validatedArgs.direction ?? 'forward',
        moduleLevel: validatedArgs.moduleLevel ?? false,
        includeTests: false,
        includeComplexity: true,
      });

      // Render ASCII
      const renderer = new AsciiGraphRenderer();
      const asciiOutput = renderer.render(graph);

      log(`Generated graph with ${graph.nodes.length} nodes and ${graph.edges.length} edges`);

      return {
        indexInfo: getIndexMetadata(),
        rootFile: graph.rootFile,
        rootFiles: graph.rootFiles,
        depth: graph.depth,
        direction: graph.direction,
        moduleLevel: graph.moduleLevel,
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
        graph: asciiOutput,
      };
    }
  )(args);
}

