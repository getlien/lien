import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { tools } from './tools.js';
import { VectorDB } from '../vectordb/lancedb.js';
import { LocalEmbeddings } from '../embeddings/local.js';

export interface MCPServerOptions {
  rootDir: string;
  verbose?: boolean;
}

export async function startMCPServer(options: MCPServerOptions): Promise<void> {
  const { rootDir, verbose } = options;
  
  // Log to stderr (stdout is reserved for MCP protocol)
  const log = (message: string) => {
    if (verbose) {
      console.error(`[Lien MCP] ${message}`);
    }
  };
  
  log('Initializing MCP server...');
  
  // Initialize embeddings and vector DB
  const embeddings = new LocalEmbeddings();
  const vectorDB = new VectorDB(rootDir);
  
  try {
    log('Loading embedding model...');
    await embeddings.initialize();
    
    log('Loading vector database...');
    await vectorDB.initialize();
    
    log('Embeddings and vector DB ready');
  } catch (error) {
    console.error(`Failed to initialize: ${error}`);
    process.exit(1);
  }
  
  // Create MCP server
  const server = new Server(
    {
      name: 'lien',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );
  
  // Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
  }));
  
  // Helper function to check version and reconnect if needed
  const checkAndReconnect = async () => {
    try {
      const versionChanged = await vectorDB.checkVersion();
      if (versionChanged) {
        log('Index version changed, reconnecting to database...');
        await vectorDB.reconnect();
        log('Reconnected to updated index');
      }
    } catch (error) {
      // Log but don't throw - fall back to existing connection
      log(`Version check failed: ${error}`);
    }
  };
  
  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    
    try {
      log(`Handling tool call: ${name}`);
      
      switch (name) {
        case 'semantic_search': {
          const query = args.query as string;
          const limit = (args.limit as number) || 5;
          
          log(`Searching for: "${query}"`);
          
          // Check if index has been updated and reconnect if needed
          await checkAndReconnect();
          
          const queryEmbedding = await embeddings.embed(query);
          const results = await vectorDB.search(queryEmbedding, limit);
          
          log(`Found ${results.length} results`);
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(results, null, 2),
              },
            ],
          };
        }
        
        case 'find_similar': {
          const code = args.code as string;
          const limit = (args.limit as number) || 5;
          
          log(`Finding similar code...`);
          
          // Check if index has been updated and reconnect if needed
          await checkAndReconnect();
          
          const codeEmbedding = await embeddings.embed(code);
          const results = await vectorDB.search(codeEmbedding, limit);
          
          log(`Found ${results.length} similar chunks`);
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(results, null, 2),
              },
            ],
          };
        }
        
        case 'get_file_context': {
          const filepath = args.filepath as string;
          const includeRelated = (args.includeRelated as boolean) ?? true;
          
          log(`Getting context for: ${filepath}`);
          
          // Check if index has been updated and reconnect if needed
          await checkAndReconnect();
          
          // Search for chunks from this file by embedding the filepath
          // This is a simple approach; could be improved with metadata filtering
          const fileEmbedding = await embeddings.embed(filepath);
          const allResults = await vectorDB.search(fileEmbedding, 50);
          
          // Filter results to only include chunks from the target file
          const fileChunks = allResults.filter(r => 
            r.metadata.file.includes(filepath) || filepath.includes(r.metadata.file)
          );
          
          let results = fileChunks;
          
          if (includeRelated && fileChunks.length > 0) {
            // Get related chunks by searching with the first chunk's content
            const relatedEmbedding = await embeddings.embed(fileChunks[0].content);
            const related = await vectorDB.search(relatedEmbedding, 5);
            
            // Add related chunks that aren't from the same file
            const relatedOtherFiles = related.filter(r => 
              !r.metadata.file.includes(filepath) && !filepath.includes(r.metadata.file)
            );
            
            results = [...fileChunks, ...relatedOtherFiles];
          }
          
          log(`Found ${results.length} chunks`);
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(results, null, 2),
              },
            ],
          };
        }
        
        case 'list_functions': {
          const pattern = args.pattern as string | undefined;
          const language = args.language as string | undefined;
          
          log('Listing functions...');
          
          // Check if index has been updated and reconnect if needed
          await checkAndReconnect();
          
          // For MVP, we'll search for common function/class keywords
          const searchTerms = language 
            ? [`${language} function`, `${language} class`]
            : ['function', 'class', 'def ', 'func ', 'interface'];
          
          const allResults: any[] = [];
          
          for (const term of searchTerms) {
            const termEmbedding = await embeddings.embed(term);
            const results = await vectorDB.search(termEmbedding, 20);
            allResults.push(...results);
          }
          
          // Remove duplicates and filter by pattern if provided
          const uniqueResults = Array.from(
            new Map(allResults.map(r => [r.metadata.file + r.metadata.startLine, r])).values()
          );
          
          let filtered = uniqueResults;
          
          if (pattern) {
            const regex = new RegExp(pattern, 'i');
            filtered = uniqueResults.filter(r => 
              regex.test(r.content) || regex.test(r.metadata.file)
            );
          }
          
          if (language) {
            filtered = filtered.filter(r => 
              r.metadata.language.toLowerCase() === language.toLowerCase()
            );
          }
          
          log(`Found ${filtered.length} functions/classes`);
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(filtered, null, 2),
              },
            ],
          };
        }
        
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      console.error(`Error handling tool call ${name}:`, error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: String(error),
              tool: name,
            }),
          },
        ],
        isError: true,
      };
    }
  });
  
  // Handle shutdown gracefully
  process.on('SIGINT', () => {
    log('Shutting down MCP server...');
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    log('Shutting down MCP server...');
    process.exit(0);
  });
  
  // Connect to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  log('MCP server started and listening on stdio');
}

